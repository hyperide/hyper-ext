/**
 * @file Shared component-props-type extraction via the TypeScript Compiler API.
 *
 * Accessed via:
 *   - SaaS: GET /api/component-props-types (`server/routes/getComponentPropsTypes.ts` delegates here).
 *   - VS Code extension: the extension host calls `extractComponentPropsTypes` directly to answer
 *     the inspector's `component:propsTypes` RPC (HYP-709). Both realms run in Node off the real
 *     project files on disk.
 *
 * This is read-only TypeScript type analysis — it never executes project code (it uses
 * `ts.createProgram` purely for type information). Callers are responsible for validating that
 * `filePath` belongs to the active project (the SaaS route checks existence + project root; the
 * ext host joins the workspace root).
 *
 * The output is the rich `ComponentPropsSchema` (`PropTypeInfo` with enum/array/object shapes and
 * `tokenCategory`) that the PropsEditor form needs — notably `tokenCategory`, which drives the
 * Tamagui design-token autocomplete. The ext's ComponentService produces a simpler `PropInfo[]`
 * that lacks these, which is why this extractor is shared rather than reusing that path.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import type { ComponentPropsSchema, PropTypeInfo } from '../../shared/types/props';

/**
 * Extract JSDoc comment from symbol
 */
function extractJSDocDescription(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
  const comments = symbol.getDocumentationComment(checker);
  if (comments.length > 0) {
    return comments.map((c) => c.text).join('\n');
  }
  return undefined;
}

/**
 * Check if prop name suggests it's a design token field and return token category
 */
function getTokenFieldCategory(propName: string): 'color' | 'size' | 'space' | null {
  const lowerName = propName.toLowerCase();

  // Color-related props
  if (lowerName.includes('color') || lowerName.includes('colour') || lowerName === 'background' || lowerName === 'bg') {
    return 'color';
  }

  // Size-related props
  if (lowerName === 'size' || lowerName === 'width' || lowerName === 'height' || lowerName === 'fontSize') {
    return 'size';
  }

  // Space-related props
  if (
    lowerName === 'space' ||
    lowerName === 'margin' ||
    lowerName === 'padding' ||
    lowerName === 'gap' ||
    lowerName.startsWith('margin') ||
    lowerName.startsWith('padding')
  ) {
    return 'space';
  }

  return null;
}

/**
 * Recursively analyze TypeScript type and convert to PropTypeInfo
 */
function analyzeType(type: ts.Type, checker: ts.TypeChecker, depth = 0): PropTypeInfo {
  // Prevent infinite recursion
  if (depth > 5) {
    return {
      type: 'unknown',
      required: false,
      description: 'Max depth reached',
    };
  }

  const typeString = checker.typeToString(type);

  // Check for React types
  if (typeString.includes('ReactNode') || typeString.includes('ReactElement')) {
    return { type: 'reactNode', required: false };
  }

  // Check for function types
  if (type.getCallSignatures().length > 0) {
    return { type: 'function', required: false };
  }

  // Union type handling
  if (type.isUnion()) {
    const literalValues: string[] = [];
    const nonLiteralTypes: ts.Type[] = [];

    for (const unionType of type.types) {
      if (unionType.isStringLiteral()) {
        literalValues.push(unionType.value);
      } else if (unionType.flags & ts.TypeFlags.Undefined || unionType.flags & ts.TypeFlags.Null) {
        // Skip undefined/null
      } else {
        nonLiteralTypes.push(unionType);
      }
    }

    // If only string literals (enum-like)
    if (literalValues.length > 0 && nonLiteralTypes.length === 0) {
      return {
        type: 'enum',
        required: false,
        enumValues: literalValues,
      };
    }

    // If union has one non-literal type after filtering null/undefined, analyze it
    if (nonLiteralTypes.length === 1 && literalValues.length === 0) {
      return analyzeType(nonLiteralTypes[0], checker, depth + 1);
    }

    // Mixed or multiple non-literal types - return unknown for now
    return { type: 'unknown', required: false };
  }

  // Intersection type handling (Type1 & Type2 & Type3)
  if (type.isIntersection()) {
    // Collect all properties from all intersection members
    const allProperties = new Map<string, ts.Symbol>();

    for (const intersectionType of type.types) {
      const props = intersectionType.getProperties();
      for (const prop of props) {
        // Last one wins in case of conflicts
        allProperties.set(prop.name, prop);
      }
    }

    if (allProperties.size > 0) {
      const objectSchema: Record<string, PropTypeInfo> = {};

      for (const [propName, prop] of allProperties) {
        if (!prop.valueDeclaration) continue;
        const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration);
        const isOptional = !!(prop.flags & ts.SymbolFlags.Optional);

        const propInfo = analyzeType(propType, checker, depth + 1);
        propInfo.required = !isOptional;
        propInfo.description = extractJSDocDescription(prop, checker);

        objectSchema[propName] = propInfo;
      }

      return {
        type: 'object',
        required: false,
        objectSchema,
      };
    }
  }

  // Array type
  if (checker.isArrayType(type)) {
    const arrayType = (type as ts.TypeReference).typeArguments?.[0];
    if (arrayType) {
      const itemType = analyzeType(arrayType, checker, depth + 1);
      return {
        type: 'array',
        required: false,
        arrayItemType: itemType,
      };
    }
    return { type: 'array', required: false };
  }

  // Object type
  if (type.flags & ts.TypeFlags.Object && !type.isClass()) {
    const properties = type.getProperties();

    if (properties.length > 0) {
      const objectSchema: Record<string, PropTypeInfo> = {};

      for (const prop of properties) {
        if (!prop.valueDeclaration) continue;
        const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration);
        const isOptional = !!(prop.flags & ts.SymbolFlags.Optional);

        const propInfo = analyzeType(propType, checker, depth + 1);
        propInfo.required = !isOptional;
        propInfo.description = extractJSDocDescription(prop, checker);

        objectSchema[prop.name] = propInfo;
      }

      return {
        type: 'object',
        required: false,
        objectSchema,
      };
    }
  }

  // Primitive types
  if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
    return { type: 'string', required: false };
  }
  if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
    return { type: 'number', required: false };
  }
  if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
    return { type: 'boolean', required: false };
  }

  return { type: 'unknown', required: false };
}

/**
 * Find import path for a given component name
 */
function findComponentImportPath(sourceFile: ts.SourceFile, componentName: string): string | null {
  let importPath: string | null = null;

  function visit(node: ts.Node) {
    if (importPath) return;

    // Check import declarations: import { Button } from './ui/button'
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const namedBindings = node.importClause?.namedBindings;

        // Named imports: import { Button, Input } from './ui'
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) {
            if (element.name.text === componentName) {
              importPath = moduleSpecifier.text;
              return;
            }
          }
        }

        // Default import: import Button from './Button'
        if (node.importClause?.name?.text === componentName) {
          importPath = moduleSpecifier.text;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return importPath;
}

/**
 * Resolve import path to absolute file path
 */
function resolveImportPath(
  currentFilePath: string,
  importPath: string,
  compilerOptions?: ts.CompilerOptions,
): string | null {
  const currentDir = path.dirname(currentFilePath);

  // Handle relative imports
  if (importPath.startsWith('.')) {
    const resolved = path.resolve(currentDir, importPath);

    // Try with different extensions (include .d.ts for TypeScript definition files)
    const extensions = ['.tsx', '.ts', '.d.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.d.ts'];
    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    // Try without extension (might already have it)
    if (existsSync(resolved)) {
      return resolved;
    }
  } else {
    // Handle node_modules imports
    // Try to resolve using TypeScript's paths mapping if available
    if (compilerOptions?.paths && compilerOptions?.baseUrl) {
      const baseUrl = compilerOptions.baseUrl;

      // Check if import matches any path alias
      for (const [pattern, mappings] of Object.entries(compilerOptions.paths)) {
        let match: RegExpMatchArray | null = null;

        // Handle patterns with wildcard (e.g., "@my/ui/*")
        if (pattern.includes('*')) {
          // Convert pattern to regex (e.g., "@my/ui/*" -> "^@my/ui/(.*)$")
          const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)');
          const regex = new RegExp(`^${regexPattern}$`); // nosemgrep: detect-non-literal-regexp -- regexPattern from tsconfig paths, not user input
          match = importPath.match(regex);

          // Also try exact match without subpath (e.g., "@my/ui" for "@my/ui/*")
          if (!match) {
            const basePattern = pattern.replace('/*', '');
            if (importPath === basePattern) {
              match = [importPath, '']; // Empty captured group
            }
          }
        } else {
          // Exact pattern match (no wildcard)
          if (importPath === pattern) {
            match = [importPath];
          }
        }

        if (match) {
          // Try each mapping
          for (const mapping of mappings) {
            let resolvedMapping = mapping;

            // Substitute the captured group for the '*' wildcard. This is tsconfig
            // path-mapping resolution, not sanitization: a mapping holds at most one
            // '*' per the TS spec, but replaceAll keeps CodeQL's
            // js/incomplete-sanitization quiet and is correct for malformed
            // multi-star mappings too. The function replacer stops `$`-patterns in
            // the captured import segment from being interpreted.
            if (match[1] !== undefined) {
              const captured = match[1];
              resolvedMapping = mapping.replaceAll('*', () => captured);
            }

            // Resolve relative to baseUrl
            const resolved = path.resolve(baseUrl, resolvedMapping);

            // Try with different extensions
            const extensions = [
              '.tsx',
              '.ts',
              '.d.ts',
              '.jsx',
              '.js',
              '/index.tsx',
              '/index.ts',
              '/index.d.ts',
              '/src/index.tsx',
              '/src/index.ts',
              '/src/index.d.ts',
            ];
            for (const ext of extensions) {
              const fullPath = resolved + ext;
              if (existsSync(fullPath)) {
                return fullPath;
              }
            }

            // Try without extension
            if (existsSync(resolved)) {
              return resolved;
            }
          }
        }
      }
    }

    // Fallback: try node_modules resolution
    let searchDir = currentDir;
    while (searchDir !== path.dirname(searchDir)) {
      const nodeModulesPath = path.join(searchDir, 'node_modules', importPath);

      // Try with different extensions
      const extensions = ['.tsx', '.ts', '.d.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.d.ts'];
      for (const ext of extensions) {
        const fullPath = nodeModulesPath + ext;
        if (existsSync(fullPath)) {
          return fullPath;
        }
      }

      // Try package.json
      const packageJsonPath = path.join(nodeModulesPath, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          const mainFile = packageJson.types || packageJson.typings || packageJson.main;
          if (mainFile) {
            const resolved = path.join(nodeModulesPath, mainFile);
            if (existsSync(resolved)) {
              return resolved;
            }
          }
        } catch {
          // ignore malformed package.json
        }
      }

      searchDir = path.dirname(searchDir);
    }
  }

  return null;
}

/**
 * Find and load tsconfig.json from project
 */
function findAndLoadTsConfig(filePath: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(path.dirname(filePath), ts.sys.fileExists, 'tsconfig.json');

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

    if (!configFile.error) {
      const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
      if (parsedConfig.errors.length === 0) {
        return parsedConfig.options;
      }
    }
  }

  // Fallback to default options
  return {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.React,
    allowJs: true,
    skipLibCheck: true,
    esModuleInterop: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
  };
}

/**
 * Extract the typed props schema for a component from a source file. Follows imports/re-exports
 * to find the component's props type when it isn't declared locally. Returns null when no typed
 * component is found (e.g. an untyped component or an HTML element).
 */
export function extractComponentPropsTypes(
  filePath: string,
  targetComponentName?: string,
): ComponentPropsSchema | null {
  // Load compiler options from tsconfig.json
  const compilerOptions = findAndLoadTsConfig(filePath);

  // Create a program with the file
  const program = ts.createProgram([filePath], compilerOptions);
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    return null;
  }

  const checker = program.getTypeChecker();
  let componentName: string | null = null;
  let propsType: ts.Type | null = null;

  // Find component and its props type
  function visit(node: ts.Node) {
    // Skip if we already found the target component
    if (propsType && targetComponentName) {
      return;
    }

    // Function component: export function Component(props: Props) {}
    if (ts.isFunctionDeclaration(node) && node.name) {
      const funcName = node.name.text;

      // If targetComponentName specified, only match that specific component
      if (targetComponentName && funcName !== targetComponentName) {
        ts.forEachChild(node, visit);
        return;
      }

      const params = node.parameters;
      if (params.length > 0) {
        const propsParam = params[0];
        if (propsParam.type) {
          componentName = funcName;
          propsType = checker.getTypeAtLocation(propsParam.type);
          return; // Found it, stop searching
        }
      }
    }

    // Arrow function component: export const Component: FC<Props> = ...
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((decl) => {
        if (ts.isVariableDeclaration(decl) && decl.name && ts.isIdentifier(decl.name)) {
          const varName = decl.name.text;

          // If targetComponentName specified, only match that specific component
          if (targetComponentName && varName !== targetComponentName) {
            return;
          }

          // Check if it's typed as FC<Props> or React.FC<Props>
          if (decl.type && ts.isTypeReferenceNode(decl.type)) {
            const typeName = decl.type.typeName;
            const typeArgs = decl.type.typeArguments;

            let isFunctionComponent = false;
            if (ts.isIdentifier(typeName)) {
              isFunctionComponent = typeName.text === 'FC' || typeName.text === 'FunctionComponent';
            } else if (ts.isQualifiedName(typeName)) {
              isFunctionComponent = typeName.right.text === 'FC' || typeName.right.text === 'FunctionComponent';
            }

            if (isFunctionComponent && typeArgs && typeArgs.length > 0) {
              componentName = varName;
              propsType = checker.getTypeFromTypeNode(typeArgs[0]);
              return;
            }
          }

          // Check initializer for arrow function with typed params
          if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
            const params = decl.initializer.parameters;
            if (params.length > 0 && params[0].type) {
              componentName = varName;
              propsType = checker.getTypeAtLocation(params[0].type);
              return;
            }
          }

          // Check for forwardRef: const Button = forwardRef<HTMLElement, Props>(...)
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            const callExpr = decl.initializer;
            const expression = callExpr.expression;

            // Check if it's a call to forwardRef
            const isForwardRef =
              (ts.isIdentifier(expression) && expression.text === 'forwardRef') ||
              (ts.isPropertyAccessExpression(expression) &&
                ts.isIdentifier(expression.name) &&
                expression.name.text === 'forwardRef');

            if (isForwardRef) {
              // forwardRef<TElement, TProps> - second type argument is props
              const typeArgs = callExpr.typeArguments;
              if (typeArgs && typeArgs.length >= 2) {
                componentName = varName;
                propsType = checker.getTypeFromTypeNode(typeArgs[1]);
                return;
              }

              // Fallback: try to get props from the callback function
              const callback = callExpr.arguments[0];
              if (callback && ts.isArrowFunction(callback)) {
                const params = callback.parameters;
                if (params.length > 0 && params[0].type) {
                  componentName = varName;
                  propsType = checker.getTypeAtLocation(params[0].type);
                  return;
                }
              }
            }
          }

          // Check for declare const (from .d.ts files): declare const Component: Type
          // This is common in library type definitions
          if (decl.type && !decl.initializer) {
            // Get the type of the declaration
            const declType = checker.getTypeAtLocation(decl.type);

            // Try to extract props from call signatures (for component types)
            const callSignatures = declType.getCallSignatures();
            if (callSignatures.length > 0) {
              const signature = callSignatures[0];
              const params = signature.getParameters();

              if (params.length > 0) {
                const propsParam = params[0];
                const propsParamType = checker.getTypeOfSymbolAtLocation(
                  propsParam,
                  propsParam.valueDeclaration || decl,
                );

                componentName = varName;
                propsType = propsParamType;
                return;
              }
            }
          }
        }
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // If component not found in current file, try to find it via imports or re-exports
  if ((!propsType || !componentName) && targetComponentName) {
    const importPath = findComponentImportPath(sourceFile, targetComponentName);
    if (importPath) {
      // Try to resolve the import (works for both relative and library imports)
      const resolvedPath = resolveImportPath(filePath, importPath, compilerOptions);
      if (resolvedPath) {
        return extractComponentPropsTypes(resolvedPath, targetComponentName);
      }
    } else {
      // Use TypeChecker to find component in module exports (handles re-exports efficiently)
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
      if (moduleSymbol) {
        const exports = checker.getExportsOfModule(moduleSymbol);

        // Find the export matching our component name
        const targetExport = exports.find((exp) => exp.name === targetComponentName);
        if (targetExport) {
          // Get the actual symbol (resolves aliases from re-exports only if it's an alias)
          const actualSymbol =
            targetExport.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(targetExport) : targetExport;

          // Get the type of the symbol
          const symbolType = checker.getTypeOfSymbolAtLocation(
            actualSymbol,
            actualSymbol.valueDeclaration || sourceFile,
          );

          // Try to extract props from call signatures (for component types)
          const callSignatures = symbolType.getCallSignatures();
          if (callSignatures.length > 0) {
            const signature = callSignatures[0];
            const params = signature.getParameters();

            if (params.length > 0) {
              const propsParam = params[0];
              const propsParamType = checker.getTypeOfSymbolAtLocation(
                propsParam,
                propsParam.valueDeclaration || sourceFile,
              );

              componentName = targetComponentName;
              propsType = propsParamType;
            }
          }
        }
      }
    }
  }

  if (!propsType || !componentName) {
    return null;
  }

  // Extract props
  const props: Record<string, PropTypeInfo> = {};
  const properties = propsType.getProperties();

  for (const prop of properties) {
    if (!prop.valueDeclaration) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration);
    const isOptional = !!(prop.flags & ts.SymbolFlags.Optional);

    const propInfo = analyzeType(propType, checker);
    propInfo.required = !isOptional;
    propInfo.description = extractJSDocDescription(prop, checker);

    // Mark design token fields
    const tokenCategory = getTokenFieldCategory(prop.name);
    if (tokenCategory) {
      propInfo.tokenCategory = tokenCategory;
    }

    // Skip React-specific props that shouldn't be edited
    if (prop.name === 'key' || prop.name === 'ref' || prop.name === 'children') {
      continue;
    }

    // Skip aria- attributes
    if (prop.name.startsWith('aria-')) {
      continue;
    }

    // Skip event handlers (onSomething) and function types
    if (propInfo.type === 'function') {
      continue;
    }
    if (/^on[A-Z]/.test(prop.name)) {
      continue;
    }

    props[prop.name] = propInfo;
  }

  return {
    componentName,
    props,
  };
}

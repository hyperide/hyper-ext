/**
 * Component Analyzer
 *
 * Parses React component files to extract:
 * - Props interface
 * - CVA variants (class-variance-authority)
 * - Interactive elements
 * - Export information
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import _traverse from '@babel/traverse';
import * as t from '@babel/types';

import { readAndParseFile } from '../../ast/parser';
import { findAllJSXElements } from '../../ast/traverser';
import type { ComponentAnalysis, CvaVariantInfo, PropDefinition, PropsInterfaceInfo } from '../types';
import { toKebabCase } from '../utils/naming';
import { findInteractiveElements } from './interactive-detector';

// @ts-expect-error - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

/**
 * Extract component name from file path
 */
function extractComponentName(filePath: string): string {
  const baseName = path.basename(filePath, path.extname(filePath));
  // Convert kebab-case to PascalCase
  return baseName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Extract props interface from AST
 */
function extractPropsInterface(ast: t.File, componentName: string): PropsInterfaceInfo | null {
  let result: PropsInterfaceInfo | null = null;

  // Common props interface naming patterns
  const possibleNames = [`${componentName}Props`, `I${componentName}Props`, `${componentName}PropsType`, 'Props'];

  traverse(ast, {
    // Handle interface declarations
    TSInterfaceDeclaration(path) {
      const name = path.node.id.name;
      if (!possibleNames.includes(name)) return;

      const props: PropDefinition[] = [];

      for (const prop of path.node.body.body) {
        if (t.isTSPropertySignature(prop) && t.isIdentifier(prop.key)) {
          const propDef = extractPropDefinition(prop);
          if (propDef) {
            props.push(propDef);
          }
        }
      }

      result = {
        name,
        props,
        line: path.node.loc?.start.line ?? 0,
      };
    },

    // Handle type alias declarations
    TSTypeAliasDeclaration(path) {
      const name = path.node.id.name;
      if (!possibleNames.includes(name)) return;

      const props: PropDefinition[] = [];
      const typeAnnotation = path.node.typeAnnotation;

      if (t.isTSTypeLiteral(typeAnnotation)) {
        for (const member of typeAnnotation.members) {
          if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
            const propDef = extractPropDefinition(member);
            if (propDef) {
              props.push(propDef);
            }
          }
        }
      }

      // Handle intersection types (extends other types)
      if (t.isTSIntersectionType(typeAnnotation)) {
        for (const type of typeAnnotation.types) {
          if (t.isTSTypeLiteral(type)) {
            for (const member of type.members) {
              if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
                const propDef = extractPropDefinition(member);
                if (propDef) {
                  props.push(propDef);
                }
              }
            }
          }
        }
      }

      if (props.length > 0) {
        result = {
          name,
          props,
          line: path.node.loc?.start.line ?? 0,
        };
      }
    },
  });

  return result;
}

/**
 * Extract single prop definition from TSPropertySignature
 */
function extractPropDefinition(prop: t.TSPropertySignature): PropDefinition | null {
  if (!t.isIdentifier(prop.key)) return null;

  const name = prop.key.name;
  const optional = prop.optional ?? false;
  let type = 'unknown';
  let isBoolean = false;
  let unionValues: string[] | undefined;

  if (prop.typeAnnotation && t.isTSTypeAnnotation(prop.typeAnnotation)) {
    const typeNode = prop.typeAnnotation.typeAnnotation;
    type = extractTypeString(typeNode);
    isBoolean = t.isTSBooleanKeyword(typeNode);

    // Extract union values
    if (t.isTSUnionType(typeNode)) {
      unionValues = typeNode.types
        .filter((t): t is t.TSLiteralType => t.type === 'TSLiteralType')
        .map((literal) => {
          if (t.isStringLiteral(literal.literal)) {
            return literal.literal.value;
          }
          return null;
        })
        .filter((v): v is string => v !== null);
    }
  }

  // Extract JSDoc comment if present
  const description = extractLeadingComment(prop);

  return {
    name,
    type,
    optional,
    isBoolean,
    unionValues: unionValues?.length ? unionValues : undefined,
    description,
  };
}

/**
 * Convert TypeScript type node to string representation
 */
function extractTypeString(typeNode: t.TSType): string {
  if (t.isTSStringKeyword(typeNode)) return 'string';
  if (t.isTSNumberKeyword(typeNode)) return 'number';
  if (t.isTSBooleanKeyword(typeNode)) return 'boolean';
  if (t.isTSAnyKeyword(typeNode)) return 'any';
  if (t.isTSVoidKeyword(typeNode)) return 'void';
  if (t.isTSNullKeyword(typeNode)) return 'null';
  if (t.isTSUndefinedKeyword(typeNode)) return 'undefined';

  if (t.isTSTypeReference(typeNode) && t.isIdentifier(typeNode.typeName)) {
    return typeNode.typeName.name;
  }

  if (t.isTSUnionType(typeNode)) {
    return typeNode.types.map(extractTypeString).join(' | ');
  }

  if (t.isTSArrayType(typeNode)) {
    return `${extractTypeString(typeNode.elementType)}[]`;
  }

  if (t.isTSLiteralType(typeNode)) {
    if (t.isStringLiteral(typeNode.literal)) {
      return `'${typeNode.literal.value}'`;
    }
    if (t.isNumericLiteral(typeNode.literal)) {
      return String(typeNode.literal.value);
    }
    if (t.isBooleanLiteral(typeNode.literal)) {
      return String(typeNode.literal.value);
    }
  }

  if (t.isTSFunctionType(typeNode)) {
    return '(...args: any[]) => any';
  }

  return 'unknown';
}

/**
 * Extract leading comment from node
 */
function extractLeadingComment(node: t.Node): string | undefined {
  const comments = node.leadingComments;
  if (!comments || comments.length === 0) return undefined;

  const lastComment = comments[comments.length - 1];
  if (lastComment.type === 'CommentBlock') {
    // Clean JSDoc comment
    return lastComment.value
      .replace(/^\*\s*/gm, '')
      .replace(/\n\s*\*/g, '\n')
      .trim();
  }

  return lastComment.value.trim();
}

/**
 * Extract CVA variants from cva() call
 */
function extractCvaVariants(ast: t.File): CvaVariantInfo[] {
  const variants: CvaVariantInfo[] = [];

  traverse(ast, {
    CallExpression(path) {
      // Look for cva(...) calls
      if (!t.isIdentifier(path.node.callee) || path.node.callee.name !== 'cva') {
        return;
      }

      // Second argument contains variants config
      const configArg = path.node.arguments[1];
      if (!t.isObjectExpression(configArg)) return;

      // Find variants property
      const variantsProp = configArg.properties.find(
        (p): p is t.ObjectProperty => t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === 'variants',
      );

      if (!variantsProp || !t.isObjectExpression(variantsProp.value)) return;

      // Find defaultVariants property
      const defaultVariantsProp = configArg.properties.find(
        (p): p is t.ObjectProperty =>
          t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === 'defaultVariants',
      );

      const defaultVariants: Record<string, string> = {};
      if (defaultVariantsProp && t.isObjectExpression(defaultVariantsProp.value)) {
        for (const prop of defaultVariantsProp.value.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && t.isStringLiteral(prop.value)) {
            defaultVariants[prop.key.name] = prop.value.value;
          }
        }
      }

      // Extract each variant
      for (const prop of variantsProp.value.properties) {
        if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;
        if (!t.isObjectExpression(prop.value)) continue;

        const variantName = prop.key.name;
        const values: string[] = [];

        for (const valueProp of prop.value.properties) {
          if (t.isObjectProperty(valueProp) && t.isIdentifier(valueProp.key)) {
            values.push(valueProp.key.name);
          }
        }

        variants.push({
          name: variantName,
          values,
          defaultValue: defaultVariants[variantName],
        });
      }
    },
  });

  return variants;
}

/**
 * Check if file has SampleDefault export (new format) or sampleRender export (legacy)
 */
function hasSampleRenderExport(ast: t.File): boolean {
  let found = false;

  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        if (t.isVariableDeclaration(path.node.declaration)) {
          const hasNewFormat = path.node.declaration.declarations.some(
            (d) => t.isIdentifier(d.id) && d.id.name === 'SampleDefault',
          );
          const hasLegacyFormat = path.node.declaration.declarations.some(
            (d) => t.isIdentifier(d.id) && d.id.name === 'sampleRender',
          );
          if (hasNewFormat || hasLegacyFormat) {
            found = true;
            path.stop();
          }
        }

        if (
          t.isFunctionDeclaration(path.node.declaration) &&
          (path.node.declaration.id?.name === 'SampleDefault' || path.node.declaration.id?.name === 'sampleRender')
        ) {
          found = true;
          path.stop();
        }
      }

      // Check specifiers for both new and legacy formats
      if (
        path.node.specifiers.some(
          (s) =>
            t.isExportSpecifier(s) &&
            t.isIdentifier(s.exported) &&
            (s.exported.name === 'SampleDefault' || s.exported.name === 'sampleRender'),
        )
      ) {
        found = true;
        path.stop();
      }
    },
  });

  return found;
}

/**
 * Check if file has Sample* variants (new format) or sampleRenderers export (legacy)
 * Returns true if there are any Sample* exports besides SampleDefault
 */
function hasSampleRenderersExport(ast: t.File): boolean {
  let found = false;

  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        if (t.isVariableDeclaration(path.node.declaration)) {
          // Check for new Sample* format (any Sample* except SampleDefault)
          const hasNewFormat = path.node.declaration.declarations.some(
            (d) => t.isIdentifier(d.id) && d.id.name.startsWith('Sample') && d.id.name !== 'SampleDefault',
          );
          // Check for legacy sampleRenderers format
          const hasLegacyFormat = path.node.declaration.declarations.some(
            (d) => t.isIdentifier(d.id) && d.id.name === 'sampleRenderers',
          );
          if (hasNewFormat || hasLegacyFormat) {
            found = true;
            path.stop();
          }
        }
      }

      // Check specifiers for both formats
      if (
        path.node.specifiers.some(
          (s) =>
            t.isExportSpecifier(s) &&
            t.isIdentifier(s.exported) &&
            ((s.exported.name.startsWith('Sample') && s.exported.name !== 'SampleDefault') ||
              s.exported.name === 'sampleRenderers'),
        )
      ) {
        found = true;
        path.stop();
      }
    },
  });

  return found;
}

/**
 * Extract all export names from AST
 */
function extractExports(ast: t.File): string[] {
  const exports: string[] = [];

  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        if (t.isVariableDeclaration(path.node.declaration)) {
          for (const decl of path.node.declaration.declarations) {
            if (t.isIdentifier(decl.id)) {
              exports.push(decl.id.name);
            }
          }
        }

        if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
          exports.push(path.node.declaration.id.name);
        }

        if (t.isClassDeclaration(path.node.declaration) && path.node.declaration.id) {
          exports.push(path.node.declaration.id.name);
        }

        if (t.isTSInterfaceDeclaration(path.node.declaration) || t.isTSTypeAliasDeclaration(path.node.declaration)) {
          exports.push(path.node.declaration.id.name);
        }
      }

      for (const spec of path.node.specifiers) {
        if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
          exports.push(spec.exported.name);
        }
      }
    },

    ExportDefaultDeclaration(path) {
      exports.push('default');

      if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
        exports.push(path.node.declaration.id.name);
      }

      if (t.isClassDeclaration(path.node.declaration) && path.node.declaration.id) {
        exports.push(path.node.declaration.id.name);
      }
    },
  });

  return [...new Set(exports)];
}

/**
 * Analyze a React component file
 */
export async function analyzeComponent(filePath: string): Promise<ComponentAnalysis> {
  const { ast, absolutePath } = await readAndParseFile(filePath);

  const componentName = extractComponentName(absolutePath);
  const componentContext = toKebabCase(componentName);

  // Extract props interface
  const propsInterface = extractPropsInterface(ast, componentName);

  // Extract CVA variants
  const cvaVariants = extractCvaVariants(ast);

  // Find all JSX elements
  const jsxElements = findAllJSXElements(ast);

  // Find interactive elements
  const interactiveElements = findInteractiveElements(
    jsxElements.map(({ element }) => ({ element })),
    componentContext,
  );

  // Check for existing sample renders
  const hasSampleRender = hasSampleRenderExport(ast);
  const hasSampleRenderers = hasSampleRenderersExport(ast);

  // Check for existing test file
  const testFilePath = absolutePath.replace(/\.(tsx?)$/, '.test.$1');
  let hasTestFile = false;
  try {
    await fs.access(testFilePath);
    hasTestFile = true;
  } catch {
    // Test file doesn't exist
  }

  // Extract exports
  const exports = extractExports(ast);

  return {
    filePath: absolutePath,
    componentName,
    propsInterface,
    cvaVariants,
    interactiveElements,
    hasSampleRender,
    hasSampleRenderers,
    hasTestFile,
    exports,
  };
}

/**
 * Analyze multiple component files
 */
export async function analyzeComponents(filePaths: string[]): Promise<ComponentAnalysis[]> {
  const results = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        return await analyzeComponent(filePath);
      } catch (error) {
        console.error(`Failed to analyze ${filePath}:`, error); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        return null;
      }
    }),
  );

  return results.filter((r): r is ComponentAnalysis => r !== null);
}

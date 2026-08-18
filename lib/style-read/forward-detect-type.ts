/**
 * @file A1 forward-detector — Step 2, type/LSP corroboration (HYP-1229).
 *
 * Accessed via: `forward-detect.ts`'s `detectForwarding`, ONLY when the AST render-body trace
 * (step 1, the primary/unconditional signal) came back `low` confidence — this step never runs
 * when step 1 is already `high` (cost control: `ts.createProgram` is uncached and 300ms-2s cold,
 * see the HYP-1229 plan §0 "cost ordering backwards" finding).
 *
 * Deliberately independent of `lib/component-props/extract-props-types.ts`: that module's
 * `propsType.getProperties()` call, when `propsType` is a union, returns only properties common
 * to EVERY constituent arm (TS's apparent-type algorithm for unions) — reusing it here would
 * silently reintroduce the exact regression the revised A1 plan exists to avoid (a
 * `className`-only-on-one-arm discriminated-union component misread as high-confidence NOT
 * forwarding). `typeDeclaresProp` below only ever calls `Type.getProperty(name)` on a union's
 * INDIVIDUAL arms (via recursion), never on the raw union type itself.
 *
 * This step is corroboration-only: it may upgrade a `low` trace to `high` POSITIVE when the type
 * conclusively declares the channel; it must NEVER downgrade a trace or manufacture an exclusion
 * — see `forward-detect.ts`'s `maybeCorroborateWithType`, the sole caller.
 *
 * Realm-scoped like `extract-props-types.ts`: reads real files off disk via `ts.createProgram`
 * (`ts.sys`), not through the `FileIO` abstraction the rest of A1 uses — so this step is a no-op
 * (`unknown`) for any file that only exists in an in-memory/virtual FileIO (tests use
 * `skipTypeCorroboration` to avoid paying the cold-start cost for fixtures that don't need it).
 *
 * A shared `ts.LanguageService` cache across calls is a tracked follow-up (HYP-1233), not built
 * here — until it lands, `StyleReadService.ts`'s interactive read-path call passes
 * `skipTypeCorroboration: true` (a live cold-start cost on element selection was caught there in
 * review), so this step currently has no LIVE caller at all (the write-path pre-check,
 * `style-forwarding-check.ts`, still uses its own older, coarser check — HYP-1235 tracks
 * rewiring it onto this detector). It's exercised by tests today and ready for both callers.
 */
import ts from 'typescript';
import { findAndLoadTsConfig } from '../component-props/extract-props-types';

export type TypeCorroborationVerdict = 'declared' | 'not-declared' | 'unknown';

/**
 * Does `componentName`'s declared props type (found by name in `filePath`) declare `propName`?
 * For a union props type, ALL arms must independently declare it — see the file header.
 * Never throws: any resolution failure (file not on disk, no matching declaration, parse error)
 * returns `'unknown'`, which the caller treats identically to `'not-declared'` (never excludes).
 */
export function corroborateChannelViaType(
  filePath: string,
  componentName: string,
  propName: string,
): TypeCorroborationVerdict {
  try {
    const resolved = findComponentPropsType(filePath, componentName);
    if (!resolved) return 'unknown';
    return typeDeclaresProp(resolved.type, propName) ? 'declared' : 'not-declared';
  } catch {
    return 'unknown';
  }
}

interface ResolvedPropsType {
  type: ts.Type;
}

/** Locate `componentName`'s declared props type via a fresh, uncached TS program. */
function findComponentPropsType(filePath: string, componentName: string): ResolvedPropsType | null {
  const compilerOptions = findAndLoadTsConfig(filePath);
  const program = ts.createProgram([filePath], compilerOptions);
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return null;

  const checker = program.getTypeChecker();
  let found: ts.Type | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    found = tryExtractPropsTypeFromNode(node, componentName, checker);
    if (found) return;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found ? { type: found } : null;
}

function tryExtractPropsTypeFromNode(node: ts.Node, componentName: string, checker: ts.TypeChecker): ts.Type | null {
  if (ts.isFunctionDeclaration(node) && node.name?.text === componentName) {
    return propsTypeFromParams(node.parameters, checker);
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === componentName) {
    return propsTypeFromVariableDeclarator(node, checker);
  }
  return null;
}

function propsTypeFromParams(params: ts.NodeArray<ts.ParameterDeclaration>, checker: ts.TypeChecker): ts.Type | null {
  const first = params[0];
  if (!first?.type) return null;
  return checker.getTypeFromTypeNode(first.type);
}

/** `const X: FC<Props> = ...` / `const X = (props: Props) => ...` / `const X = forwardRef<E, Props>(...)`. */
function propsTypeFromVariableDeclarator(decl: ts.VariableDeclaration, checker: ts.TypeChecker): ts.Type | null {
  const fromAnnotation = propsTypeFromFcAnnotation(decl.type, checker);
  if (fromAnnotation) return fromAnnotation;

  const init = decl.initializer;
  if (init && ts.isArrowFunction(init)) {
    const fromParams = propsTypeFromParams(init.parameters, checker);
    if (fromParams) return fromParams;
  }
  if (init && ts.isCallExpression(init) && isForwardRefCall(init.expression)) {
    return propsTypeFromForwardRefCall(init, checker);
  }
  return null;
}

function propsTypeFromFcAnnotation(typeNode: ts.TypeNode | undefined, checker: ts.TypeChecker): ts.Type | null {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return null;
  const name = typeNode.typeName;
  const isFc =
    (ts.isIdentifier(name) && (name.text === 'FC' || name.text === 'FunctionComponent')) ||
    (ts.isQualifiedName(name) && (name.right.text === 'FC' || name.right.text === 'FunctionComponent'));
  const args = typeNode.typeArguments;
  return isFc && args?.length ? checker.getTypeFromTypeNode(args[0]) : null;
}

function propsTypeFromForwardRefCall(call: ts.CallExpression, checker: ts.TypeChecker): ts.Type | null {
  if (call.typeArguments && call.typeArguments.length >= 2) {
    return checker.getTypeFromTypeNode(call.typeArguments[1]);
  }
  const callback = call.arguments[0];
  return callback && ts.isArrowFunction(callback) ? propsTypeFromParams(callback.parameters, checker) : null;
}

function isForwardRefCall(expr: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expr) && expr.text === 'forwardRef') ||
    (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name) && expr.name.text === 'forwardRef')
  );
}

/**
 * Does `type` declare `propName`? For a union, EVERY arm must — computed by recursing into each
 * arm individually and calling `Type.getProperty` there, never on the union type itself (see the
 * file header — that's the exact operation that collapses to "properties common to all arms").
 * For an intersection, ANY member declaring it is sufficient (an intersection widens, not narrows).
 */
function typeDeclaresProp(type: ts.Type, propName: string): boolean {
  if (type.isUnion()) return type.types.every((arm) => typeDeclaresProp(arm, propName));
  if (type.isIntersection()) return type.types.some((part) => typeDeclaresProp(part, propName));
  return !!type.getProperty(propName);
}

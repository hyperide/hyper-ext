/** Narrow AST proof: a configured top-level binding, static table name, runtime ID, named fields.
 * Not a general TypeScript/React compiler. Uses the TS checker to distinguish shadowed identifiers.
 */
import { createRequire } from 'node:module';
// The site owns the pinned compiler dependency used by this experiment and its gate.
const require = createRequire(new URL('../../site/package.json', import.meta.url));
const ts = require('typescript');
export function compileAccess(code, binding = 'store') {
  const file = '/__state_access__.ts',
    options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, noLib: true };
  const host = ts.createCompilerHost(options),
    original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) =>
    name === file ? ts.createSourceFile(file, code, version, true) : original(name, version, ...rest);
  const program = ts.createProgram([file], options, host),
    source = program.getSourceFile(file),
    checker = program.getTypeChecker();
  if (source.parseDiagnostics.length)
    throw new SyntaxError(ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, '\n'));
  let root;
  for (const st of source.statements) {
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === binding) root = checker.getSymbolAtLocation(d.name);
    if (
      ts.isImportDeclaration(st) &&
      st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings)
    )
      for (const item of st.importClause.namedBindings.elements)
        if (item.name.text === binding) root = checker.getSymbolAtLocation(item.name);
  }
  if (!root) throw new Error(`Declare or import top-level ${binding}; implicit global bindings are refused`);
  const isTransparent = (node) =>
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node));
  const unpack = (node) => {
    const steps = [];
    let n = node;
    while (isTransparent(n)) n = n.expression;
    while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      if (n.questionDotToken) return null;
      steps.unshift(ts.isPropertyAccessExpression(n) ? { field: n.name.text } : { index: n.argumentExpression });
      n = n.expression;
      while (isTransparent(n)) n = n.expression;
    }
    if (
      !ts.isIdentifier(n) ||
      checker.getSymbolAtLocation(n) !== root ||
      steps[0]?.field !== 'state' ||
      !steps[1]?.field ||
      !steps[2]?.index
    )
      return null;
    if (steps.slice(3).some((s) => !s.field))
      throw new Error('Dynamic field paths need a separately designed fallback');
    return { root: n, table: steps[1].field, id: steps[2].index, path: steps.slice(3).map((s) => s.field) };
  };
  const result = ts.transform(source, [
    (ctx) => {
      const f = ctx.factory;
      const call = (p, method) =>
        f.createCallExpression(f.createPropertyAccessExpression(p.root, method), undefined, [
          f.createStringLiteral(p.table),
          ts.visitNode(p.id, visit),
          f.createArrayLiteralExpression(p.path.map((v) => f.createStringLiteral(v))),
        ]);
      const visit = (node) => {
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const p = unpack(node.left);
          if (p) {
            if (!p.path.length) throw new Error('Cannot assign entity identity through the table');
            return f.updateBinaryExpression(
              node,
              f.createPropertyAccessExpression(call(p, '$ref'), 'value'),
              node.operatorToken,
              ts.visitNode(node.right, visit),
            );
          }
        }
        if (
          (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
        ) {
          const p = unpack(node.operand);
          if (p) {
            const target = f.createPropertyAccessExpression(call(p, '$ref'), 'value');
            return ts.isPrefixUnaryExpression(node)
              ? f.updatePrefixUnaryExpression(node, target)
              : f.updatePostfixUnaryExpression(node, target);
          }
        }
        if (ts.isDeleteExpression(node) && unpack(node.expression))
          throw new Error('Use store.remove for entity deletion');
        if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && unpack(node.initializer))
          throw new Error('Loop assignment targets are not supported');
        // Visit inside wrappers so callee detection retains the original parent chain.
        if (isTransparent(node)) return ts.visitEachChild(node, visit, ctx);
        const p = unpack(node);
        if (p) {
          let target = node;
          while (isTransparent(target.parent)) target = target.parent;
          const parent = target.parent;
          // A callee must stay a member reference so JavaScript supplies its receiver.
          if (
            p.path.length &&
            ((ts.isCallExpression(parent) && parent.expression === target) ||
              (ts.isTaggedTemplateExpression(parent) && parent.tag === target))
          ) {
            return f.createPropertyAccessExpression(call({ ...p, path: p.path.slice(0, -1) }, '$read'), p.path.at(-1));
          }
          return call(p, '$read');
        }
        return ts.visitEachChild(node, visit, ctx);
      };
      return (n) => ts.visitNode(n, visit);
    },
  ]);
  const printed = ts.createPrinter().printFile(result.transformed[0]);
  result.dispose();
  return ts.transpileModule(printed, { compilerOptions: options }).outputText;
}

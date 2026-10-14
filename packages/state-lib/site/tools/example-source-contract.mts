import ts from 'typescript';
/** Check source identity structurally; never execute a documentation expression. */
export function isExampleBackedSource(body: string, exampleId: string): boolean {
  const expression = body.trim().replace(/^\{([\s\S]*)\}$/, '$1');
  const file = ts.createSourceFile('example.ts', `const value = ${expression};`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  if (
    file.statements.length !== 1 ||
    !statement ||
    !ts.isVariableStatement(statement) ||
    statement.declarationList.declarations.length !== 1
  )
    return false;
  const root = statement.declarationList.declarations[0]?.initializer;
  let references = 0;
  const visit = (node: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return visit(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return !node.text.trim();
    if (ts.isPropertyAccessExpression(node) && ['code', 'setup', 'ui'].includes(node.name.text)) {
      let receiver: ts.Expression = node.expression;
      if (ts.isNonNullExpression(receiver)) receiver = receiver.expression;
      if (
        !ts.isCallExpression(receiver) ||
        !ts.isIdentifier(receiver.expression) ||
        receiver.expression.text !== 'exampleById'
      )
        return false;
      const argument = receiver.arguments[0];
      if (receiver.arguments.length !== 1 || !argument || !ts.isStringLiteral(argument) || argument.text !== exampleId)
        return false;
      references++;
      return true;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return visit(node.left) && visit(node.right);
    if (ts.isTemplateExpression(node))
      return (
        !node.head.text.trim() &&
        node.templateSpans.every((part) => !part.literal.text.trim() && visit(part.expression))
      );
    return false;
  };
  return !!root && visit(root) && references > 0;
}

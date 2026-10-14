import ts from 'typescript';

/** Inherited library members are useful; JS/TS standard prototypes are not our API. */
export function isPublicApiMember(symbol: ts.Symbol, program: ts.Program): boolean {
  return (symbol.getDeclarations() ?? []).some(
    (declaration) => !program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
  );
}

/** Preserve the actual declaration, including union alternatives and generic constraints. */
export function apiTypeDefinition(
  name: string,
  declaration: ts.Declaration,
  type: ts.Type,
  checker: ts.TypeChecker,
): string {
  if (ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
    return declaration.getText().replace(/^export\s+/, '');
  }
  return `type ${name} = ${checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation)}`;
}

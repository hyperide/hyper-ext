import ts from 'typescript';

/** Public names come from declarations, never TypeScript's per-program symbol IDs. */
export function apiSymbolName(symbol: ts.Symbol): string {
  const declarations = symbol.getDeclarations() ?? [];
  const declarationNames = declarations
    .map((declaration) => ts.getNameOfDeclaration(declaration))
    .filter((name): name is ts.DeclarationName => !!name);
  // Computed `[Symbol.x]` members carry the checker's `__@x@N` identity at
  // runtime; the declaration text is the stable public spelling.
  const computed = declarationNames.find(ts.isComputedPropertyName);
  if (computed) return computed.getText();
  const name = symbol.getName();
  if (/^__@.+@\d+$/.test(name)) {
    // An ordinary member spelled like a compiler ID (`"__@iterator@999"`) is
    // real API, not an allocation artifact: accept only a declaration whose
    // literal value IS this name, rather than trusting the name alone.
    const declaresThisName = declarationNames.some(
      (candidate) => ts.isStringLiteralLike(candidate) && candidate.text === name,
    );
    if (!declaresThisName) {
      throw new Error(`Cannot emit an unstable compiler symbol without a named declaration: ${name}`);
    }
  }
  return name;
}

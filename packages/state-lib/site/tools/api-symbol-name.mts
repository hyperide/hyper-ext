import ts from 'typescript';

/** Public names come from declarations, never TypeScript's per-program symbol IDs. */
export function apiSymbolName(symbol: ts.Symbol): string {
  for (const declaration of symbol.getDeclarations() ?? []) {
    const name = (declaration as ts.NamedDeclaration).name;
    if (name && ts.isComputedPropertyName(name)) return name.getText();
  }
  const name = symbol.getName();
  if (/^__@.+@\d+$/.test(name)) {
    throw new Error(`Cannot emit an unstable compiler symbol without a named declaration: ${name}`);
  }
  return name;
}

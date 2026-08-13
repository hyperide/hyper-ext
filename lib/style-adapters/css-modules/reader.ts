/**
 * @file CssModulesReader derives CSS Modules source identities from className facts
 *
 * Accessed via: CssModulesAdapter umbrella delegates read() calls here
 * Assumptions: CSS file declaration ownership tracing is a later Phase 7 slice;
 *   this reader exposes class selector tabs from imported module class facts.
 */
import type { FrameworkReadResult, SourceClassIdentity } from '@lib/style-read/types';
import type { FrameworkStyleReader } from '@lib/style-write/types';

export class CssModulesReader implements FrameworkStyleReader {
  /**
   * Read entry: turn each CSS-Modules class reference on the element
   * (`className={styles.foo}`) into a source-class identity — one inspector tab per
   * imported module class, carrying the `.css` file path, selector, and import binding the
   * write router needs to locate the rule. No declaration values are read yet (Phase 7).
   */
  read(input: Parameters<FrameworkStyleReader['read']>[0]): FrameworkReadResult {
    const references = input.elementFacts.classNameExpression?.cssModuleReferences ?? [];
    const classIdentities: SourceClassIdentity[] = references.map((reference) => ({
      sourceTabId: `css-modules:${reference.classKey}`,
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      label: reference.selector,
      filePath: reference.cssFilePath,
      cssSyntax: reference.cssSyntax,
      selector: reference.selector,
      classKey: reference.classKey,
      sourceRef: {
        importLocalName: reference.importLocalName,
        importSource: reference.importSource,
        expressionPath: reference.expressionPath,
      },
      condition: { state: 'base' },
      confidence: 'exact',
    }));

    return {
      sourceOwners: [],
      values: {},
      classIdentities,
      conditions: classIdentities.map((identity) => identity.condition),
    };
  }
}

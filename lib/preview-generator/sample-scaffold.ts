/**
 * @file Builds deterministic Sample* scaffolds for component preview files.
 *
 * Accessed via: VS Code preview error overlay > Create Sample
 * Assumptions: generated samples are appended to the same source file as the component.
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { scanRenderableExportNames } from './scanner';

export interface SampleScaffoldConfig {
  sourceCode: string;
  componentName: string;
  exportName: string;
  propEntries: Array<[string, unknown]>;
}

function isValidJsxComponentName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value);
}

function toPascalIdentifier(value: string): string {
  const words = value
    .replace(/\.[jt]sx?$/i, '')
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean);
  const identifier = words
    .map((word) => {
      const first = word.charAt(0);
      return `${first.toUpperCase()}${word.slice(1)}`;
    })
    .join('');
  if (!identifier) return 'Component';
  return /^[A-Za-z_$]/.test(identifier) ? identifier : `Component${identifier}`;
}

export function normalizeSampleComponentName(componentName: string): string {
  // Strip a trailing source-file extension before the validity check. A bare
  // filename like `ConlocaLogo.tsx` matches isValidJsxComponentName (the regex
  // permits dotted member expressions, e.g. `Accordion.Item`), so without this
  // it would early-return verbatim and leak `.tsx` into the JSX tag name
  // (`<ConlocaLogo.tsx />`). A real member expression has no file-ext suffix,
  // so it is left untouched.
  const withoutExtension = componentName.replace(/\.(?:tsx?|jsx?|mjs|cjs)$/i, '');
  if (isValidJsxComponentName(withoutExtension) && /^[A-Z]/.test(withoutExtension)) return withoutExtension;
  const fileName = componentName.split(/[\\/]/).pop() ?? componentName;
  const candidate = toPascalIdentifier(fileName);
  return isValidJsxComponentName(candidate) ? candidate : 'Component';
}

export function buildSampleScaffold({
  sourceCode,
  componentName,
  exportName,
  propEntries,
}: SampleScaffoldConfig): string {
  const jsxComponentName = normalizeSampleComponentName(componentName);
  // An explicit `children` entry becomes real JSX children, not a `children={...}`
  // attribute -- emitting both produced a duplicate `children` key (HYP-1399 P1).
  const explicitChildrenEntry = propEntries.find(([key]) => key === 'children');
  const attributeEntries = propEntries.filter(([key]) => key !== 'children');
  const propLines = attributeEntries.map(([key, value]) => serializePropLine(key, value));
  // HYP-1399: children synthesis used to be skipped whenever ANY prop was present
  // (`propLines.length === 0 ? ... : []`), so a Button/Alert/etc. with props but no
  // explicit children rendered self-closing and visually empty. Only whether the
  // component actually accepts children matters now, regardless of prop count -- and
  // that check applies to explicit children too: a void/textarea/select component must
  // not get a `children` value forced onto it (same crash the guard exists to prevent),
  // so an explicit `children` entry for one of those falls through to buildVisibleChildLines,
  // which independently re-derives the same "doesn't accept children" answer and emits [].
  const childLines =
    explicitChildrenEntry && componentAcceptsChildren(sourceCode, jsxComponentName)
      ? [`    {${serializePropValue(explicitChildrenEntry[1])}}`]
      : buildVisibleChildLines(sourceCode, jsxComponentName);

  return buildScaffold(jsxComponentName, exportName, propLines, childLines);
}

export function buildDeterministicContainerSampleScaffold({
  sourceCode,
  componentName,
  exportName,
}: Omit<SampleScaffoldConfig, 'propEntries'>): string | null {
  const jsxComponentName = normalizeSampleComponentName(componentName);
  const childLines = buildCompoundChildLines(sourceCode, jsxComponentName);
  if (childLines.length === 0) return null;
  return buildScaffold(jsxComponentName, exportName, [], childLines);
}

/**
 * JSX expression body (no `export const Sample = …` wrapper) plus the list of
 * component identifiers it references. Used by the preview generator to embed
 * a synthetic SampleDefault inline in the generated __canvas_preview__.tsx
 * for compound shadcn-style modules that don't ship their own SampleDefault.
 */
export interface ContainerSampleJsxBody {
  /** Multi-line JSX expression, e.g. "<Alert>\n  <AlertTitle>…</AlertTitle>\n</Alert>" */
  body: string;
  /** All component identifiers referenced in `body`, in source order. */
  referencedNames: string[];
}

export function buildContainerSampleJsxBody({
  sourceCode,
  componentName,
}: Omit<SampleScaffoldConfig, 'propEntries' | 'exportName'>): ContainerSampleJsxBody | null {
  const jsxComponentName = normalizeSampleComponentName(componentName);
  const childLines = buildCompoundChildLines(sourceCode, jsxComponentName);
  if (childLines.length === 0) return null;

  const lines = [`<${jsxComponentName}>`, ...childLines, `</${jsxComponentName}>`];

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const line of lines) {
    const matches = line.match(/<\/?\s*([A-Z][\w]*)/g) ?? [];
    for (const raw of matches) {
      const name = raw.replace(/<\/?\s*/, '');
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
  }

  return { body: lines.join('\n'), referencedNames: ordered };
}

function buildScaffold(
  jsxComponentName: string,
  exportName: string,
  propLines: string[],
  childLines: string[],
): string {
  if (childLines.length > 0) {
    // The opening tag must be closed with `>` before children start; with propLines
    // present that lands after the last attribute line rather than on the tag itself
    // (HYP-1399: props + children together used to be unreachable, so this path was
    // never exercised before).
    const openingLines =
      propLines.length > 0
        ? [`  <${jsxComponentName}`, ...propLines.slice(0, -1), `${propLines[propLines.length - 1]} >`]
        : [`  <${jsxComponentName}>`];
    return [
      '',
      '// Sample component for preview',
      `export const ${exportName} = () => (`,
      ...openingLines,
      ...childLines,
      `  </${jsxComponentName}>`,
      ');',
    ].join('\n');
  }

  return [
    '',
    '// Sample component for preview',
    `export const ${exportName} = () => (`,
    `  <${jsxComponentName}`,
    ...propLines,
    '  />',
    ');',
  ].join('\n');
}

function serializePropLine(key: string, value: unknown): string {
  const serializedValue = serializePropValue(value);
  if (!isValidJsxAttributeName(key)) return `    {...{${JSON.stringify(key)}:${serializedValue}}}`;
  return `    ${key}={${serializedValue}}`;
}

function serializePropValue(value: unknown): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  // Function-typed sample values (e.g. onClick) must emit an executable no-op
  // arrow, not a stringified function body — otherwise the prop is a string and
  // calling it throws at runtime.
  if (typeof value === 'function') return '() => {}';
  if (value === null) return 'null';
  // Recurse manually instead of JSON.stringify so nested functions survive as
  // real arrows (JSON.stringify drops them, producing actions={{}} that crashes
  // on actions.onSave()).
  if (Array.isArray(value)) return `[${value.map(serializePropValue).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${serializePropValue(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function isValidJsxAttributeName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function buildVisibleChildLines(sourceCode: string, componentName: string): string[] {
  // Must check componentAcceptsChildren (void/textarea/select guard) BEFORE compound
  // children, not just before the plain-text fallback -- compound children are children
  // too. Checking it after let a void wrapper (`Input`) with a same-file sibling
  // (`InputLabel`) get that sibling spliced in as JSX children regardless (HYP-1399 P1).
  if (!componentAcceptsChildren(sourceCode, componentName)) return [];
  const compoundChildren = buildCompoundChildLines(sourceCode, componentName);
  if (compoundChildren.length > 0) return compoundChildren;
  return ['    Sample content'];
}

function buildCompoundChildLines(sourceCode: string, componentName: string): string[] {
  const exportedNames = scanRenderableExportNames(sourceCode);
  // Known compound-part suffixes ordered by visual layout (header/body/footer +
  // common shadcn primitives). Unknown PascalCase suffixes (e.g. RootProvider,
  // SubMenu) are still included — appended after the known ones, in source
  // order — so shadcn-style modules like `carousel.tsx` (Item/Previous/Next)
  // get a useful scaffold instead of being dropped on the floor.
  const suffixPriority = [
    'Header',
    'Title',
    'Description',
    'Trigger',
    'List',
    'Content',
    'Body',
    'Text',
    'Item',
    'Action',
    'Cancel',
    'Previous',
    'Next',
    'Footer',
    'Label',
  ];

  const candidates = exportedNames
    .filter((name) => name !== componentName && name.startsWith(componentName))
    .map((name, index) => ({ name, suffix: name.slice(componentName.length), index }))
    .filter(({ suffix }) => /^[A-Z][\w$]*$/.test(suffix));

  candidates.sort((a, b) => {
    const ai = suffixPriority.indexOf(a.suffix);
    const bi = suffixPriority.indexOf(b.suffix);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.index - b.index;
  });

  return candidates.map(({ name, suffix }) => `    <${name}>${sampleTextForSuffix(suffix)}</${name}>`);
}

function sampleTextForSuffix(suffix: string): string {
  if (suffix === 'Title' || suffix === 'Header') return 'Preview title';
  if (suffix === 'Description') return 'This sample shows the component with visible content.';
  if (suffix === 'Footer') return 'Preview footer';
  if (suffix === 'Label') return 'Preview label';
  if (suffix === 'Trigger') return 'Open';
  if (suffix === 'Item') return 'Sample item';
  if (suffix === 'Previous') return 'Prev';
  if (suffix === 'Next') return 'Next';
  if (suffix === 'Action') return 'Action';
  if (suffix === 'Cancel') return 'Cancel';
  return 'Sample content';
}

/**
 * Matches the generic-argument spelling (`HTMLAttributes<HTMLXxxElement>`) for DOM
 * interfaces whose content is not a text child: void elements (React throws if given
 * children, HYP-1367) plus textarea/select (controlled via value/defaultValue). No
 * leading `\b`, so it also matches the specialized spelling as a substring (e.g.
 * `InputHTMLAttributes<HTMLInputElement>`) -- intentional, not accidental (HYP-1399).
 * Names are copied from ComponentService.ts's `VOID_DOM_ELEMENT_TYPE_NAMES` (14) +
 * `NON_TEXT_CHILDREN_DOM_ELEMENT_TYPE_NAMES` (2); keep in sync if either changes
 * (no shared source yet, tracked in HYP-1373).
 *
 * KNOWN LIMITATIONS, deliberately accepted (HYP-1373 criterion #2 sanctions this as
 * documented residual risk, not fixed here -- a real fix needs the AST parsing
 * `ComponentService.ts` already does):
 * - Matching runs against the WHOLE file, not just `componentName`'s own declaration, so
 *   an unrelated sibling's type reference can affect this component's result in either
 *   direction (same as the pre-existing positive check below). A regex-only same-file
 *   scoping attempt was tried during review and rejected as order-dependent and worse
 *   than plain whole-file matching.
 * - Text that merely LOOKS like one of these type references -- a comment, a string, an
 *   unrelated identifier -- is indistinguishable from a real one to a plain regex (an
 *   earlier attempt at a comment/string stripper was tried during review and rejected:
 *   its own quote-matching regressed further, e.g. an apostrophe in JSX text like "It's"
 *   opened an unterminated quote span that swallowed real code up to the next quote).
 */
const TEXT_CHILDREN_SUPPRESSING_DOM_SPELLING =
  /HTMLAttributes<\s*(?:HTMLArea|HTMLBase|HTMLBR|HTMLEmbed|HTMLHR|HTMLImage|HTMLInput|HTMLLink|HTMLMeta|HTMLParam|HTMLSource|HTMLTableCol|HTMLTrack|HTMLWBR|HTMLSelect|HTMLTextArea)Element\s*>/;

function componentAcceptsChildren(sourceCode: string, componentName: string): boolean {
  if (TEXT_CHILDREN_SUPPRESSING_DOM_SPELLING.test(sourceCode)) return false;
  if (/\b(?:HTMLAttributes|ButtonHTMLAttributes|AnchorHTMLAttributes)\b/.test(sourceCode)) return true;
  const escaped = componentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propsBlock = new RegExp(`(?:type|interface)\\s+${escaped}Props\\b[\\s\\S]{0,800}\\bchildren\\b`);
  return propsBlock.test(sourceCode);
}

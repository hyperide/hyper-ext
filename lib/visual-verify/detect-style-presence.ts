/**
 * @file Detect whether an app's CSS is actually applied to a rendered page.
 *
 * Accessed via: agent proof/screenshot capture guard, e2e blank-webview guard,
 *   and the product visual-verification subsystem (CSS-not-loaded failure mode).
 * Assumptions: runs framework-light against any DOM `Document` — works in
 *   happy-dom/jsdom tests, inside a headless-Chrome `page.evaluate` context, and
 *   (via the Playwright adapter) against a live `Page`. The core detection
 *   function is self-contained (no closures over module scope) so it can be
 *   string-serialized and shipped into a browser via `page.evaluate`.
 *
 * Why a heuristic, not a single check: an unstyled render (CSS failed to load)
 * has near-zero applied CSS rules AND UA-default computed styles. We combine
 * several independent signals and return them all so a caller can see *why* a
 * page was judged styled or unstyled, rather than trusting one brittle probe.
 */

export interface StyleSheetSignal {
  /** Total <style>/<link> sheets present in document.styleSheets. */
  total: number;
  /** Sheets whose .cssRules we could read (same-origin, not CORS-opaque). */
  readable: number;
  /** Sheets that threw on .cssRules access (cross-origin/opaque) — not counted as applied CSS. */
  opaque: number;
  /** Total CSS rules across all readable sheets. */
  ruleCount: number;
  /** Whether at least one readable sheet has a non-trivial rule count. */
  hasNonTrivialSheet: boolean;
}

export interface ComputedStyleSignal {
  /** Root/body font-family is set to a non-default (not the UA serif/empty) family. */
  rootFontApplied: boolean;
  /** A themed (non-default white/transparent) background is present on root or body. */
  themedBackground: boolean;
  /** Number of sampled control elements (button/input/select/textarea/a) found. */
  controlsSampled: number;
  /** Number of sampled controls that have at least one non-UA-default style. */
  controlsStyled: number;
  /** Number of sampled ordinary descendant containers (div/section/li/p/…). */
  descendantsSampled: number;
  /** Number of sampled descendants with at least one applied (non-UA) style. */
  descendantsStyled: number;
}

export interface AppRootSignal {
  /** Whether a known app-root selector was found. */
  found: boolean;
  /** Whether the found app root has applied (non-default) styling. */
  styled: boolean;
  /** The selector that matched, if any. */
  selector: string | null;
}

export interface StylePresenceSignals {
  styleSheets: StyleSheetSignal;
  computed: ComputedStyleSignal;
  appRoot: AppRootSignal;
}

export interface StylePresenceVerdict {
  /** Final judgement: are the app's styles actually applied? */
  styled: boolean;
  /** 0..1 — how confident the verdict is (distance of weighted score from the decision threshold). */
  confidence: number;
  /** All raw signals, so callers can inspect *why*. */
  signals: StylePresenceSignals;
  /** Human-readable explanation; on failure it names the missing styles. */
  reason: string;
}

export interface DetectStyleOptions {
  /**
   * Extra CSS selectors that identify the app root (e.g. '#root', '[data-app]').
   * Checked in addition to the built-in defaults.
   */
  appRootSelectors?: string[];
  /**
   * Minimum CSS rule count for a single readable sheet to count as "non-trivial".
   * An unstyled page typically has 0; a styled app has dozens-to-hundreds.
   */
  minSheetRules?: number;
}

const DEFAULT_MIN_SHEET_RULES = 6;
const DEFAULT_APP_ROOT_SELECTORS = ['#root', '#app', '[data-app]', 'main', '[data-reactroot]'];

/**
 * UA-default values that indicate NO author CSS was applied. Browsers vary, so
 * we treat the well-known defaults (transparent bg, 0 radius, serif/empty font)
 * as "unstyled" markers and anything else as an applied-style signal.
 */
const UA_DEFAULT_BG = new Set(['rgba(0, 0, 0, 0)', 'transparent', '']);
const UA_DEFAULT_BG_WHITE = new Set(['rgb(255, 255, 255)', '#ffffff', 'white']);
const UA_DEFAULT_RADII = new Set(['0px', '0', '']);

/**
 * The detection core. Pure function of a `Document` (+ options) — no module-scope
 * references — so it is safe to `.toString()` and run inside `page.evaluate`.
 *
 * Exported so tests and the headless-Chrome path can call it directly against a
 * happy-dom / real-browser `document`.
 */
export function computeStylePresence(
  docOrOptions?: Document | DetectStyleOptions,
  maybeOptions?: DetectStyleOptions,
): StylePresenceVerdict {
  // Dual call shapes so this single self-contained function is both directly
  // callable — `computeStylePresence(document, opts)` — AND usable as the page
  // function Playwright serializes and runs via CDP — `page.evaluate(
  // computeStylePresence, opts)`, where the only arg is the options object and
  // the document is the ambient page `document`. Running it AS the evaluated
  // function (no eval, no <script> install) means it works under ANY page CSP,
  // including `script-src 'self'` / hash-only with no reusable nonce.
  const firstIsDoc =
    typeof docOrOptions === 'object' &&
    docOrOptions !== null &&
    'styleSheets' in docOrOptions &&
    typeof (docOrOptions as Document).querySelectorAll === 'function';
  const doc: Document = firstIsDoc
    ? (docOrOptions as Document)
    : (globalThis as unknown as { document: Document }).document;
  const options: DetectStyleOptions | undefined = firstIsDoc
    ? maybeOptions
    : (docOrOptions as DetectStyleOptions | undefined);

  const minSheetRules = options?.minSheetRules ?? 6;
  const builtinRoots = ['#root', '#app', '[data-app]', 'main', '[data-reactroot]'];
  // Caller-supplied selectors come FIRST: a capture script that names the app's
  // real root (or a component root inside #root) knows better than the defaults.
  const appRootSelectors = [...(options?.appRootSelectors ?? []), ...builtinRoots];

  const win = doc.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
  const getCs = (el: Element): CSSStyleDeclaration | null => {
    if (!win || typeof win.getComputedStyle !== 'function') return null;
    try {
      return win.getComputedStyle(el);
    } catch {
      return null;
    }
  };

  // --- Signal 1: document.styleSheets ---
  let total = 0;
  let readable = 0;
  let opaque = 0;
  let ruleCount = 0;
  let hasNonTrivialSheet = false;
  const sheets = doc.styleSheets;
  total = sheets.length;
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    let rules: CSSRuleList | null = null;
    try {
      // Accessing cssRules on a cross-origin (CORS-opaque) sheet throws.
      rules = sheet.cssRules;
    } catch {
      opaque++;
      continue;
    }
    if (rules == null) {
      opaque++;
      continue;
    }
    readable++;
    ruleCount += rules.length;
    if (rules.length >= minSheetRules) hasNonTrivialSheet = true;
  }

  // --- Signal 2: sampled computed styles ---
  const uaTransparent = new Set(['rgba(0, 0, 0, 0)', 'transparent', '']);
  const uaWhite = new Set(['rgb(255, 255, 255)', '#ffffff', 'white']);
  const uaRadii = new Set(['0px', '0', '']);

  const root = doc.documentElement;
  const body = doc.body;

  const isAppliedFont = (cs: CSSStyleDeclaration | null): boolean => {
    if (!cs) return false;
    const ff = (cs.fontFamily || '').trim().toLowerCase();
    // UA default is empty or a bare generic serif. Anything richer = author CSS.
    if (ff === '' || ff === 'serif' || ff === 'times' || ff === 'times new roman') return false;
    return true;
  };

  let rootFontApplied = false;
  for (const el of [body, root]) {
    if (el && isAppliedFont(getCs(el))) {
      rootFontApplied = true;
      break;
    }
  }

  const hasThemedBg = (cs: CSSStyleDeclaration | null): boolean => {
    if (!cs) return false;
    const bg = (cs.backgroundColor || '').trim().toLowerCase();
    if (uaTransparent.has(bg)) return false;
    if (uaWhite.has(bg)) return false; // plain white = effectively unstyled default
    return true;
  };

  let themedBackground = false;
  for (const el of [body, root]) {
    if (el && hasThemedBg(getCs(el))) {
      themedBackground = true;
      break;
    }
  }

  // Sample interactive controls. CAUTION: native UA controls are NOT bland —
  // a bare <button> in real Chromium already has a gray background, ~2px
  // outset border, and small padding; <input>/<select>/<textarea> have white
  // backgrounds and borders. So padding/border-presence/non-transparent-bg are
  // NOT author-style signals. We only count a control as author-styled when it
  // exhibits something UA defaults never produce: a non-zero border-radius, a
  // box-shadow, or a background that is neither transparent, white, nor a known
  // UA button gray.
  const uaButtonGrays = new Set([
    'rgb(239, 239, 239)', // Chromium button face
    'rgb(221, 221, 221)',
    'rgb(240, 240, 240)',
    'rgb(216, 216, 216)',
    'rgb(231, 231, 231)',
    'buttonface',
  ]);
  const controls = Array.from(doc.querySelectorAll('button, input, select, textarea, a[href]')).slice(0, 25);
  let controlsSampled = 0;
  let controlsStyled = 0;
  for (const el of controls) {
    const cs = getCs(el);
    if (!cs) continue;
    controlsSampled++;
    const bg = (cs.backgroundColor || '').trim().toLowerCase();
    const radius = (cs.borderTopLeftRadius || cs.borderRadius || '').trim().toLowerCase();
    const boxShadow = (cs.boxShadow || '').trim().toLowerCase();

    const radiusStyled = !uaRadii.has(radius);
    const shadowStyled = boxShadow !== '' && boxShadow !== 'none';
    // Author background = not transparent, not white, and not a UA button gray.
    const bgStyled = !uaTransparent.has(bg) && !uaWhite.has(bg) && !uaButtonGrays.has(bg);

    if (radiusStyled || shadowStyled || bgStyled) controlsStyled++;
  }

  // Tags the UA gives non-zero spacing by default. Author spacing only counts as
  // applied styling on a tag NOT in the relevant set, otherwise a bare list or
  // paragraph would false-positive a genuinely unstyled page. These are
  // per-property: a tag may have UA margin but zero UA padding (e.g. <p>), so
  // author padding on a <p> still counts even though its margin must not.
  //
  // Why this can't reintroduce the <ul>/<ol> false-positive: ul/ol/menu/dir are
  // in the UA-PADDING set, so their UA 40px inline-start padding is discounted —
  // exactly the case the original padding-exclusion guarded. And ALL UA-margin
  // tags (p, headings, blockquote, figure, lists, dl/dd, fieldset, hr, pre,
  // form, …) are excluded for margin, so UA vertical margins never count either.
  // What now counts is author spacing on tags the UA leaves at zero — a div,
  // section, article, span, nav, etc. — which is the HYP-733 false-negative fix.
  const uaPaddedTags = new Set(['ul', 'ol', 'menu', 'dir']);
  const uaMarginTags = new Set([
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'figure',
    'figcaption',
    'ul',
    'ol',
    'dl',
    'dd',
    'menu',
    'dir',
    'fieldset',
    'hr',
    'pre',
    'form',
  ]);

  // --- Signal 2b: sampled ordinary descendants ---
  // Catch pages whose author CSS lives on plain component containers (e.g. a
  // `.card { display:flex; padding; border; }`) rather than body/#root/controls.
  // Generic containers are fully UA-bland by default (transparent bg, 0 radius,
  // no shadow, no border, display block/inline, 0 padding), so ANY departure is
  // applied author CSS. We sample a bounded set of layout-ish containers.
  const descendants = Array.from(
    doc.querySelectorAll('div, section, header, footer, nav, aside, article, main, ul, ol, li, p, span, h1, h2, h3'),
  ).slice(0, 60);
  let descendantsSampled = 0;
  let descendantsStyled = 0;
  for (const el of descendants) {
    const cs = getCs(el);
    if (!cs) continue;
    descendantsSampled++;
    const tag = el.tagName.toLowerCase();
    const bg = (cs.backgroundColor || '').trim().toLowerCase();
    const radius = (cs.borderTopLeftRadius || cs.borderRadius || '').trim().toLowerCase();
    const boxShadow = (cs.boxShadow || '').trim().toLowerCase();
    const display = (cs.display || '').trim().toLowerCase();
    const borderW = (cs.borderTopWidth || '').trim();
    const borderStyle = (cs.borderTopStyle || '').trim().toLowerCase();
    const color = (cs.color || '').trim().toLowerCase();
    const letterSpacing = (cs.letterSpacing || '').trim().toLowerCase();
    const textTransform = (cs.textTransform || '').trim().toLowerCase();

    const isNonZeroLen = (v: string): boolean => v !== '' && v !== '0px' && v !== '0';
    const bgStyled = !uaTransparent.has(bg) && !uaWhite.has(bg);
    const radiusStyled = !uaRadii.has(radius);
    const shadowStyled = boxShadow !== '' && boxShadow !== 'none';
    const bordered = isNonZeroLen(borderW) && borderStyle !== '' && borderStyle !== 'none';
    const layoutStyled =
      display === 'flex' || display === 'grid' || display === 'inline-flex' || display === 'inline-grid';
    // Typography signals robust to UA defaults: UA text color is black, and UA
    // letter-spacing/text-transform are `normal`/`none`, so any departure is
    // author CSS. Catches typography/spacing-only styled pages.
    //
    // font-family is deliberately NOT used here: (1) a global app font inherits to
    // every descendant, so it can't localize WHICH element is styled — it is
    // already captured by the root-level `rootFontApplied` signal; (2) some DOM
    // engines (happy-dom) report a non-serif UA-default font, which would
    // false-positive every element on a genuinely unstyled page.
    const coloredText = color !== '' && color !== 'rgb(0, 0, 0)' && color !== '#000000' && color !== 'black';
    const typographyStyled =
      coloredText ||
      (letterSpacing !== '' && letterSpacing !== 'normal') ||
      (textTransform !== '' && textTransform !== 'none');
    // Author spacing IS applied styling. A blanket padding/margin exclusion (the
    // old behavior) discarded legitimate spacing-only renders — e.g. Tailwind
    // p-4/m-4 cards under a plain #root with no themed body or controls — and so
    // false-negatived a page that visibly painted (HYP-733). We count non-zero
    // spacing ONLY where the UA leaves the element at zero, per property:
    //   * padding: counted unless the tag has UA padding (ul/ol/menu/dir).
    //   * margin: counted unless the tag has UA margin (p, headings, blockquote,
    //     figure, lists, dl/dd, fieldset, hr, pre, form, …).
    // So author spacing on a div/section/article/span/nav counts, while the UA's
    // own <ul>/<ol> 40px padding and <p> vertical margin do NOT — the original
    // list false-positive stays prevented.
    const paddedAuthored =
      !uaPaddedTags.has(tag) &&
      (isNonZeroLen((cs.paddingLeft || '').trim()) ||
        isNonZeroLen((cs.paddingTop || '').trim()) ||
        isNonZeroLen((cs.paddingRight || '').trim()) ||
        isNonZeroLen((cs.paddingBottom || '').trim()));
    const marginAuthored =
      !uaMarginTags.has(tag) &&
      (isNonZeroLen((cs.marginLeft || '').trim()) ||
        isNonZeroLen((cs.marginTop || '').trim()) ||
        isNonZeroLen((cs.marginRight || '').trim()) ||
        isNonZeroLen((cs.marginBottom || '').trim()));
    const spacingStyled = paddedAuthored || marginAuthored;

    if (bgStyled || radiusStyled || shadowStyled || bordered || layoutStyled || typographyStyled || spacingStyled) {
      descendantsStyled++;
    }
  }

  // --- Signal 3: app root ---
  // Scan ALL candidate selectors (caller-supplied first, then built-ins) and
  // keep going until a STYLED root is found. Stopping at the first *found* match
  // would miss styling that lives on a component root inside a plain #root, and
  // would ignore a caller's explicit selector whenever a default also matched.
  let appRootFound = false;
  let appRootStyled = false;
  let appRootSelector: string | null = null;
  for (const sel of appRootSelectors) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(sel);
    } catch {
      continue;
    }
    if (!el) continue;
    // Remember the first matched root (for reporting) but don't stop here.
    if (!appRootFound) {
      appRootFound = true;
      appRootSelector = sel;
    }
    const cs = getCs(el);
    if (cs) {
      // A generic container (div/section/main) is fully UA-bare by default:
      // transparent background, 0 radius, 0 padding, no box-shadow, no border,
      // black text. So ANY of these properties departing from the UA default is
      // author CSS applied to this root. We check a broad set (not just bg+
      // padding) so a component root styled only via border/radius/shadow/color
      // still counts. Font-family is intentionally excluded — its UA default
      // varies across engines (happy-dom reports a non-serif default).
      const bg = (cs.backgroundColor || '').trim().toLowerCase();
      const padLeft = (cs.paddingLeft || '').trim();
      const padTop = (cs.paddingTop || '').trim();
      const radius = (cs.borderTopLeftRadius || cs.borderRadius || '').trim().toLowerCase();
      const boxShadow = (cs.boxShadow || '').trim().toLowerCase();
      const borderW = (cs.borderTopWidth || '').trim();
      const borderStyle = (cs.borderTopStyle || '').trim().toLowerCase();
      const color = (cs.color || '').trim().toLowerCase();
      const display = (cs.display || '').trim().toLowerCase();

      const isNonZeroLen = (v: string): boolean => v !== '' && v !== '0px' && v !== '0';
      const bgStyled = !uaTransparent.has(bg) && !uaWhite.has(bg);
      const padded = isNonZeroLen(padLeft) || isNonZeroLen(padTop);
      const radiusStyled = !uaRadii.has(radius);
      const shadowStyled = boxShadow !== '' && boxShadow !== 'none';
      // A generic container has no UA border; a visible border = author CSS.
      const bordered = isNonZeroLen(borderW) && borderStyle !== '' && borderStyle !== 'none';
      // UA default text color is black (rgb(0,0,0)); a themed color = author CSS.
      const coloredText = color !== '' && color !== 'rgb(0, 0, 0)' && color !== '#000000' && color !== 'black';
      // Layout-only roots (Tailwind `flex`/`grid` shells) are styled too — a plain
      // container's UA display is block/inline, never flex/grid.
      const layoutStyled =
        display === 'flex' || display === 'grid' || display === 'inline-flex' || display === 'inline-grid';

      if (bgStyled || padded || radiusStyled || shadowStyled || bordered || coloredText || layoutStyled) {
        appRootStyled = true;
        appRootSelector = sel; // report the root that actually carries styling
        break;
      }
    }
  }

  const signals: StylePresenceSignals = {
    styleSheets: { total, readable, opaque, ruleCount, hasNonTrivialSheet },
    computed: {
      rootFontApplied,
      themedBackground,
      controlsSampled,
      controlsStyled,
      descendantsSampled,
      descendantsStyled,
    },
    appRoot: { found: appRootFound, styled: appRootStyled, selector: appRootSelector },
  };

  // --- Weighted scoring -------------------------------------------------------
  // Each signal contributes to a score in [0,1]. No single signal is decisive.
  //
  // The decisive proof that a page is actually styled is APPLIED computed
  // evidence — a themed background, author-styled controls, or a styled app
  // root. These mean author CSS actually painted the DOM. A loaded stylesheet
  // is only corroboration: rules can be present yet apply to nothing (stale
  // selectors, inactive media, a stripped body), which is still an unstyled
  // render. So the sheet weight is kept BELOW the decision threshold and a
  // "styled" verdict additionally REQUIRES at least one applied-computed signal.
  //
  // WEAK signal: root font-family — UA defaults vary across engines (happy-dom
  // reports a non-serif default with zero author CSS), so font is a small bonus
  // that can never, on its own, flip a page to "styled".
  const controlRatio = controlsSampled > 0 ? controlsStyled / controlsSampled : 0;

  // Ordinary descendants are applied evidence when SEVERAL are styled (a single
  // incidental flex/padding container shouldn't flip a truly-bare page; a real
  // app themes many containers). Require >=2 styled OR a non-trivial fraction.
  const descendantRatio = descendantsSampled > 0 ? descendantsStyled / descendantsSampled : 0;
  const descendantEvidence = descendantsStyled >= 2 || descendantRatio >= 0.15;

  // Applied-computed evidence = author CSS demonstrably painted the DOM. Each of
  // these independently proves a styled render, so each is weighted to reach
  // THRESHOLD on its own: a small CSS-in-JS / inline-styled component that themes
  // only its own root or a few containers (no themed body, no controls, maybe no
  // readable sheet) must still pass.
  const appliedComputedEvidence = themedBackground || controlsStyled > 0 || appRootStyled || descendantEvidence;

  const THRESHOLD = 0.4;

  let score = 0;
  // Sheet is corroboration only — below THRESHOLD so it can't pass on its own
  // (it is additionally gated by appliedComputedEvidence below).
  score += hasNonTrivialSheet ? 0.35 : 0;
  // Each applied-computed signal is decisive on its own.
  score += themedBackground ? THRESHOLD : 0;
  score += controlsSampled > 0 && controlRatio > 0 ? THRESHOLD + controlRatio * 0.2 : 0;
  score += appRootStyled ? THRESHOLD : 0;
  score += descendantEvidence ? THRESHOLD + Math.min(descendantRatio, 0.5) * 0.2 : 0;
  // Font is the weak bonus — capped so it cannot alone reach THRESHOLD.
  score += rootFontApplied ? 0.1 : 0;
  // Styled requires BOTH a passing score AND demonstrable applied styling — a
  // loaded-but-not-applied stylesheet (rules present, nothing painted) stays
  // "unstyled" no matter how many rules it declares.
  const styled = score >= THRESHOLD && appliedComputedEvidence;

  // Confidence = how far the score is from the decision boundary, scaled to 0..1.
  // When the applied-evidence gate is what fails (score may be high from the
  // sheet alone), pin confidence to the gate so the verdict isn't reported as a
  // coin-flip.
  const scoreConfidence = Math.min(1, Math.abs(score - THRESHOLD) / THRESHOLD);
  const confidence = styled || appliedComputedEvidence ? scoreConfidence : Math.max(scoreConfidence, 0.6);

  // --- Reason -----------------------------------------------------------------
  const missing: string[] = [];
  if (!hasNonTrivialSheet) {
    if (total === 0) missing.push('no stylesheets present (document.styleSheets is empty)');
    else if (readable === 0)
      missing.push(`all ${total} stylesheet(s) are CORS-opaque/unreadable — no same-origin CSS detected`);
    else missing.push(`no stylesheet has >=${minSheetRules} CSS rules (total readable rules: ${ruleCount})`);
  } else if (!appliedComputedEvidence) {
    // Sheet(s) loaded with real rules, but nothing actually painted the DOM
    // (stale selectors, inactive media, or a stripped body).
    missing.push(`stylesheet loaded (${ruleCount} rules) but no rule applied to the rendered DOM`);
  }
  if (!rootFontApplied) missing.push('root/body font-family is UA-default (serif/unset)');
  if (!themedBackground) missing.push('no themed background color on root/body (transparent/white)');
  if (controlsSampled > 0 && controlsStyled === 0)
    missing.push(`all ${controlsSampled} sampled control(s) have UA-default styling`);
  if (descendantsSampled > 0 && !descendantEvidence)
    missing.push(`sampled descendants show no applied styling (${descendantsStyled}/${descendantsSampled} styled)`);

  let reason: string;
  if (styled) {
    const present: string[] = [];
    if (hasNonTrivialSheet) present.push(`${readable} readable sheet(s), ${ruleCount} CSS rules`);
    if (rootFontApplied) present.push('themed font');
    if (themedBackground) present.push('themed background');
    if (controlsStyled > 0) present.push(`${controlsStyled}/${controlsSampled} controls styled`);
    if (appRootStyled) present.push(`app root '${appRootSelector}' styled`);
    if (descendantEvidence) present.push(`${descendantsStyled}/${descendantsSampled} descendants styled`);
    reason = `Styles applied (score ${score.toFixed(2)}): ${present.join('; ')}.`;
  } else {
    reason = `Unstyled render (score ${score.toFixed(2)}): ${missing.join('; ')}.`;
  }

  return { styled, confidence, signals, reason };
}

/**
 * Run the detector directly against a DOM `Document`.
 *
 * Use this in happy-dom/jsdom tests, or anywhere you already hold a `document`
 * (including inside a `page.evaluate(() => detectStylePresenceInDocument(document))`).
 */
export function detectStylePresenceInDocument(doc: Document, options?: DetectStyleOptions): StylePresenceVerdict {
  return computeStylePresence(doc, options);
}

/**
 * Minimal structural type for a Playwright `Page` — avoids a hard dependency.
 *
 * Playwright serializes the passed function via `Function.prototype.toString` and
 * executes it through CDP (`Runtime.callFunctionOn`), NOT page-level `eval`, so a
 * function argument runs even under ANY page CSP — `script-src 'self'`,
 * hash-only, or `'nonce-…'`. No `unsafe-eval` is required.
 */
export interface EvaluablePage {
  evaluate<R, A>(pageFunction: (arg: A) => R, arg: A): Promise<R>;
}

/**
 * Run the detector against a live Playwright `Page` (or anything exposing a
 * compatible `evaluate`). It runs the detection core against the page's real
 * `document`, so it sees actual loaded stylesheets and real computed styles.
 *
 * CSP-safe by design: `computeStylePresence` IS the function handed to
 * `page.evaluate`. Playwright serializes it and runs it via CDP
 * (`Runtime.callFunctionOn`), which is not governed by the page's `script-src`
 * CSP — so there is NO in-page `eval`, `new Function`, or `<script>` install to
 * be blocked. The detector's dual call shape lets the single evaluated argument
 * be the options object while the document defaults to the ambient page
 * `document`. Works under `script-src 'self'`, hash-only, and nonce CSPs alike.
 */
export async function detectStylePresenceOnPage(
  page: EvaluablePage,
  options?: DetectStyleOptions,
): Promise<StylePresenceVerdict> {
  // computeStylePresence(options) resolves the ambient `document` itself (see its
  // dual-call shape), so passing it straight to evaluate runs the real detector
  // in-page with zero eval/script-injection.
  return page.evaluate(computeStylePresence, options);
}

/**
 * Assert a target render is styled; throw a descriptive error if not.
 *
 * Opt-in guard for the proof/screenshot capture path and e2e: call after a
 * capture so an unstyled render can't silently ship. `target` may be a
 * `Document` or a Playwright `Page`.
 */
export async function assertStyled(
  target: Document | EvaluablePage,
  options?: DetectStyleOptions & { label?: string },
): Promise<StylePresenceVerdict> {
  const verdict = isDocument(target)
    ? detectStylePresenceInDocument(target, options)
    : await detectStylePresenceOnPage(target, options);
  if (!verdict.styled) {
    const label = options?.label ? `${options.label}: ` : '';
    throw new StyleMissingError(`${label}${verdict.reason}`, verdict);
  }
  return verdict;
}

/** Thrown by `assertStyled` when a render is judged unstyled. Carries the verdict. */
export class StyleMissingError extends Error {
  readonly verdict: StylePresenceVerdict;
  constructor(message: string, verdict: StylePresenceVerdict) {
    super(message);
    this.name = 'StyleMissingError';
    this.verdict = verdict;
  }
}

function isDocument(target: Document | EvaluablePage): target is Document {
  return typeof (target as Document).querySelectorAll === 'function' && 'styleSheets' in (target as Document);
}

// Re-export constants for tests / advanced callers that want to reuse defaults.
export const STYLE_PRESENCE_DEFAULTS = {
  minSheetRules: DEFAULT_MIN_SHEET_RULES,
  appRootSelectors: DEFAULT_APP_ROOT_SELECTORS,
  uaDefaultBg: UA_DEFAULT_BG,
  uaDefaultBgWhite: UA_DEFAULT_BG_WHITE,
  uaDefaultRadii: UA_DEFAULT_RADII,
} as const;

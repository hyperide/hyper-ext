/**
 * @file Tests for the unstyled-render detector.
 *
 * Accessed via: bun run test lib/visual-verify/detect-style-presence.test.ts
 * Assumptions: happy-dom (preloaded by test/setup.ts) provides document.styleSheets
 *   and getComputedStyle so a <style>-tag fixture exercises the real signals.
 *
 * Red-first contract: a STYLED fixture must pass (styled=true) and the SAME DOM
 * with its stylesheet removed must fail (styled=false) with a reason that names
 * the missing styles.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  assertStyled,
  computeStylePresence,
  detectStylePresenceInDocument,
  detectStylePresenceOnPage,
  type EvaluablePage,
  StyleMissingError,
} from './detect-style-presence';

/** CSS that mimics a real app shell (dark theme + styled controls). */
const APP_CSS = `
  :root { --bg: 10 10 12; }
  html, body {
    margin: 0;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    background-color: rgb(10, 10, 12);
    color: rgb(240, 240, 245);
  }
  #root { padding: 16px; background-color: rgb(18, 18, 22); }
  header { padding: 12px 0; border-bottom: 1px solid rgb(40, 40, 48); }
  main { display: flex; gap: 8px; padding: 12px; }
  button {
    background-color: rgb(40, 40, 48);
    color: rgb(240, 240, 245);
    border: 1px solid rgb(60, 60, 70);
    border-radius: 6px;
    padding: 8px 12px;
  }
  button:hover { background-color: rgb(56, 56, 66); }
  input, select, textarea {
    background-color: rgb(24, 24, 30);
    border: 1px solid rgb(60, 60, 70);
    border-radius: 4px;
    padding: 6px 8px;
  }
  a { color: rgb(120, 170, 255); text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

const APP_BODY = `
  <div id="root">
    <header><a href="#home">Home</a></header>
    <main>
      <button type="button">Save</button>
      <button type="button">Cancel</button>
      <input type="text" placeholder="Name" />
      <select><option>One</option></select>
      <textarea></textarea>
    </main>
  </div>
`;

function mountStyled(): void {
  document.head.innerHTML = `<style id="app-css">${APP_CSS}</style>`;
  document.body.innerHTML = APP_BODY;
}

function mountUnstyled(): void {
  // Same DOM, but the stylesheet failed to load → no <style>/<link>.
  document.head.innerHTML = '';
  document.body.innerHTML = APP_BODY;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('computeStylePresence — styled fixture', () => {
  it('judges a fully-styled app as styled=true', () => {
    mountStyled();
    const verdict = computeStylePresence(document);
    expect(verdict.styled).toBe(true);
    expect(verdict.confidence).toBeGreaterThan(0);
  });

  it('reports the contributing signals on a styled page', () => {
    mountStyled();
    const { signals } = computeStylePresence(document);
    expect(signals.styleSheets.total).toBeGreaterThanOrEqual(1);
    expect(signals.styleSheets.readable).toBeGreaterThanOrEqual(1);
    expect(signals.styleSheets.hasNonTrivialSheet).toBe(true);
    expect(signals.computed.rootFontApplied).toBe(true);
    expect(signals.computed.themedBackground).toBe(true);
    expect(signals.computed.controlsSampled).toBeGreaterThan(0);
    expect(signals.computed.controlsStyled).toBeGreaterThan(0);
    expect(signals.appRoot.found).toBe(true);
  });

  it('reason describes applied styles when styled', () => {
    mountStyled();
    const { reason } = computeStylePresence(document);
    expect(reason.toLowerCase()).toContain('styles applied');
  });
});

describe('computeStylePresence — unstyled fixture (CSS failed to load)', () => {
  it('judges the same DOM with no stylesheet as styled=false', () => {
    mountUnstyled();
    const verdict = computeStylePresence(document);
    expect(verdict.styled).toBe(false);
  });

  it('names the missing styles in the reason', () => {
    mountUnstyled();
    const { reason, signals } = computeStylePresence(document);
    expect(signals.styleSheets.hasNonTrivialSheet).toBe(false);
    expect(reason.toLowerCase()).toContain('unstyled');
    // Reason must explain *what* was missing — stylesheets and/or computed styles.
    expect(reason.toLowerCase()).toMatch(/stylesheet|font|background|control/);
  });

  it('has high confidence in the negative verdict for a bare DOM', () => {
    mountUnstyled();
    const verdict = computeStylePresence(document);
    expect(verdict.confidence).toBeGreaterThan(0.5);
  });
});

describe('detectStylePresenceInDocument adapter', () => {
  it('matches computeStylePresence for the styled case', () => {
    mountStyled();
    expect(detectStylePresenceInDocument(document).styled).toBe(true);
  });
  it('matches computeStylePresence for the unstyled case', () => {
    mountUnstyled();
    expect(detectStylePresenceInDocument(document).styled).toBe(false);
  });
});

describe('CORS-opaque stylesheets are guarded', () => {
  it('treats an unreadable (throwing cssRules) sheet as opaque, not as applied CSS', () => {
    mountUnstyled();
    // Fabricate a styleSheets list with one CORS-opaque sheet (cssRules throws).
    const opaqueSheet = {
      get cssRules(): CSSRuleList {
        throw new DOMException('Cannot access rules', 'SecurityError');
      },
    } as unknown as CSSStyleSheet;
    const fakeDoc = Object.create(document) as Document;
    Object.defineProperty(fakeDoc, 'styleSheets', {
      value: { length: 1, 0: opaqueSheet } as unknown as StyleSheetList,
      configurable: true,
    });
    const { signals, styled } = computeStylePresence(fakeDoc);
    expect(signals.styleSheets.total).toBe(1);
    expect(signals.styleSheets.opaque).toBe(1);
    expect(signals.styleSheets.readable).toBe(0);
    expect(signals.styleSheets.hasNonTrivialSheet).toBe(false);
    // Opaque sheet + bare DOM = still unstyled.
    expect(styled).toBe(false);
  });
});

describe('app-root scan honors caller selectors and keeps scanning (P2 regression)', () => {
  // A plain #root wrapper with the actual styling on an inner component root the
  // caller names. The scan must not stop at the unstyled #root — it must reach
  // the caller's selector and report the root as styled.
  it('detects a styled component-root inside an unstyled #root when caller names it', () => {
    document.head.innerHTML = `<style>
      #root { /* deliberately unstyled wrapper */ }
      .app-shell {
        background-color: rgb(18, 18, 22);
        padding: 16px;
        border-radius: 8px;
        color: rgb(240, 240, 245);
        display: block;
        font-family: Inter, sans-serif;
        gap: 8px;
      }
    </style>`;
    document.body.innerHTML = `<div id="root"><section class="app-shell">content</section></div>`;
    const { signals } = computeStylePresence(document, { appRootSelectors: ['.app-shell'] });
    expect(signals.appRoot.found).toBe(true);
    expect(signals.appRoot.styled).toBe(true);
    expect(signals.appRoot.selector).toBe('.app-shell');
  });

  it('a small component styled only at its caller-named root passes styled=true', () => {
    // CSS-in-JS / inline-style small component: no themed body, no controls,
    // styling lives entirely on the component root the caller points at. This
    // must pass — app-root applied styling is decisive on its own.
    document.head.innerHTML = `<style>
      .widget { background-color: rgb(30, 30, 38); border-radius: 10px; padding: 12px; }
    </style>`;
    document.body.innerHTML = `<div class="widget">Just a component</div>`;
    const verdict = computeStylePresence(document, { appRootSelectors: ['.widget'] });
    expect(verdict.signals.appRoot.styled).toBe(true);
    expect(verdict.signals.computed.themedBackground).toBe(false); // body not themed
    expect(verdict.signals.computed.controlsSampled).toBe(0); // no controls
    expect(verdict.styled).toBe(true); // ...yet a styled root is enough
  });

  it('counts a layout-only app root (Tailwind flex/grid shell, no bg/border)', () => {
    // A common Tailwind app shell: the root carries only `display:flex` (+gap).
    // No background, border, radius, or padding — but it IS author-styled.
    document.head.innerHTML = `<style>.shell { display: flex; }</style>`;
    document.body.innerHTML = `<div id="root"><div class="shell"><span>a</span><span>b</span></div></div>`;
    const { signals, styled } = computeStylePresence(document, { appRootSelectors: ['.shell'] });
    expect(signals.appRoot.styled).toBe(true);
    expect(signals.appRoot.selector).toBe('.shell');
    expect(styled).toBe(true);
  });

  it('counts an app root styled only via border/radius/color (no bg, no padding)', () => {
    document.head.innerHTML = `<style>
      .panel {
        border: 1px solid rgb(60, 60, 70);
        border-radius: 8px;
        color: rgb(200, 200, 210);
      }
    </style>`;
    document.body.innerHTML = `<div id="root"><div class="panel">x</div></div>`;
    const { signals } = computeStylePresence(document, { appRootSelectors: ['.panel'] });
    // Background transparent + zero padding, but border/radius/color prove styling.
    expect(signals.appRoot.styled).toBe(true);
    expect(signals.appRoot.selector).toBe('.panel');
  });
});

describe('styled ordinary descendants count as applied evidence (P2 regression)', () => {
  // A light-themed page where styling lives only on plain component containers
  // (no themed body, no controls, plain #root) must still pass — without the
  // caller having to name the exact styled child.
  it('passes a page styled only via .card descendants (no body/root/control styling)', () => {
    document.head.innerHTML = `<style>
      .card { display: flex; border: 1px solid rgb(220,220,225); border-radius: 8px; }
      .badge { background-color: rgb(0, 120, 255); border-radius: 4px; }
    </style>`;
    document.body.innerHTML = `
      <div id="root">
        <div class="card">a</div>
        <div class="card">b</div>
        <span class="badge">new</span>
      </div>`;
    const verdict = computeStylePresence(document);
    expect(verdict.signals.computed.themedBackground).toBe(false);
    expect(verdict.signals.computed.controlsSampled).toBe(0);
    expect(verdict.signals.appRoot.styled).toBe(false); // #root is a plain wrapper
    expect(verdict.signals.computed.descendantsStyled).toBeGreaterThanOrEqual(2);
    expect(verdict.styled).toBe(true);
    expect(verdict.reason.toLowerCase()).toContain('descendants styled');
  });

  it('does NOT false-positive a bare page of UA-default containers (incl. lists)', () => {
    // <ul>/<ol> have UA inline-padding; <p>/<h1> have margins. None of these are
    // applied-CSS markers (we only count bg/radius/shadow/border/flex), so a bare
    // document of structural elements must stay unstyled.
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div><header><h1>Title</h1></header>
      <nav><ul><li>one</li><li>two</li><li>three</li></ul></nav>
      <main><section><p>paragraph one</p><p>paragraph two</p></section></main>
      <footer><p>footer</p></footer></div>`;
    const verdict = computeStylePresence(document);
    expect(verdict.signals.computed.descendantsStyled).toBe(0);
    expect(verdict.styled).toBe(false);
  });
});

describe('author spacing on non-list descendants counts as applied evidence (HYP-733 false-negative)', () => {
  // Codex P2 false-negative on PR #459: a page whose ONLY applied author CSS is
  // container spacing (Tailwind p-4/m-4 cards under a plain #root — no themed
  // body, no styled controls, no styled #root) was judged unstyled because
  // padding/margin were excluded outright (to dodge the <ul>/<ol> UA-padding
  // false-positive). Author spacing on a div/section card IS applied styling and
  // must count.
  it('passes a page styled only via padding/margin on .card divs (spacing-only render)', () => {
    document.head.innerHTML = `<style>
      .card { padding: 16px; margin: 12px; }
    </style>`;
    document.body.innerHTML = `
      <div id="root">
        <div class="card">a</div>
        <div class="card">b</div>
      </div>`;
    const verdict = computeStylePresence(document);
    expect(verdict.signals.computed.themedBackground).toBe(false);
    expect(verdict.signals.computed.controlsSampled).toBe(0);
    expect(verdict.signals.appRoot.styled).toBe(false); // #root is a plain wrapper
    // The crux: author spacing on the two cards is applied evidence.
    expect(verdict.signals.computed.descendantsStyled).toBeGreaterThanOrEqual(2);
    expect(verdict.styled).toBe(true);
  });

  it('counts right/bottom-only padding on a card (Tailwind pr-4/pb-4)', () => {
    // Codex follow-up: spacing-only renders sometimes apply only right/bottom
    // padding (e.g. `pr-4`/`pb-4`). The signal must check all four sides, not
    // just left/top, or the same false-negative survives for those cards.
    document.head.innerHTML = `<style>
      .card { padding-right: 16px; padding-bottom: 16px; }
    </style>`;
    document.body.innerHTML = `
      <div id="root">
        <div class="card">a</div>
        <div class="card">b</div>
      </div>`;
    const verdict = computeStylePresence(document);
    expect(verdict.signals.computed.descendantsStyled).toBeGreaterThanOrEqual(2);
    expect(verdict.styled).toBe(true);
  });

  it('REGRESSION GUARD: a bare <ul>/<ol> with only UA 40px padding stays unstyled', () => {
    // The original false-positive the padding-exclusion was added to prevent.
    // happy-dom does NOT emit UA list padding, so we simulate a real browser via
    // a fake getComputedStyle: <ul>/<ol> carry 40px padding-inline-start, every
    // other element is fully UA-bland. No author CSS exists. Must stay unstyled.
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="root">
        <ul><li>one</li><li>two</li></ul>
        <ol><li>three</li><li>four</li></ol>
      </div>`;

    const uaByTag: Record<string, Record<string, string>> = {
      // Real Chromium UA defaults for lists: 40px inline-start padding + vertical
      // margin. NOTHING here is author CSS.
      UL: { paddingLeft: '40px', paddingTop: '0px', marginTop: '16px', marginLeft: '0px' },
      OL: { paddingLeft: '40px', paddingTop: '0px', marginTop: '16px', marginLeft: '0px' },
      LI: { paddingLeft: '0px', paddingTop: '0px', marginTop: '0px', marginLeft: '0px' },
      DIV: { paddingLeft: '0px', paddingTop: '0px', marginTop: '0px', marginLeft: '0px' },
      BODY: { paddingLeft: '0px', marginTop: '8px', marginLeft: '8px' },
      HTML: { paddingLeft: '0px', paddingTop: '0px', marginTop: '0px', marginLeft: '0px' },
    };
    const uaGetComputedStyle = (el: Element): CSSStyleDeclaration => {
      const vals = uaByTag[el.tagName.toUpperCase()] ?? uaByTag.DIV;
      return new Proxy({} as CSSStyleDeclaration, {
        get(_t, prop: string) {
          return vals[prop] ?? '';
        },
      });
    };
    const fakeWin = { getComputedStyle: uaGetComputedStyle } as unknown as Window;
    const fakeDoc = Object.create(document) as Document;
    Object.defineProperty(fakeDoc, 'defaultView', { value: fakeWin, configurable: true });

    const { signals, styled } = computeStylePresence(fakeDoc);
    // UA list padding/margin must NOT be counted — descendants stay unstyled.
    expect(signals.computed.descendantsStyled).toBe(0);
    expect(styled).toBe(false);
  });

  it('counts author padding on a <p> but NOT its UA margin (per-property UA exclusion)', () => {
    // <p> gets UA vertical margin in a real browser but zero UA padding. Author
    // padding on a <p> is therefore real applied styling; author-looking margin
    // must be discounted because UA already supplies it. Simulate a real browser:
    // one <p> with author padding (counts) and one with only UA margin (doesn't).
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="root">
        <p id="author-pad">styled by padding</p>
        <p id="ua-only">UA margin only</p>
      </div>`;

    const csByTag: Record<string, Record<string, string>> = {
      DIV: { paddingLeft: '0px', paddingTop: '0px', marginTop: '0px', marginLeft: '0px' },
      BODY: { paddingLeft: '0px', marginTop: '8px', marginLeft: '8px' },
      HTML: { paddingLeft: '0px', paddingTop: '0px', marginTop: '0px', marginLeft: '0px' },
    };
    const csById: Record<string, Record<string, string>> = {
      // <p> with author padding (real applied CSS) — UA gives p ZERO padding.
      'author-pad': { paddingLeft: '12px', paddingTop: '12px', marginTop: '16px', marginLeft: '0px' },
      // <p> with only UA vertical margin, no author CSS at all.
      'ua-only': { paddingLeft: '0px', paddingTop: '0px', marginTop: '16px', marginLeft: '0px' },
    };
    const fakeGetComputedStyle = (el: Element): CSSStyleDeclaration => {
      const byId = el.id ? csById[el.id] : undefined;
      const vals = byId ?? csByTag[el.tagName.toUpperCase()] ?? csByTag.DIV;
      return new Proxy({} as CSSStyleDeclaration, {
        get(_t, prop: string) {
          return vals[prop] ?? '';
        },
      });
    };
    const fakeWin = { getComputedStyle: fakeGetComputedStyle } as unknown as Window;
    const fakeDoc = Object.create(document) as Document;
    Object.defineProperty(fakeDoc, 'defaultView', { value: fakeWin, configurable: true });

    const { signals } = computeStylePresence(fakeDoc);
    // Exactly one descendant styled: the <p> with author padding. The UA-margin-only
    // <p> must NOT be counted (UA supplies p margin), nor the plain #root/div.
    expect(signals.computed.descendantsStyled).toBe(1);
  });
});

describe('loaded-but-not-applied stylesheet is still unstyled (P2 regression)', () => {
  // A stylesheet can be present with real rules that apply to NOTHING (stale
  // selectors, inactive media, stripped body). A loaded sheet alone must not
  // pass the guard — only demonstrably-applied computed styles prove a render.
  it('a non-trivial sheet whose rules paint nothing stays unstyled=false', () => {
    document.head.innerHTML = `<style>
      .does-not-exist-1 { color: red; }
      .does-not-exist-2 { background: blue; }
      .does-not-exist-3 { padding: 4px; }
      .does-not-exist-4 { margin: 2px; }
      .does-not-exist-5 { display: flex; }
      .does-not-exist-6 { gap: 8px; }
      .does-not-exist-7 { border: 1px solid; }
      @media (min-width: 999999px) { body { background-color: rgb(1,2,3); } }
    </style>`;
    // Bare DOM the rules don't target.
    document.body.innerHTML = `<div></div>`;
    const { signals, styled, reason } = computeStylePresence(document);
    expect(signals.styleSheets.hasNonTrivialSheet).toBe(true); // rules ARE loaded
    expect(signals.computed.themedBackground).toBe(false);
    expect(signals.computed.controlsStyled).toBe(0);
    expect(signals.appRoot.styled).toBe(false);
    expect(styled).toBe(false); // ...but nothing applied → unstyled
    expect(reason.toLowerCase()).toContain('no rule applied');
  });
});

describe('UA-default native controls are NOT counted as author styling (P2 regression)', () => {
  // Real Chromium gives a bare <button> a gray bg + 2px outset border + padding,
  // and inputs a white bg + border. If those count as "styled", a CSS-failed
  // render full of controls could sneak past the guard. This builds a document
  // whose getComputedStyle returns exactly those UA-default values and asserts
  // the verdict is still unstyled.
  it('a bare DOM of native controls with UA-default computed styles stays unstyled=false', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <button>Save</button><button>Cancel</button>
      <input type="text"><select><option>x</option></select><textarea></textarea>
      <a href="#">Docs</a>`;

    // Map of UA-default computed values keyed by tag (mirrors real Chromium).
    const uaByTag: Record<string, Record<string, string>> = {
      BUTTON: {
        backgroundColor: 'rgb(239, 239, 239)',
        borderTopLeftRadius: '0px',
        borderRadius: '0px',
        boxShadow: 'none',
        fontFamily: 'Times', // UA serif default
        paddingLeft: '6px',
        paddingTop: '1px',
        borderTopWidth: '2px',
      },
      INPUT: {
        backgroundColor: 'rgb(255, 255, 255)',
        borderTopLeftRadius: '0px',
        borderRadius: '0px',
        boxShadow: 'none',
        fontFamily: 'Times',
        paddingLeft: '2px',
        paddingTop: '1px',
        borderTopWidth: '2px',
      },
      SELECT: {
        backgroundColor: 'rgb(255, 255, 255)',
        borderTopLeftRadius: '0px',
        boxShadow: 'none',
        fontFamily: 'Times',
      },
      TEXTAREA: {
        backgroundColor: 'rgb(255, 255, 255)',
        borderTopLeftRadius: '0px',
        boxShadow: 'none',
        fontFamily: 'Times',
      },
      A: { backgroundColor: 'rgba(0, 0, 0, 0)', borderTopLeftRadius: '0px', boxShadow: 'none', fontFamily: 'Times' },
      BODY: { backgroundColor: 'rgba(0, 0, 0, 0)', fontFamily: 'Times', paddingLeft: '0px' },
      HTML: { backgroundColor: 'rgba(0, 0, 0, 0)', fontFamily: 'Times', paddingLeft: '0px' },
      DIV: { backgroundColor: 'rgba(0, 0, 0, 0)', fontFamily: 'Times', paddingLeft: '0px' },
    };
    const uaGetComputedStyle = (el: Element): CSSStyleDeclaration => {
      const tag = el.tagName.toUpperCase();
      const vals = uaByTag[tag] ?? uaByTag.DIV;
      return new Proxy({} as CSSStyleDeclaration, {
        get(_t, prop: string) {
          return vals[prop] ?? '';
        },
      });
    };
    const fakeWin = { getComputedStyle: uaGetComputedStyle } as unknown as Window;
    const fakeDoc = Object.create(document) as Document;
    Object.defineProperty(fakeDoc, 'defaultView', { value: fakeWin, configurable: true });

    const { signals, styled, reason } = computeStylePresence(fakeDoc);
    expect(signals.computed.controlsSampled).toBeGreaterThan(0);
    // The crux: native UA controls must NOT be counted as author-styled.
    expect(signals.computed.controlsStyled).toBe(0);
    expect(signals.computed.themedBackground).toBe(false);
    expect(styled).toBe(false);
    expect(reason.toLowerCase()).toContain('unstyled');
  });
});

describe('detectStylePresenceOnPage (Playwright adapter)', () => {
  // The adapter passes `computeStylePresence` STRAIGHT to `page.evaluate`, which
  // Playwright serializes and runs via CDP — no in-page eval/<script> install, so
  // it works under any page CSP. We mock `evaluate` by invoking the page function
  // with its single arg in this (happy-dom) context, exactly as Playwright would
  // call it with `document` as the ambient global.
  function makeMockPage(): EvaluablePage {
    return {
      evaluate<R, A>(pageFunction: (arg: A) => R, arg: A): Promise<R> {
        return Promise.resolve(pageFunction(arg));
      },
    };
  }

  it('produces a styled verdict for a styled page via the page adapter', async () => {
    mountStyled();
    const verdict = await detectStylePresenceOnPage(makeMockPage());
    expect(verdict.styled).toBe(true);
  });

  it('produces an unstyled verdict for a bare page via the page adapter', async () => {
    mountUnstyled();
    const verdict = await detectStylePresenceOnPage(makeMockPage());
    expect(verdict.styled).toBe(false);
  });

  it('forwards detector options through evaluate', async () => {
    document.head.innerHTML = `<style>.widget { background-color: rgb(30,30,38); border-radius: 8px; }</style>`;
    document.body.innerHTML = `<div class="widget">x</div>`;
    const verdict = await detectStylePresenceOnPage(makeMockPage(), { appRootSelectors: ['.widget'] });
    expect(verdict.signals.appRoot.selector).toBe('.widget');
    expect(verdict.styled).toBe(true);
  });
});

describe('computeStylePresence dual call shape (CSP-safe page execution)', () => {
  // The page adapter relies on calling computeStylePresence with the options
  // object as the ONLY argument (Playwright passes one arg), resolving the
  // ambient `document`. This is what lets the function run AS the evaluated
  // page function with no eval/script-injection under strict CSP.
  it('resolves the ambient document when called with options only', () => {
    mountStyled();
    const viaOptionsOnly = computeStylePresence({ appRootSelectors: ['#root'] });
    const viaDocExplicit = computeStylePresence(document, { appRootSelectors: ['#root'] });
    expect(viaOptionsOnly.styled).toBe(true);
    expect(viaOptionsOnly.styled).toBe(viaDocExplicit.styled);
  });

  it('resolves the ambient document when called with no arguments', () => {
    mountUnstyled();
    expect(computeStylePresence().styled).toBe(false);
  });
});

describe('assertStyled guard', () => {
  it('returns the verdict when styled', async () => {
    mountStyled();
    const verdict = await assertStyled(document);
    expect(verdict.styled).toBe(true);
  });

  it('throws StyleMissingError when unstyled, carrying the verdict', async () => {
    mountUnstyled();
    let thrown: unknown;
    try {
      await assertStyled(document, { label: 'proof-capture' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StyleMissingError);
    const err = thrown as StyleMissingError;
    expect(err.message).toContain('proof-capture');
    expect(err.verdict.styled).toBe(false);
  });
});

describe('threshold tuning — partial styling', () => {
  it('passes when only computed styles are applied (inline <style> with controls, CORS-blocked sheets)', () => {
    // Sheets unreadable but controls clearly styled via applied computed values.
    mountStyled();
    const verdict = computeStylePresence(document, { minSheetRules: 999 });
    // Even forcing sheets to "trivial", computed-style signals carry it.
    expect(verdict.styled).toBe(true);
  });

  it('fails a page that has a sheet but only a couple of trivial rules and a bare body', () => {
    document.head.innerHTML = `<style>/* a comment */ .unused { color: red; }</style>`;
    document.body.innerHTML = `<button>Hi</button>`;
    const verdict = computeStylePresence(document);
    expect(verdict.styled).toBe(false);
  });
});

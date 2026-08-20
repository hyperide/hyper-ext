/**
 * @file A1 forward-detector — end-to-end tests via `detectForwarding` (HYP-1229).
 *
 * Accessed via: bun test lib/style-read/forward-detect.test.ts
 * Covers the revised plan's §7 regression fixtures (the discriminated-union rest-spread fix,
 * the root-vs-descendant exclusion, the asChild/Slot flagship case, the prop-getter-hook safe
 * failure mode, and the styled-components recognizer) plus the surrounding structural cases
 * (native tags, HOC unwrap, cross-file resolution, plain non-forwarding components).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { NodeFileIO } from '@lib/ast/node-file-io';
import { parseCode } from '@lib/ast/parser';
import { findAllJSXElements } from '@lib/ast/traverser';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { hasNoStyleWriteSurface } from '@lib/style-write/stylability-ladder';
import { detectForwarding, projectForwardDetectionToPropSurface } from './forward-detect';

const FILE_PATH = '/workspace/src/Page.tsx';

async function detect(source: string, tagName: string, files: Record<string, string> = {}) {
  const ast = parseCode(source);
  const element = findAllJSXElements(ast).find(
    (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === tagName,
  )?.element;
  if (!element) throw new Error(`no <${tagName}> element in fixture`);
  const fileIO = new InMemoryFileIO({ [FILE_PATH]: source, ...files });
  return detectForwarding({ ast, filePath: FILE_PATH, element, fileIO, aliasMap: {}, skipTypeCorroboration: true });
}

describe('detectForwarding — native/intrinsic tags', () => {
  it('resolves a lowercase host tag as high-confidence positive on both channels', async () => {
    const source = `export function Page() { return <div className="x" />; }\n`;
    const result = await detect(source, 'div');
    expect(result.className).toEqual({
      forwardsClassName: true,
      forwardsStyle: true,
      hostProp: null,
      confidence: 'high',
    });
    expect(result.style.confidence).toBe('high');
    expect(result.style.forwardsStyle).toBe(true);
  });
});

describe('detectForwarding — HYP-1235: local monorepo workspace-package resolution', () => {
  // Ported from `component-forwarding.test.ts`'s "conloca case" (HYP-995): a component imported
  // from a bare workspace-package specifier (`@acme/ui`, a `node_modules` symlink whose
  // `package.json` entry is real `.ts(x)` SOURCE, not a built dependency) must still be resolved
  // and inspected — `resolveMasterComponent` alone reports this as `external` and gives up. A
  // 3-model `review diff` round on HYP-1235 caught that `locateComponentDeclaration` (this
  // detector's own resolver) initially lacked the fallback `component-forwarding.ts` already had,
  // which would have silently degraded the ext's write-path pre-check (now wired onto this
  // detector) from a real `not-forwarding` exclusion to fail-open `unknown` for every
  // workspace-package component. `resolveWorkspacePackageEntry`
  // (`lib/ast/workspace-package-entry.ts`) is now shared by both resolvers.
  it('resolves a workspace package and detects non-forwarding on both channels', async () => {
    const pageSource = `import { Card } from '@acme/ui';\nexport function Page() {\n  return <Card />;\n}\n`;
    const result = await detect(pageSource, 'Card', {
      '/workspace/node_modules/@acme/ui/package.json': JSON.stringify({ exports: { '.': './src/index.ts' } }),
      '/workspace/node_modules/@acme/ui/src/index.ts': `export { Card } from './Card';\n`,
      '/workspace/node_modules/@acme/ui/src/Card.tsx': `export function Card({ title, children }: { title?: string; children?: unknown }) {\n  return <div>{title}{children as any}</div>;\n}\n`,
    });
    expect(result.className).toEqual({
      forwardsClassName: false,
      forwardsStyle: false,
      hostProp: null,
      confidence: 'high',
      excludedReason: 'no-host-forward',
    });
    expect(result.style.forwardsStyle).toBe(false);
    expect(result.style.confidence).toBe('high');
  });

  it('resolves a workspace package that DOES forward style to a high-confidence positive', async () => {
    const pageSource = `import { Card } from '@acme/ui';\nexport function Page() {\n  return <Card />;\n}\n`;
    const result = await detect(pageSource, 'Card', {
      '/workspace/node_modules/@acme/ui/package.json': JSON.stringify({ exports: { '.': './src/index.ts' } }),
      '/workspace/node_modules/@acme/ui/src/index.ts': `export { Card } from './Card';\n`,
      '/workspace/node_modules/@acme/ui/src/Card.tsx': `export function Card({ style, children }: { style?: object; children?: unknown }) {\n  return <div style={style}>{children as any}</div>;\n}\n`,
    });
    expect(result.style.forwardsStyle).toBe(true);
    expect(result.style.confidence).toBe('high');
  });
});

describe('detectForwarding — finding #1: discriminated-union + rest spread', () => {
  it('resolves true, high via the AST rest-spread trace alone (no type step needed)', async () => {
    const source = `
type PropsA = { variant: 'a'; className?: string };
type PropsB = { variant: 'b' };
type Props = PropsA | PropsB;
function Comp({ variant, ...rest }: Props) {
  return <div {...rest}>{variant}</div>;
}
export function Page() { return <Comp variant="a" />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className).toEqual({
      forwardsClassName: true,
      forwardsStyle: true,
      hostProp: null,
      confidence: 'high',
    });
  });

  it('an explicitly-named-out prop is excluded from a co-present rest spread (1c)', async () => {
    // `{ className, ...rest }` — rest does NOT carry className (JS destructuring semantics); the
    // explicit `className` binding is never attached anywhere in the render body → dropped.
    const source = `
function Comp({ className, ...rest }: { className?: string; [k: string]: unknown }) {
  return <div {...rest} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className).toEqual({
      forwardsClassName: false,
      forwardsStyle: true,
      hostProp: null,
      confidence: 'high',
      excludedReason: 'no-host-forward',
    });
  });
});

describe('detectForwarding — finding #4: root-vs-descendant precision', () => {
  it('excludes forwards-non-root-only when the channel lands on a nested element, not the root', async () => {
    const source = `
function Comp({ className }: { className?: string }) {
  return <div><span className={className} /></div>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    // `Comp` only ever destructures `className` — `style` is structurally absent from its props
    // shape at all, a separate `no-host-forward` negative (not `forwards-non-root-only`, which is
    // specific to className's own descendant-only attachment here).
    expect(result.className).toEqual({
      forwardsClassName: false,
      forwardsStyle: false,
      hostProp: null,
      confidence: 'high',
      excludedReason: 'forwards-non-root-only',
    });
    expect(result.style.excludedReason).toBe('no-host-forward');
  });

  it('still resolves positive when the channel is on the actual returned root', async () => {
    const source = `
function Comp({ className }: { className?: string }) {
  return <div className={className}><span>x</span></div>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });

  it('resolves a deep merge (cn(buttonVariants({...,className}))) on the root — shadcn className wiring', async () => {
    const source = `
function Comp({ className, variant }: { className?: string; variant?: string }) {
  return <button className={cn(buttonVariants({ variant, className }))}>hi</button>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });
});

describe('detectForwarding — Fragment returns (multiple candidate roots)', () => {
  it('a Fragment with ALL children carrying the channel resolves high positive', async () => {
    const source = `
function Comp({ className }: { className?: string }) {
  return <><div className={className} /><span className={className} /></>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });

  it(
    'a Fragment where only ONE child carries the channel — no false high (a real write target ' +
      'ambiguity: which of the two roots would the write land on?) — the other root still counts ' +
      'as a positive since ANY root carrying the channel is a viable target for that root',
    async () => {
      const source = `
function Comp({ className }: { className?: string }) {
  return <><div className={className} /><span>not styleable via className</span></>;
}
export function Page() { return <Comp />; }
`;
      const result = await detect(source, 'Comp');
      // Current behavior: any candidate root carrying the channel is high positive — the write
      // planner (A2, unbuilt) is responsible for choosing WHICH root among several to target.
      expect(result.className.forwardsClassName).toBe(true);
      expect(result.className.confidence).toBe('high');
    },
  );

  // PR #719 review round 3, P2, THEN review round 4 (Opus P1/P2, Fable P1, k3 P2): a Fragment
  // child that's a conditionally-rendered expression container (`{flag && <div/>}`) used to be
  // silently DROPPED when flattening the Fragment's children, risking a false confident exclusion
  // from the plain siblings alone. The round-3 fix over-corrected by folding every element
  // reachable through the container into the Fragment's always-co-rendered candidate list — which
  // re-introduced the mutually-exclusive-arms-treated-as-co-rendered bug for a MIXED conditional
  // (`{cond ? <A className={x}/> : <B/>}`): only one arm ever renders, so treating both as real
  // co-rendered evidence produced a false HIGH positive on the render where the non-carrying arm
  // shows up. The round-4 fix never extracts from conditional content at all — it only tracks
  // that unresolved content EXISTS (`permissive`), which can downgrade a would-be exclusion to
  // `unknown` but can never manufacture a `carries`. So a Fragment with conditional content now
  // NEVER resolves high, regardless of whether the conditional arm carries.
  it('a Fragment with a conditionally-rendered `&&` child stays low, never a confident positive from unresolved content', async () => {
    const source = `
function Comp({ flag, className }: { flag?: boolean; className?: string }) {
  return <><span />{flag && <div className={className} />}</>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
  });

  it(
    'a Fragment with a conditionally-rendered `&&` child that does NOT carry stays low, not a false ' +
      'confident exclusion (dropping the conditional content entirely used to falsely conclude ' +
      'no-host-forward from the plain siblings alone)',
    async () => {
      const source = `
function Comp({ flag, className }: { flag?: boolean; className?: string }) {
  return <><span />{flag && <div />}</>;
}
export function Page() { return <Comp />; }
`;
      const result = await detect(source, 'Comp');
      expect(result.className.confidence).toBe('low');
      expect(result.className.excludedReason).toBeUndefined();
    },
  );

  // Review round 4, Fable P1 / Opus #2: the exact mixed-ternary-in-Fragment repro that broke the
  // round-3 fix — must stay low, never the false high positive the earlier extraction produced.
  it('a Fragment with a MIXED ternary child (one arm carries, one does not) stays low', async () => {
    const source = `
function Comp({ cond, className }: { cond?: boolean; className?: string }) {
  return <>{cond ? <div className={className} /> : <span />}</>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // Review round 4, Fable P1: an opaque arm (a helper call, not JSX) alongside a carrying arm
  // inside a Fragment's conditional content — must also stay low, not a confident positive.
  it('a Fragment with an opaque-vs-carrying ternary child stays low', async () => {
    const source = `
function Comp({ cond, className }: { cond?: boolean; className?: string }) {
  return <>{cond ? renderThing() : <div className={className} />}</>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // Review round 4, Opus #1: the carrying element is a DESCENDANT of a conditionally-rendered
  // child, not the conditional child itself — must stay low/unresolved, never a confident
  // `forwards-non-root-only` exclusion drawn from the always-present `<span/>` sibling alone.
  it('a Fragment where the only carrying element is nested inside conditional content stays low', async () => {
    const source = `
function Comp({ flag, className }: { flag?: boolean; className?: string }) {
  return <><span />{flag && <Wrapper><div className={className} /></Wrapper>}</>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // Review round 4, k3 #2: `.map(...)` (and any other call/array expression that could produce
  // JSX) inside a Fragment must get the same conservative "unresolved" treatment, never silently
  // dropped into a confident exclusion.
  it('a Fragment with a `.map(...)` child stays low, not a false confident exclusion', async () => {
    const source = `
function Comp({ items, className }: { items?: string[]; className?: string }) {
  return <><span />{(items ?? []).map((i) => <div key={i} className={className} />)}</>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // Plain TEXT content in a Fragment (a bare identifier, not JSX-producing) must NOT be treated
  // as unresolved — this stays a confident exclusion, same as the non-Fragment case.
  it('a Fragment with plain text content (not JSX-producing) still resolves a confident exclusion', async () => {
    const source = `
function Comp({ title, className }: { title?: string; className?: string }) {
  return <><span />{title}</>;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(false);
    expect(result.className.confidence).toBe('high');
    expect(result.className.excludedReason).toBe('no-host-forward');
  });
});

describe('detectForwarding — PR #719 review round 3, P3: boolean/numeric/string literal arms render no element', () => {
  it('`cond ? <div className={x}/> : false` resolves high positive (false renders nothing, same as null)', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  return compact ? <div className={className} /> : false;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });

  it('`cond ? <div className={x}/> : 0` resolves high positive (a bare literal renders no element)', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  return compact ? <div className={className} /> : 0;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });
});

describe('detectForwarding — finding #2: asChild/Slot flagship case (shadcn/Radix)', () => {
  it('shape (a): ternary-assigned tag identifier — resolves true/high for both channels', async () => {
    const source = `
import { Slot } from '@radix-ui/react-slot';
function Button({ className, asChild = false, ...props }: { className?: string; asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(className)} {...props} />;
}
export function Page() { return <Button asChild />; }
`;
    const result = await detect(source, 'Button');
    expect(result.className).toEqual({
      forwardsClassName: true,
      forwardsStyle: true,
      hostProp: null,
      confidence: 'high',
    });
  });

  it(
    'shape (b): dual early-return — resolves true/high even though the general single-root ' +
      'tracer would only see the LAST branch',
    async () => {
      const source = `
import { Slot } from '@radix-ui/react-slot';
function Button({ className, asChild, ...props }: { className?: string; asChild?: boolean }) {
  if (asChild) {
    return <Slot className={className} {...props} />;
  }
  return <button className={className} {...props} />;
}
export function Page() { return <Button asChild />; }
`;
      const result = await detect(source, 'Button');
      expect(result.className).toEqual({
        forwardsClassName: true,
        forwardsStyle: true,
        hostProp: null,
        confidence: 'high',
      });
    },
  );

  it('does NOT match when Slot is not imported (no false recognizer trigger)', async () => {
    const source = `
function Button({ className, asChild = false }: { className?: string; asChild?: boolean }) {
  const Comp = asChild ? SomethingElse : "button";
  return <Comp className={className} />;
}
export function Page() { return <Button />; }
`;
    // Falls through to the general tracer, which still finds the direct className attribute.
    const result = await detect(source, 'Button');
    expect(result.className.forwardsClassName).toBe(true);
  });
});

describe('detectForwarding — hazard: prop-getter hooks must never false-exclude', () => {
  it("spreading an OPAQUE hook return (not the component's own binding) stays low, never high+false", async () => {
    const source = `
function Comp(props: { className?: string }) {
  const buttonProps = useButtonHook(props);
  return <button {...buttonProps} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    // Never a false high-confidence negative — the whole point of this fixture.
    expect(result.className.excludedReason).toBeUndefined();
  });
});

describe('detectForwarding — styled-components recognizer', () => {
  it('resolves styled.button(...) as true/high without a render-body trace', async () => {
    const source = `const Button = styled.button(({ theme }) => ({ color: theme.fg }));
export function Page() { return <Button>hi</Button>; }
`;
    const result = await detect(source, 'Button');
    expect(result.className).toEqual({
      forwardsClassName: true,
      forwardsStyle: true,
      hostProp: null,
      confidence: 'high',
    });
  });

  it('resolves a tagged-template styled.div`...` the same way', async () => {
    const source = 'const Box = styled.div`color: red;`;\nexport function Page() { return <Box>hi</Box>; }\n';
    const result = await detect(source, 'Box');
    expect(result.className.confidence).toBe('high');
    expect(result.className.forwardsClassName).toBe(true);
  });

  it('styled(UppercaseComponent) — conservatively stays low rather than a blind high (documented simplification)', async () => {
    const source = `const Fancy = styled(SomeComponent)({ color: 'red' });
export function Page() { return <Fancy>hi</Fancy>; }
`;
    const result = await detect(source, 'Fancy');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  it(
    'styled(motion.div) — a MEMBER-EXPRESSION wrap arg is NOT an uppercase Identifier, so it is ' +
      'treated the same as styled.tag (trusted unconditionally) — this is intentional, asserted so a ' +
      'future change to that divergence is a deliberate decision, not an unnoticed side effect',
    async () => {
      const source = `const Box = styled(motion.div)({ color: 'red' });
export function Page() { return <Box>hi</Box>; }
`;
      const result = await detect(source, 'Box');
      expect(result.className).toEqual({
        forwardsClassName: true,
        forwardsStyle: true,
        hostProp: null,
        confidence: 'high',
      });
    },
  );
});

describe('detectForwarding — PR #719 review: mutually-exclusive branches must ALL carry', () => {
  it('a ternary root where only ONE arm carries stays low (branch-dependent, not a confident positive)', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  return compact ? <div /> : <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  it('two early-return branches where only the FIRST carries stays low (order-independence check)', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  if (compact) return <div className={className} />;
  return <div />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
  });

  it(
    'two early-return branches where only the LAST carries stays low (the general tracer used ' +
      'to only inspect the last branch, so this direction alone used to falsely pass)',
    async () => {
      const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  if (compact) return <div />;
  return <div className={className} />;
}
export function Page() { return <Comp />; }
`;
      const result = await detect(source, 'Comp');
      expect(result.className.confidence).toBe('low');
    },
  );

  it('two early-return branches where BOTH carry resolves high positive', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  if (compact) return <span className={className} />;
  return <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });

  it(
    'two early-return branches where NEITHER carries is a confident exclusion (both branches ' +
      'prove the same negative)',
    async () => {
      const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  if (compact) return <span />;
  return <div />;
}
export function Page() { return <Comp />; }
`;
      const result = await detect(source, 'Comp');
      expect(result.className.forwardsClassName).toBe(false);
      expect(result.className.confidence).toBe('high');
      expect(result.className.excludedReason).toBe('no-host-forward');
    },
  );

  // Review round 4, k3/Opus: `hasOpaqueReturn`'s downgrade-from-high path had zero coverage.
  // An opaque sibling return (not JSX, not nullish) next to an all-CARRYING JSX branch must
  // downgrade a would-be high positive to low — never a confident positive when a sibling branch
  // is invisible to this tracer.
  it('an opaque sibling return next to an all-carrying JSX branch downgrades to low, not a confident positive', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  if (compact) return renderHelper(className);
  return <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // The negative direction: an opaque sibling return next to an all-EXCLUDED JSX branch must
  // downgrade to a PROVEN partial exclusion (never a plain unknown) — see the corroboration-
  // resistance test for this same shape in the "step 1 → step 2 wiring" describe block below,
  // which is the one that actually proves the flag does its job end-to-end.
  it('an opaque sibling return next to an all-excluded JSX branch downgrades to a proven partial exclusion', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  if (compact) return renderHelper(className);
  return <div />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });
});

describe('detectForwarding — PR #719 review round 6, Fable P2: channel-name shadowing', () => {
  it(
    "a branch-local const that reuses the CHANNEL's own name stays low, never a false positive " +
      'from the coincidental spelling match',
    async () => {
      const source = `
function Comp({ className, dark }: { className?: string; dark?: boolean }) {
  if (dark) {
    const className = darkTheme.cls;
    return <div className={className} />;
  }
  return <div className={className} />;
}
export function Page() { return <Comp />; }
`;
      const result = await detect(source, 'Comp');
      // The dark branch's `className` refers to the LOCAL shadow (darkTheme.cls), never the
      // prop — only the other branch genuinely forwards. Mixed, never a confident positive.
      expect(result.className.confidence).toBe('low');
    },
  );

  // `const className = cn('dark', className)` is TDZ-invalid JS in real Node/browser semantics —
  // the RHS `className` refers to the new (not-yet-initialized) binding, not the outer prop, so
  // this would throw at runtime. The cycle guard (`visiting`) still terminates cleanly on it
  // rather than looping, and conservatively resolves to "doesn't carry" (never a crash, never a
  // false positive on pathological input) — pinned here so a future change to the guard is
  // deliberate, not because this shape is meaningful real-world code.
  it('a self-referential shadow initializer (TDZ-invalid) terminates via the cycle guard, never a false positive', async () => {
    const source = `
function Comp({ className, dark }: { className?: string; dark?: boolean }) {
  if (dark) {
    const className = cn('dark', className);
    return <div className={className} />;
  }
  return <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });
});

describe('detectForwarding — PR #719 review round 6, Fable P2 (switch/try/loop hidden returns)', () => {
  it('a return hidden inside a switch statement downgrades an all-carrying visible branch to low', async () => {
    const source = `
function Comp({ mode, className }: { mode?: string; className?: string }) {
  switch (mode) {
    case 'a':
      return <span />;
  }
  return <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  it('a return hidden inside a try block downgrades an all-excluded visible branch to low, not a confident exclusion', async () => {
    const source = `
function Comp({ className }: { className?: string }) {
  try {
    return <span className={className} />;
  } catch {
    // handled elsewhere
  }
  return <div />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    // The try block's return DOES carry className, but it's invisible to this tracer — the
    // downgrade must still fire, never a confident `no-host-forward` from the visible <div/>
    // alone. (provenPartialExclusion's resistance to type corroboration under the real wiring is
    // already covered end-to-end by the dedicated "opaque-sibling-return... stays low" test in
    // the step 1 → step 2 wiring describe block below — not re-proven here.)
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });
});

describe('detectForwarding — PR #719 review round 2: `&&` guard is not itself an alternative', () => {
  it(
    '`flag && <div className={className}/>` resolves high positive (the left side is a ' +
      'truthiness guard, not a rendered alternative — a regression in the first fix draft)',
    async () => {
      const source = `
function Comp({ flag, className }: { flag?: boolean; className?: string }) {
  return flag && <div className={className} />;
}
export function Page() { return <Comp />; }
`;
      const result = await detect(source, 'Comp');
      expect(result.className.forwardsClassName).toBe(true);
      expect(result.className.confidence).toBe('high');
    },
  );

  it(
    "`fallback || <div className={className}/>` stays low — unlike `&&`, `||`'s left side IS a " +
      "genuine candidate render value (opaque here), so a real forwarding one on the right doesn't " +
      'make it a confident positive',
    async () => {
      const source = `
function Comp({ fallback, className }: { fallback?: unknown; className?: string }) {
  return fallback || <div className={className} />;
}
export function Page() { return <Comp />; }
`;
      const result = await detect(source, 'Comp');
      expect(result.className.confidence).toBe('low');
    },
  );

  // Review round 4 (Fable/k3): `??` is documented as both-sides-flattened alongside `||` (same
  // asymmetry as `||`, unlike `&&`) but was untested.
  it('`fallback ?? <div className={className}/>` stays low, same as `||` (both sides are real alternatives)', async () => {
    const source = `
function Comp({ fallback, className }: { fallback?: unknown; className?: string }) {
  return fallback ?? <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.confidence).toBe('low');
  });
});

describe('detectForwarding — PR #719 review: Slot-ternary shape with zero attributes never forwards', () => {
  it('recognizing the asChild/Slot ternary shape alone is not evidence of forwarding', async () => {
    const source = `
import { Slot } from '@radix-ui/react-slot';
function Button({ asChild = false }: { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp />;
}
export function Page() { return <Button asChild />; }
`;
    const result = await detect(source, 'Button');
    // No className/style prop is even destructured — structurally absent, a confident exclusion,
    // never the false HIGH_POSITIVE the old blind Slot-shape bypass produced.
    expect(result.className.forwardsClassName).toBe(false);
    expect(result.className.excludedReason).toBe('no-host-forward');
  });
});

describe('detectForwarding — PR #719 review: intermediate binding tracing', () => {
  it('follows className through a single intermediate const assignment (`const merged = cn(...)`)', async () => {
    const source = `
function Comp({ className }: { className?: string }) {
  const merged = cn('base', className);
  return <div className={merged} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });

  // PR #719 review round 4, Opus #2: binding-follow is `const`-only. Here `cls` (a `let`) is
  // REASSIGNED to a static string right after declaration, so the value actually rendered is
  // NEVER `className` — the component genuinely does not forward it. Before this fix,
  // `deepReferencesIdentifier` followed EVERY declaration's initializer regardless of `const`/
  // `let`, so it resolved `cls` back to `className`'s value and reported a FALSE high positive.
  // With `let` excluded from binding-follow, the trace correctly finds no attachment and reports
  // the accurate confident exclusion — not a regression, the fix removing a false positive.
  it('resolves a confident exclusion for a `let` binding reassigned to a static value (no false positive from stale binding-follow)', async () => {
    const source = `
function Comp({ className }: { className?: string }) {
  let cls = className;
  cls = 'static-only';
  return <div className={cls} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(false);
    expect(result.className.confidence).toBe('high');
    expect(result.className.excludedReason).toBe('no-host-forward');
  });

  // PR #719 review round 5, k3 P1: a `const` name legally reused across sibling `if`/`else`
  // branches used to collide in a single, function-wide bindings map (last-writer-wins), which
  // could produce a confident FALSE verdict in EITHER direction depending purely on declaration
  // order. Scoping bindings per return-path (matching real JS block scoping) fixes both.
  it('a reused `const` name in a branch that forwards, followed by an unrelated reuse after the `if`, stays low (not a false exclusion)', async () => {
    const source = `
function Comp({ className, dark }: { className?: string; dark?: boolean }) {
  if (dark) {
    const cls = cn('dark', className);
    return <div className={cls} />;
  }
  const cls = 'light';
  return <div className={cls} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    // Mixed: the dark branch genuinely carries, the light branch genuinely doesn't — never a
    // confident verdict either way, and definitely not the false `no-host-forward` exclusion the
    // old global last-writer-wins map produced (both branches' `cls` collapsing to 'light').
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  it('the reverse declaration order (unrelated reuse first, forwarding reuse inside the `if`) also stays low (not a false positive)', async () => {
    const source = `
function Comp({ className, dark }: { className?: string; dark?: boolean }) {
  const cls = 'light';
  if (dark) {
    const cls = cn('dark', className);
    return <div className={cls} />;
  }
  return <div className={cls} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    // The OLD global map would have resolved BOTH branches' `cls` to the dark-branch initializer
    // (whichever declaration was visited last), reporting a false HIGH positive even on the
    // final `return`, which actually renders 'light' and never touches `className` at all.
    expect(result.className.confidence).toBe('low');
  });
});

describe('detectForwarding — PR #719 review round 5, Opus #1: empty Fragment renders nothing', () => {
  it('`cond ? <div className={x}/> : <></>` resolves high positive, same as `: null`/`: false`', async () => {
    const source = `
function Comp({ compact, className }: { compact?: boolean; className?: string }) {
  return compact ? <></> : <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });

  it('`cond ? <div className={x}/> : <>{title}</>` (text-only Fragment) also resolves high positive', async () => {
    const source = `
function Comp({ compact, className, title }: { compact?: boolean; className?: string; title?: string }) {
  return compact ? <>{title}</> : <div className={className} />;
}
export function Page() { return <Comp />; }
`;
    const result = await detect(source, 'Comp');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.className.confidence).toBe('high');
  });
});

describe('detectForwarding — plain non-forwarding component (structural absence)', () => {
  it('a destructure with no style/className/rest is a high-confidence negative on both channels', async () => {
    const source = `
function Box({ title }: { title: string }) {
  return <div>{title}</div>;
}
export function Page() { return <Box title="x" />; }
`;
    const result = await detect(source, 'Box');
    expect(result.className.forwardsClassName).toBe(false);
    expect(result.className.confidence).toBe('high');
    expect(result.className.excludedReason).toBe('no-host-forward');
    expect(result.style.forwardsStyle).toBe(false);
    expect(result.style.excludedReason).toBe('no-host-forward');
  });
});

describe('detectForwarding — HOC unwrap and cross-file resolution still work', () => {
  it('still resolves through memo()', async () => {
    const source = `import { memo } from 'react';
const Card = memo(({ style, children }: { style?: object; children?: unknown }) => <div style={style}>{children}</div>);
export function Page() { return <Card>hi</Card>; }
`;
    const result = await detect(source, 'Card');
    expect(result.style.forwardsStyle).toBe(true);
    expect(result.style.confidence).toBe('high');
  });

  it('resolves an imported cross-file component', async () => {
    const widgetsPath = '/workspace/src/widgets.tsx';
    const importerSource = `import { Forward } from './widgets';
export function Page() { return <Forward />; }
`;
    const widgetsSource = `export const Forward = ({ style }: { style?: object }) => <div style={style} />;\n`;
    const result = await detect(importerSource, 'Forward', { [widgetsPath]: widgetsSource });
    expect(result.style.forwardsStyle).toBe(true);
    expect(result.style.confidence).toBe('high');
  });

  it('falls back to low/unknown for an unresolvable external package', async () => {
    const source = `import { ExternalThing } from 'some-external-package';
export function Page() { return <ExternalThing />; }
`;
    const result = await detect(source, 'ExternalThing');
    expect(result.className.confidence).toBe('low');
    expect(result.className.forwardsClassName).toBe(true); // admitted as probable, never excluded
  });

  // HYP-1294 (review finding, high-severity concern): the new proactive inspector warning
  // (`useNoStyleWriteSurfaceWarning`, client/components/RightSidebar/hooks/) is the FIRST live
  // consumer of `componentPropSurface`, which raised the question of whether an UNANALYZABLE
  // component (this exact "unresolvable external package" shape) would collapse to the same
  // all-false projection as a PROVEN non-forwarding component — which would fire the warning on
  // every unreachable-source component in the inspector, not just genuinely non-forwarding ones.
  // Pins the full chain end to end: `detectForwarding`'s low-confidence/`forwards:true` fallback
  // (verified above) -> `projectForwardDetectionToPropSurface`'s low-confidence-never-excludes
  // projection -> `hasNoStyleWriteSurface` reading `false` off that projection, i.e. the warning
  // does NOT fire for a component A1 simply could not analyze.
  it('an unanalyzable component projects to a surface that does NOT trigger the proactive warning', async () => {
    const source = `import { ExternalThing } from 'some-external-package';
export function Page() { return <ExternalThing />; }
`;
    const detection = await detect(source, 'ExternalThing');
    const propSurface = projectForwardDetectionToPropSurface(detection);
    expect(propSurface.acceptsClassName).toBe(true);
    expect(propSurface.acceptsStyle).toBe(true);
    expect(hasNoStyleWriteSurface(propSurface)).toBe(false);
  });
});

describe('detectForwarding — step 1 → step 2 wiring (real files, type corroboration enabled)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'hyp-1229-forward-detect-wiring-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Writes `source` to a real file and runs it through `detectForwarding` with type
   *  corroboration ENABLED (the real, default wiring) — for tests that specifically need to
   *  prove something about step 2, not just step 1 in isolation. */
  async function detectWithCorroboration(source: string, componentName: string) {
    const filePath = path.join(dir, `${componentName.toLowerCase()}.tsx`);
    writeFileSync(filePath, source, 'utf8');
    const ast = parseCode(source);
    const element = findAllJSXElements(ast).find(
      (e) =>
        e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === componentName,
    )?.element;
    if (!element) throw new Error(`no <${componentName}> element in fixture`);
    return detectForwarding({ ast, filePath, element, fileIO: new NodeFileIO(), aliasMap: {} });
  }

  // PR #719 review round 3, P1: the mixed-branch fix in forward-detect-trace.ts (traceChannelForward
  // stays `low` when one alternative provably doesn't forward) was silently undone by type
  // corroboration under the REAL default wiring — the channel is referenced in the carrying
  // branch and the type declares it, so the naive "referenced anywhere" gate alone still let the
  // type step upgrade this back to a false high positive. Must stay `low`.
  it('a mixed-branch component stays low even with type corroboration enabled (not silently re-upgraded)', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { compact?: boolean; className?: string };
function Comp({ compact, className }: Props) {
  if (compact) return <div />;
  return <div className={className} />;
}
export function Consumer() { return <Comp />; }
`,
      'Comp',
    );
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // Review round 4, k3: the SAME resistance-to-corroboration must hold for the `hasOpaqueReturn`
  // → `provenPartialExclusion` downgrade path, not just the plain mixed-alternatives path above.
  // The identifier IS referenced (as an argument to the opaque `renderHelper` call) and the type
  // DOES declare it, so without the downgrade carrying `provenPartialExclusion` through, this
  // would be upgraded to a false high positive under the real wiring — the exact round-3-P1
  // failure class via a different producer of the flag.
  it('an opaque-sibling-return component stays low even with type corroboration enabled', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { compact?: boolean; className?: string };
function Comp({ compact, className }: Props) {
  if (compact) return renderHelper(className);
  return <div />;
}
export function Consumer() { return <Comp />; }
`,
      'Comp',
    );
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // PR #719 review round 3, P1: a narrow member read of an UNRELATED property off a whole-props
  // binding (`props.children`) must not count as evidence the CHANNEL flows anywhere — className
  // is never touched at all here.
  it('a whole-props component that only reads an unrelated property stays low even with corroboration enabled', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; children?: unknown };
function Widget(props: Props) {
  return <div>{props.children}</div>;
}
export function Consumer() { return <Widget />; }
`,
      'Widget',
    );
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // PR #719 review round 4, P2: reading the channel's OWN property directly off a whole-props
  // binding (`props.className`) is NOT reliable forwarding evidence either — it only proves the
  // VALUE was read, not where it goes; here it's rendered as CHILD TEXT, never an attribute,
  // exactly like the equivalent explicit-destructure shape two tests up. An earlier draft
  // special-cased a direct channel-property read as "eligible for corroboration" and got a false
  // HIGH positive here — the fix must decline to corroborate, leaving this at `low` (the AST
  // trace alone can't reach a confident exclusion for a whole-props destructure — that structural
  // asymmetry with the explicit-binding case is pre-existing, not part of this fix; what this
  // fix controls is that the type step doesn't paper over it with a false positive).
  it("a whole-props component that reads the channel's own property but only as child text is not upgraded by corroboration", async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  const x = props.className;
  return <div>{x}</div>;
}
export function Consumer() { return <Widget title="x" />; }
`,
      'Widget',
    );
    expect(result.className.confidence).toBe('low');
  });

  // The render body spreads an intermediate `merged` object (not the component's own `props`
  // binding) onto the root — the AST tracer can't dataflow through that reassignment (same class
  // of hazard as the prop-getter-hook test above), so step 1 alone stays low. The declared type
  // DOES cover the channel, so step 2 should upgrade the verdict to high.
  const FIXTURE = `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  const merged = { ...props };
  return <div {...merged} />;
}
export function Consumer() { return <Widget title="x" />; }
`;

  it('upgrades a low AST trace to high positive via type corroboration when enabled', async () => {
    const filePath = path.join(dir, 'widget.tsx');
    writeFileSync(filePath, FIXTURE, 'utf8');
    const ast = parseCode(FIXTURE);
    const element = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Widget',
    )?.element;
    if (!element) throw new Error('no <Widget> element in fixture');

    const result = await detectForwarding({
      ast,
      filePath,
      element,
      fileIO: new NodeFileIO(),
      aliasMap: {},
      // skipTypeCorroboration deliberately omitted — this is the real, default wiring.
    });
    // `style` isn't in `Props` at all, so its own corroboration stays `not-declared` — the type
    // step never claims a channel it wasn't asked to check, it only upgrades `className` here.
    expect(result.className.confidence).toBe('high');
    expect(result.className.forwardsClassName).toBe(true);
    expect(result.style.confidence).toBe('low');
  });

  it('stays low when skipTypeCorroboration is explicitly set, proving the flag actually gates step 2', async () => {
    const filePath = path.join(dir, 'widget.tsx');
    writeFileSync(filePath, FIXTURE, 'utf8');
    const ast = parseCode(FIXTURE);
    const element = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Widget',
    )?.element;
    if (!element) throw new Error('no <Widget> element in fixture');

    const result = await detectForwarding({
      ast,
      filePath,
      element,
      fileIO: new NodeFileIO(),
      aliasMap: {},
      skipTypeCorroboration: true,
    });
    expect(result.className.confidence).toBe('low');
  });

  // PR #719 review finding (P2, forward-detect-type.ts): a type declaration alone must never
  // manufacture a positive. `props` is never referenced ANYWHERE in this render body (unlike the
  // FIXTURE above, which spreads it into `merged`) — the type step must not upgrade it.
  const NEVER_TOUCHED_FIXTURE = `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  return <div />;
}
export function Consumer() { return <Widget title="x" />; }
`;

  it('does NOT upgrade via type corroboration when the render body never references the prop at all', async () => {
    const filePath = path.join(dir, 'widget.tsx');
    writeFileSync(filePath, NEVER_TOUCHED_FIXTURE, 'utf8');
    const ast = parseCode(NEVER_TOUCHED_FIXTURE);
    const element = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Widget',
    )?.element;
    if (!element) throw new Error('no <Widget> element in fixture');

    const result = await detectForwarding({
      ast,
      filePath,
      element,
      fileIO: new NodeFileIO(),
      aliasMap: {},
      // skipTypeCorroboration deliberately omitted — proving step 2 itself declines, not that
      // it never ran.
    });
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // PR #719 review round 4, Opus #1: a same-named identifier bound by a NESTED function's OWN
  // param (a shadowing scope) must not satisfy the corroboration gate. Step 1 alone must stay
  // `low` here (an unresolved `.map(...)` descendant, not a confident exclusion — see the
  // `.map(...)`-in-Fragment tests above for the same mechanic outside a Fragment) so this test
  // actually exercises step 2's gate, not just step 1's own verdict: without the shadowing fix,
  // the gate would find `className` inside the unrelated inner closure's OWN param/body and let
  // the type declaration upgrade this to a false high positive.
  it('does NOT upgrade via type corroboration when the only reference is a shadowed nested-function param', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; title: string; items: string[] };
function Comp({ className, title, items }: Props) {
  const handler = (className: string) => doThing(className);
  return <div>{items.map((i) => <span key={i}>{i}</span>)}</div>;
}
export function Consumer() { return <Comp title="x" items={[]} />; }
`,
      'Comp',
    );
    expect(result.className.confidence).toBe('low');
    expect(result.className.excludedReason).toBeUndefined();
  });

  // PR #719 review round 5, k3 P2/P3 + Opus #3: an optional-chained or computed member read off
  // a whole-props binding must be treated exactly like a plain non-computed read — a narrow
  // property read, never whole-object flow evidence.
  it('does NOT upgrade via corroboration when the only reference is an optional-chained property read', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  const x = props?.className;
  return <div>{x}</div>;
}
export function Consumer() { return <Widget title="x" />; }
`,
      'Widget',
    );
    expect(result.className.confidence).toBe('low');
  });

  it('does NOT upgrade via corroboration when the only reference is a computed property read', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  const x = props['className'];
  return <div>{x}</div>;
}
export function Consumer() { return <Widget title="x" />; }
`,
      'Widget',
    );
    expect(result.className.confidence).toBe('low');
  });

  // PR #719 review round 6, Fable P1: destructuring and plain aliasing are the SAME narrow-read
  // pattern as `props.className` / `props['className']` / `props?.className`, just spelled
  // differently — both must be excluded from corroboration eligibility too.
  it('does NOT upgrade via corroboration when the only reference is a no-rest destructure', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  const { className } = props;
  return <div>{className}</div>;
}
export function Consumer() { return <Widget title="x" />; }
`,
      'Widget',
    );
    expect(result.className.confidence).toBe('low');
  });

  it('does NOT upgrade via corroboration when the only reference is a plain alias', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  const p = props;
  return <div>{p.className}</div>;
}
export function Consumer() { return <Widget title="x" />; }
`,
      'Widget',
    );
    expect(result.className.confidence).toBe('low');
  });

  // Positive control: a destructure WITH a rest element still carries the remaining shape
  // onward via the rest binding — that must still count as genuine whole-object flow.
  it('a destructure WITH a rest element is still eligible for corroboration via the rest binding', async () => {
    const result = await detectWithCorroboration(
      `
type Props = { className?: string; title: string };
function Widget(props: Props) {
  const { title, ...rest } = props;
  return <div {...rest}>{title}</div>;
}
export function Consumer() { return <Widget title="x" />; }
`,
      'Widget',
    );
    expect(result.className.confidence).toBe('high');
    expect(result.className.forwardsClassName).toBe(true);
  });
});

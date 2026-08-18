/**
 * @file A1 forward-detector — step 2 (type/LSP corroboration) unit tests (HYP-1229).
 *
 * Accessed via: bun test lib/style-read/forward-detect-type.test.ts
 * Reads REAL files off disk (ts.createProgram uses `ts.sys`, not the `FileIO` abstraction — see
 * forward-detect-type.ts's realm-scoping note), so this writes fixtures to a real temp directory.
 * Covers the exact regression the revised A1 plan's finding #1 exists to avoid: a UNION props
 * type where only SOME arms declare the channel must NOT be misread as declared (the
 * `getProperties()`-on-a-union trap) — only when EVERY arm independently declares it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { corroborateChannelViaType } from './forward-detect-type';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'hyp-1229-forward-detect-type-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFixture(source: string): string {
  const filePath = path.join(dir, 'widget.ts');
  writeFileSync(filePath, source, 'utf8');
  return filePath;
}

describe('corroborateChannelViaType', () => {
  it('declares — a plain object props type with the property', () => {
    const filePath = writeFixture(`
type Props = { className?: string; title: string };
function Widget(props: Props) { return props.title; }
`);
    expect(corroborateChannelViaType(filePath, 'Widget', 'className')).toBe('declared');
  });

  it('declares — EVERY union arm independently has the property (the finding #1 fix)', () => {
    const filePath = writeFixture(`
type PropsA = { variant: 'a'; className?: string };
type PropsB = { variant: 'b'; className?: string };
type Props = PropsA | PropsB;
function Widget(props: Props) { return props.variant; }
`);
    expect(corroborateChannelViaType(filePath, 'Widget', 'className')).toBe('declared');
  });

  it('not-declared — only SOME union arms have the property (must NOT collapse to "declared")', () => {
    // If this used `propsType.getProperties()` (the trap this module exists to avoid), TS's
    // apparent-type algorithm would silently drop `className` since PropsB lacks it — this test
    // exists specifically to catch that regression.
    const filePath = writeFixture(`
type PropsA = { variant: 'a'; className?: string };
type PropsB = { variant: 'b' };
type Props = PropsA | PropsB;
function Widget(props: Props) { return props.variant; }
`);
    expect(corroborateChannelViaType(filePath, 'Widget', 'className')).toBe('not-declared');
  });

  it('declares via an intersection type (ANY member declaring it is sufficient)', () => {
    const filePath = writeFixture(`
type Base = { title: string };
type Styleable = { className?: string };
type Props = Base & Styleable;
function Widget(props: Props) { return props.title; }
`);
    expect(corroborateChannelViaType(filePath, 'Widget', 'className')).toBe('declared');
  });

  it('not-declared — the type simply lacks the property', () => {
    const filePath = writeFixture(`
type Props = { title: string };
function Widget(props: Props) { return props.title; }
`);
    expect(corroborateChannelViaType(filePath, 'Widget', 'className')).toBe('not-declared');
  });

  it('resolves through an arrow-function component with a typed param', () => {
    const filePath = writeFixture(`
type Props = { className?: string };
const Widget = (props: Props) => props.className;
`);
    expect(corroborateChannelViaType(filePath, 'Widget', 'className')).toBe('declared');
  });

  it('unknown — the file does not exist on real disk (safe no-op, matches the FileIO-realm test fixtures)', () => {
    expect(corroborateChannelViaType('/definitely/not/a/real/path.ts', 'Widget', 'className')).toBe('unknown');
  });

  it('unknown — the named component is not found in the file', () => {
    const filePath = writeFixture(`
type Props = { className?: string };
function OtherName(props: Props) { return props.className; }
`);
    expect(corroborateChannelViaType(filePath, 'Widget', 'className')).toBe('unknown');
  });
});

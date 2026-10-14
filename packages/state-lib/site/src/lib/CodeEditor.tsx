import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  hoverTooltip,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentUnit } from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { API_DOCS, membersOf } from './api-docs';

/**
 * The playground's editor (R80, R81).
 *
 * CodeMirror rather than a textarea with a highlight layer behind it, because
 * the two had to agree on every metric that affects text layout and any
 * disagreement drifts the caret away from the glyphs — and because bracket
 * matching, an undo history, multiple cursors and completion are what makes an
 * editor feel like one. It costs about 140 kB gzipped, which is the honest
 * price and is recorded in the commit that introduced it.
 *
 * Deliberately NOT Monaco, and the reason is worth stating because it is not
 * the obvious one: Monaco does not give you TypeScript either. Its type
 * intelligence is a separate worker carrying the TypeScript compiler, several
 * megabytes of it, against a site that is one self-contained file opening from
 * disk. Without that worker Monaco is a heavier version of this. So the type
 * story is the same in both, and this file spends its budget on the parts that
 * differ: completion over the toolkit's own API, and a hover that knows what a
 * value held at the step being shown — which no language service can tell you.
 */

/** The current debugger line, as a decoration the page can push in. */
const setStepLine = StateEffect.define<number>();
const stepLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setStepLine)) continue;
      const line = e.value;
      if (line < 1 || line > tr.state.doc.lines) return Decoration.none;
      const at = tr.state.doc.line(line);
      deco = Decoration.set([Decoration.line({ class: 'cm-stepline' }).range(at.from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The site's own palette, so the editor is not a foreign object on the page. */
const theme = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: 'var(--hl-kw, #8250df)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--hl-str, #0a6b57)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--hl-com, #6b7c78)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null], color: 'var(--hl-num, #b45309)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--hl-fn, #2563a8)' },
  { tag: [t.propertyName], color: 'var(--hl-prop, inherit)' },
  { tag: [t.typeName, t.className], color: 'var(--hl-type, #2563a8)' },
]);

export type EditorValues = Record<string, unknown>;

/** Completion over exactly what the sandbox puts in scope — the same index the
 *  hover reads, so a name that completes is a name that can be explained. */
function completeApi(scope: () => string[]) {
  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/[\w$]*/);
    if (!word) return null;
    // After `store.` offer the store's methods with their real signatures — this
    // list comes from the compiler's output, not from anything typed by hand.
    // Checked BEFORE the empty-word bail-out: the moment the dot is typed the word
    // is empty, and that is exactly when a member list is wanted.
    const receiver = /([\w$]+)\.$/.exec(ctx.state.doc.sliceString(Math.max(0, word.from - 40), word.from))?.[1];
    if (receiver) {
      const members = membersOf(receiver);
      if (members.length) {
        return {
          from: word.from,
          validFor: /^[\w$]*$/,
          options: members.map((m) => ({ label: m.label, type: 'method', detail: m.sig, info: m.doc || undefined })),
        };
      }
    }
    if (word.from === word.to && !ctx.explicit) return null;
    const locals = scope();
    return {
      from: word.from,
      options: [
        ...Object.entries(API_DOCS).map(([label, d]) => ({ label, type: 'function', detail: d.sig, info: d.doc })),
        ...locals
          .filter((n) => !(n in API_DOCS))
          .map((label) => ({ label, type: 'variable', detail: 'in scope here' })),
      ],
    };
  };
}

export function CodeEditor({
  value,
  onChange,
  activeLine,
  values,
  describe,
  onLineClick,
  minHeight = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 1-based line the debugger is stopped on, 0 for none. */
  activeLine?: number;
  /** Values in scope at the step being shown, for the hover. */
  values?: EditorValues;
  /** Renders the hover body for a name. Kept out of here so the page owns the
   *  formatting and this file owns only the editor. */
  describe?: (name: string, values?: EditorValues, receiver?: string) => HTMLElement | null;
  /** A click on a line, 1-based — the debugger uses it to stop on that statement. */
  onLineClick?: (line: number) => void;
  minHeight?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** Read through refs so the extensions are built once: rebuilding them on
   *  every render would drop the selection and the undo history. */
  const latest = useRef({ onChange, values, describe, onLineClick });
  latest.current = { onChange, values, describe, onLineClick };

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      closeBrackets(),
      indentUnit.of('  '),
      javascript({ typescript: true, jsx: true }),
      syntaxHighlighting(theme),
      autocompletion({ override: [completeApi(() => Object.keys(latest.current.values ?? {}))] }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      stepLineField,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) latest.current.onChange(u.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        click(e, v) {
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos != null) latest.current.onLineClick?.(v.state.doc.lineAt(pos).number);
          return false; // never swallow the click — the caret must still move
        },
      }),
      hoverTooltip((v, pos) => {
        const line = v.state.doc.lineAt(pos);
        const text = line.text;
        const col = pos - line.from;
        const before = /[\w$]*$/.exec(text.slice(0, col))?.[0] ?? '';
        const after = /^[\w$]*/.exec(text.slice(col))?.[0] ?? '';
        const name = before + after;
        if (!name) return null;
        // `store.undo` — the word before the dot decides which type's member this is.
        const receiver = /([\w$]+)\.\s*$/.exec(text.slice(0, col - before.length))?.[1];
        const dom = latest.current.describe?.(name, latest.current.values, receiver);
        if (!dom) return null;
        return { pos: pos - before.length, end: pos + after.length, above: false, create: () => ({ dom }) };
      }),
      EditorView.theme({ '&': { minHeight: `${minHeight}px` } }),
    ];
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Built once per mount on purpose — see the note on `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The page owns the text (reset, switching example), so pushed changes win —
   *  but only when they actually differ, or every keystroke would round-trip
   *  through a full document replacement and lose the cursor. */
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setStepLine.of(activeLine ?? 0) });
  }, [activeLine]);

  return (
    <div className="editor-shell">
      <div className="cm-host" ref={host} />
      <pre data-export-only className="editor-static">
        {value}
      </pre>
    </div>
  );
}

import { useState } from 'react';
import { snippetHref } from './snippet-transfer';
import type { SelectorCase } from '../data/selector-datalog-corpus';
type Pair = { label: string; left: string[]; right: string[]; hint: string };
const MAP: Record<string, Pair[]> = {
  filter: [
    {
      label: 'excluded types',
      left: ['excludedTypes'],
      right: ['?excluded-set'],
      hint: 'Same exclusion input, but the Datalog parameter must be a SET, not a collection binding.',
    },
    {
      label: 'gap exception',
      left: ["'gap'"],
      right: ['"gap"'],
      hint: 'The OR branch must keep gaps even when the exclusion set contains gap.',
    },
    {
      label: 'predicate',
      left: ['filter', 'includes'],
      right: [':where', 'contains?'],
      hint: 'The predicate matches only after the schema conversion; Datalog output ordering still needs a host step.',
    },
  ],
  join: [
    {
      label: 'thread key',
      left: ['rootId'],
      right: ['?root'],
      hint: 'The root key becomes an explicit query parameter. This source excerpt contains only selector INPUTS, not its complete callback.',
    },
    {
      label: 'relationship',
      left: ['postsInThread'],
      right: [':post/root'],
      hint: 'A lookup of an id array is remodeled as entity relations. It is not a literal line-for-line translation.',
    },
  ],
  'keyed-lookup': [
    {
      label: 'lookup key',
      left: ['id'],
      right: ['?key'],
      hint: 'A common key alone does not preserve ordered fallback priority.',
    },
    {
      label: 'group key',
      left: ['byGroupId'],
      right: [':conversation/group-id'],
      hint: 'Lookup maps become indexed attributes. Uniqueness within each attribute does not guarantee cross-attribute precedence.',
    },
  ],
  aggregate: [
    {
      label: 'channel identity',
      left: ['channelId'],
      right: ['?ch'],
      hint: ':with retains distinct channels contributing equal values; removing it can change sum semantics.',
    },
    {
      label: 'amount',
      left: ['unreadCount'],
      right: ['?unread'],
      hint: 'The proposed schema PRECOMPUTES this amount. It does not implement calculateUnreadCount or its collapsedThreads rules.',
    },
  ],
  'recursive-traversal': [
    {
      label: 'traversal',
      left: ['order', 'ids'],
      right: ['descendant', '?child'],
      hint: 'Both describe reachable descendants, but only the JS excerpt encodes document order. A path/position model and ordering step are still required.',
    },
  ],
  'wall-clock': [
    {
      label: 'time input',
      left: ['now'],
      right: ['?now'],
      hint: 'Passing now makes the dependency visible; a scheduler still has to advance it. The source excerpt alone is not the entire expiry predicate.',
    },
  ],
};
export function MappedPair({ item }: { item: SelectorCase }) {
  const pairs = MAP[item.id] ?? [];
  const [selected, setSelected] = useState(0);
  const render = (text: string, side: 'left' | 'right') => {
    const tokens = pairs.flatMap((p, i) => p[side].map((t) => ({ t, i }))).sort((a, b) => b.t.length - a.t.length);
    if (!tokens.length) return text;
    const regex = new RegExp(`(${tokens.map(({ t }) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    return text.split(regex).map((part, i) => {
      const hit = tokens.find((t) => t.t === part);
      return hit ? (
        <span
          key={i}
          className={`mapped-token${selected === hit.i ? ' is-paired' : ''}`}
          title={pairs[hit.i].hint}
          tabIndex={0}
          onFocus={() => setSelected(hit.i)}
          onMouseEnter={() => setSelected(hit.i)}
        >
          {part}
        </span>
      ) : (
        part
      );
    });
  };
  const code = (text: string, side: 'left' | 'right', lang: string) => (
    <div className="codeblock">
      <a className="code-repl" href={snippetHref(text, lang, item.what)}>
        try it →
      </a>
      <pre className={`pg-code lang-${lang}`}>
        <code>{render(text, side)}</code>
      </pre>
    </div>
  );
  return (
    <>
      {!!pairs.length && (
        <>
          <div className="query-stages">
            {pairs.map((p, i) => (
              <button key={p.label} aria-pressed={i === selected} onClick={() => setSelected(i)}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="query-hint" role="status">
            {pairs[selected].hint}
          </p>
        </>
      )}
      <div className="svd-pair">
        <div>
          <div className="svd-pair-label">Original source excerpt — surrounding code omitted</div>
          {code(item.selectorCode, 'left', 'ts')}
        </div>
        <div>
          <div className="svd-pair-label">Designed Datalog sketch — not executed</div>
          {item.datalogForm ? (
            code(item.datalogForm, 'right', 'clojure')
          ) : (
            <p className="svd-nodatalog">
              No equivalent has been authored for this source fragment. An ordered host stage or different data model
              may be appropriate; absence here is not a proof of inexpressibility.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

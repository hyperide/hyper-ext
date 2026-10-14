/** The two pure rules the cross-reference system rests on, over the inputs the corpus does not
 *  contain (R54).
 *
 *  `tools/reference-tour.mts` checks the system against the real rendered site, which is the only
 *  way to prove the end-to-end contract — but it can only exercise content that exists. Both rules
 *  below were changed twice under review, each time for a case the corpus has no example of: a
 *  four-digit id, a tilde fence, a four-backtick fence quoting a three-backtick line, an inline
 *  `~~~` in prose. Those are exactly the inputs that arrive later, in a content edit, with nobody
 *  thinking about this file. So they get fixtures.
 *
 *  Run: tsx tools/ref-pattern.check.mts
 */
import { REF_ID_SRC, withoutCode } from '../src/lib/ref-pattern';

let bad = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ---- the id pattern ---------------------------------------------------------------------------
// Definition markers embed this WITHOUT a boundary of their own, so the pattern has to reject a
// longer id rather than match a prefix of it. A truncating match is worse than no match: it puts
// R123's anchor on R1234's bullet and sends every R123 link to the wrong requirement.
const bare = new RegExp(`(${REF_ID_SRC})`);
const first = (s: string) => bare.exec(s)?.[1] ?? null;

check('an ordinary id matches whole', first('R25') === 'R25', String(first('R25')));
check('a two-digit id matches whole', first('F10') === 'F10', String(first('F10')));
check('the highest real id matches', first('R82') === 'R82', String(first('R82')));
check('a four-digit id is REJECTED, not truncated', first('R1234') === null, String(first('R1234')));
check('an id with a letter suffix is rejected', first('R25x') === null, String(first('R25x')));
check(
  'a real id next to a rejected one is still found',
  first('R1234 and R25') === 'R25',
  String(first('R1234 and R25')),
);
check('punctuation after an id is a boundary', first('R25.') === 'R25', String(first('R25.')));
check('an id followed by a dash still matches', first('R25 —') === 'R25', String(first('R25 —')));

// ---- code stripping ---------------------------------------------------------------------------
// A mention inside code is never turned into a link, so counting it offers a backlink chip that
// leads to a document with nothing to step to. Everything marked renders to <code>/<pre> must go.
const kept = (md: string) => withoutCode(md).includes('R25');

check('a plain mention survives', kept('see R25 here'), withoutCode('see R25 here'));
check('a backtick span is stripped', !kept('see `R25` here'));
check('a backtick fence is stripped', !kept('```\nR25\n```'));
check('a tilde fence is stripped', !kept('~~~\nR25\n~~~'));
check('raw <code> HTML is stripped', !kept('<code>R25</code>'));
check('raw <pre> HTML is stripped', !kept('<pre>R25</pre>'));

// The fence a list item carries is indented to match the item. The master spec has one today.
check('a fence indented inside a list item is stripped', !kept('- step one\n\n   ```ts\n   R25\n   ```\n'));
check('a tab-indented fence is stripped', !kept('-\tstep\n\n\t```\n\tR25\n\t```\n'));

// A longer fence may quote a shorter one; the closer must be the run that opened the block.
check('a four-backtick fence quoting a three-backtick line is stripped whole', !kept('````\n```\nR25\n```\n````'));
check('a ``` inside a ~~~ block does not close it early', !kept('~~~\n```\nR25\n~~~'));

// An inline `~~~` in prose must not open a block and swallow the mention after it.
check('an inline tilde span does not open a fence', kept('write `~~~` for a fence.\n\nThen R25 applies.'));

// Prose on either side of a real fence is kept.
const around = withoutCode('R25 before\n\n```\nR40\n```\n\nR60 after');
check(
  'prose on both sides of a fence survives, the fence does not',
  around.includes('R25') && around.includes('R60') && !around.includes('R40'),
  JSON.stringify(around),
);

// An unclosed fence is left alone: stripping to end-of-document would drop real mentions, and a
// chip that is offered and works is better than a document silently losing all of its chips.
check('an unclosed fence does not swallow the rest of the document', kept('```\nnot closed\n\nR25 later'));

console.log(
  bad ? `\n${bad} FAILED` : '\nthe id pattern rejects rather than truncates, and code never reaches the corpus',
);
process.exit(bad ? 1 : 0);

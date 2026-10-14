/** R54 — the two pure string rules the cross-reference system rests on.
 *
 *  They live apart from `linkify.ts` for one reason: `linkify.ts` imports the corpus with Vite's
 *  `?raw`, which no plain TypeScript runner can resolve, so nothing in it can be unit tested. Both
 *  rules here are total functions over strings with no imports at all, so `tools/ref-pattern.check.mts`
 *  can exercise the cases the corpus does not currently contain. The file that consumes them says
 *  why that matters: every previous change to this system shipped a bug that source review did not
 *  catch, and both of these were changed twice under review before they were right.
 */

/** What an R-id or F-id looks like, in one place. The tooltip map, the definition marker in
 *  Doc.tsx and the link tokenizer are all built from it; when those spellings drifted apart
 *  (`\d+` in one, `\d{1,3}` in another) a four-digit id was marked as a definition and then never
 *  linked — the marks-match-links contract broken by a regex nobody would check twice.
 *
 *  The trailing `(?!\w)` is load-bearing and belongs IN the pattern rather than at each use. Two of
 *  the three consumers embed it without a `\b` of their own, and a bounded-length id without a
 *  trailing boundary TRUNCATES rather than rejects: `R1234` would match as `R123`, so a real R123
 *  elsewhere on the page would lose its definition to a bullet that is not it, and every R123 link
 *  would jump to the wrong requirement. Rejecting is the safe failure; truncating is not. */
export const REF_ID_SRC = 'R\\d{1,3}(?!\\w)|F\\d{1,3}(?!\\w)';

/** A fenced code block: a run of three or more backticks or tildes on a line of its own, closed by
 *  the same run. Every part of that is there for a case that broke:
 *
 *  - Requiring the run to START a line (allowing the indent a list item gives it) stops an inline
 *    `` `~~~` `` in prose from opening a block and swallowing everything up to the next one.
 *  - Back-referencing the opener stops a four-backtick block that quotes a three-backtick line
 *    from ending at the quote, and stops a ``` inside a ~~~ block from pairing with the next real
 *    ``` further down.
 *  - The indent is allowed on BOTH halves, because a fence inside a list item is indented to match
 *    it, and the corpus is mostly lists — there is one in the master spec today.
 *
 *  Built fresh per call rather than held in a module constant: a `g` regex carries `lastIndex`,
 *  and although `String.replace` resets it, a later `.test()` or `.exec()` on a shared instance
 *  would leak position between two unrelated documents. */
const FENCE = () => /^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1/gm;

/** Strip everything a reader can never click. `linkifyImpl`'s walker refuses to linkify inside
 *  `code` and `pre`, so a mention in any of these renders as plain text — and counting it would
 *  offer a backlink chip that leads to a document with nothing to step to, which is the failure
 *  this whole function exists to prevent. Marked renders fences, raw `<code>`/`<pre>` HTML and
 *  backtick spans all to those same rejected elements, so all three go.
 *
 *  Four-space-indented blocks that are NOT fenced are deliberately kept: inside a list an indent
 *  is a continuation line rather than code, and dropping those would lose real mentions.
 *
 *  The error directions are not symmetric, and this leans the safe way. Stripping too much loses a
 *  chip that would have worked — a missing affordance. Stripping too little offers a chip that
 *  goes nowhere — a broken one. An unclosed fence therefore matches nothing and is left alone only
 *  because a run-on strip would be worse; the harness checks every chip against a rendered use. */
export const withoutCode = (md: string) =>
  md
    .replace(FENCE(), ' ')
    .replace(/<(code|pre)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/`[^`\n]*`/g, ' ');

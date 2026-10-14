/** Preserve readable corpus examples under minification without evaluating source text.
 * Scan the six-argument add calls, retaining exact slices across formatter line breaks.
 */
export function exampleSource(source, id) {
  if (!/^[a-z0-9]+$/.test(id)) throw new Error('Invalid example ID');
  const call = new RegExp(`(?:^|\\n)\\s*add\\s*\\(\\s*(['"])${id}\\1\\s*,`).exec(source);
  if (!call) throw new Error('Missing source example');
  const body = source.slice(call.index + call[0].indexOf('(') + 1);
  const args = [];
  const delimiters = [];
  const closing = { '(': ')', '[': ']', '{': '}' };
  let start = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if ('([{'.includes(c)) delimiters.push(closing[c]);
    else if (')]}'.includes(c)) {
      if (c === ')' && delimiters.length === 0) {
        const last = body.slice(start, i).trim();
        if (last) args.push(last);
        if (args.length !== 6 || args.some((arg) => !arg)) break;
        return { code: args[3], native: args[4] };
      }
      if (delimiters.pop() !== c) break;
    } else if (c === ',' && delimiters.length === 0) {
      args.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error('Example format changed; update source extractor');
}

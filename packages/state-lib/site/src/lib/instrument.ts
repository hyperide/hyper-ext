/**
 * Step instrumentation for the playground's debugger (R81).
 *
 * The reader wants what a debugger gives them: run to here, and tell me what
 * everything held at that moment. Doing that without a real debugger means
 * recording rather than pausing — the program runs once, straight through, and
 * after every top-level statement it snapshots the values of everything
 * declared so far. Stepping is then scrubbing recorded frames, which is better
 * than a real breakpoint for this purpose: stepping backwards costs nothing and
 * nothing can hang waiting for the reader.
 *
 * Only top-level statements are steps. Stepping into a loop body or a callback
 * would need a transform on the whole AST and a parser we do not ship; the
 * honest boundary is drawn here rather than half-implemented.
 */

export type Step = {
  /** Index into the statement list. */
  i: number;
  /** 1-based line in the original source where this statement starts. */
  line: number;
  /** The statement's own text, for the step list. */
  text: string;
  /** Every name in scope after it runs. */
  names: string[];
};

type Chunk = { text: string; line: number };

/** Characters that mean the statement is obviously unfinished, so the next line
 *  belongs to it even though every bracket happens to be balanced. */
const CONTINUES = /(?:[=+\-*/%<>&|^,.?:]|=>|\b(?:const|let|var|return|await|new|typeof|in|of|instanceof)|\(|\[|\{)\s*$/;

/** The mirror case: this line ends cleanly but the NEXT one cannot start a
 *  statement, so the two are one. A fluent chain broken across lines
 *  (`foo()` / `.bar()`) is the common shape and balances its brackets on every
 *  line, so bracket depth alone never notices. */
const CONTINUED_BY = /^\s*(?:[.)\]}]|\?\.|&&|\|\||[+\-*/%<>?:,]|=>|\bthen\b|\bcatch\b|\belse\b)/;

/** Splits source into top-level statements, tracking string, template, comment
 *  and bracket state so a brace inside a string never ends a statement. */
export function splitTopLevel(src: string): Chunk[] {
  const out: Chunk[] = [];
  const lines = src.split('\n');
  let buf: string[] = [];
  let startLine = 1;
  let depth = 0;
  let inBlockComment = false;
  let templateDepth = 0;

  const flush = () => {
    const text = buf.join('\n');
    if (text.trim()) out.push({ text, line: startLine });
    buf = [];
  };

  lines.forEach((raw, idx) => {
    if (!buf.length) startLine = idx + 1;
    buf.push(raw);
    depth += scanLine(
      raw,
      () => inBlockComment,
      (v) => (inBlockComment = v),
      () => templateDepth,
      (v) => (templateDepth = v),
    );
    const code = stripTrailingComment(raw).trimEnd();
    const next = lines[idx + 1];
    const nextContinues = next !== undefined && CONTINUED_BY.test(next);
    if (depth <= 0 && templateDepth === 0 && !inBlockComment && code && !CONTINUES.test(code) && !nextContinues) {
      depth = 0;
      flush();
    }
  });
  flush();
  return out;
}

/** Net bracket delta for one line, ignoring anything inside a string, template
 *  or comment. Template state is carried across lines by the caller. */
function scanLine(
  line: string,
  getBlockComment: () => boolean,
  setBlockComment: (v: boolean) => void,
  getTemplate: () => number,
  setTemplate: (v: number) => void,
): number {
  let delta = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const next = line[i + 1];
    if (getBlockComment()) {
      if (c === '*' && next === '/') {
        setBlockComment(false);
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (getTemplate() > 0) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '`') setTemplate(getTemplate() - 1);
      continue;
    }
    if (c === '/' && next === '*') {
      setBlockComment(true);
      i++;
      continue;
    }
    if (c === '/' && next === '/') break;
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '`') {
      setTemplate(getTemplate() + 1);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') delta++;
    if (c === ')' || c === ']' || c === '}') delta--;
  }
  return delta;
}

function stripTrailingComment(line: string): string {
  const i = line.indexOf('//');
  return i === -1 ? line : line.slice(0, i);
}

/** Every name a block of source declares at top level, in order. */
export function declaredNames(src: string): string[] {
  const out: string[] = [];
  for (const chunk of splitTopLevel(src)) for (const n of declaredIn(chunk.text)) if (!out.includes(n)) out.push(n);
  return out;
}

/** Names a top-level statement introduces: plain bindings, array and object
 *  destructuring, and function declarations. */
export function declaredIn(stmt: string): string[] {
  const names: string[] = [];
  const plain = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:;]/.exec(stmt);
  if (plain) names.push(plain[1]!);
  const destructured = /^\s*(?:const|let|var)\s*([[{])([^\]}]*)[\]}]\s*=/.exec(stmt);
  if (destructured) {
    for (const part of destructured[2]!.split(',')) {
      const n = /([A-Za-z_$][\w$]*)\s*$/.exec(part.split(':').pop()!.trim());
      if (n) names.push(n[1]!);
    }
  }
  const fn = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(stmt);
  if (fn) names.push(fn[1]!);
  return names;
}

/**
 * Rewrites the program so that every top-level statement is followed by a call
 * recording the values then in scope. The call lists the names explicitly —
 * a capture helper cannot see a closure's locals, and naming only the bindings
 * declared *so far* avoids reading a `const` before its declaration, which
 * throws rather than returning undefined.
 */
export function instrument(src: string, seed: string[] = []): { code: string; steps: Step[] } {
  const chunks = splitTopLevel(src);
  const steps: Step[] = [];
  const parts: string[] = [];
  // `seed` names bindings that already exist around this code — the playground's
  // scaffolding, which is not stepped through but whose values the reader still
  // wants to watch. Without it the inspector is empty for every example whose
  // store is created in the setup, which is most of them.
  const inScope: string[] = [...seed];
  chunks.forEach((chunk, i) => {
    parts.push(chunk.text);
    for (const n of declaredIn(chunk.text)) if (!inScope.includes(n)) inScope.push(n);
    const capture = inScope.map((n) => `${JSON.stringify(n)}: ${n}`).join(', ');
    parts.push(`await __step(${i}, {${capture}});`);
    steps.push({ i, line: chunk.line, text: chunk.text.trim(), names: [...inScope] });
  });
  return { code: parts.join('\n'), steps };
}

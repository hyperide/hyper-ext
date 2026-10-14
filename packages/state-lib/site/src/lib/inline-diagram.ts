import { asciiToSvg } from '../../../../vector-cli/src/diagram';
import { layoutAscii } from '../../../../vector-cli/src/ascii-layout';

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A closed box must actually exist. An ASCII top edge alone is not also its bottom. */
export function isAsciiDiagram(source: string, language = 'text'): boolean {
  if (!/^(?:text|txt|ascii|diagram)?$/i.test(language) || source.length > 200000) return false;
  const lines = source.split('\n').filter((line) => line.trim());
  const arrow = /^\s*\S.*\s(?:[-─━═]{2,}[>→]|[<←][-─━═]{2,})\s*\S.*$/;
  const directed =
    lines.length >= (/^(?:ascii|diagram)$/i.test(language) ? 1 : 2) && lines.every((line) => arrow.test(line));
  if (!directed && !/[┌┏╔╭][─━═]|\+[-=]{2}/.test(source)) return false;
  try {
    return layoutAscii(source).frames.length > 0 || directed;
  } catch {
    // Oversized/ambiguous drawings remain ordinary source, not a broken document.
    return false;
  }
}

export function inlineDiagramHtml(
  source: string,
  caption = 'Diagram of the relationships described in this section',
): string {
  const svg = asciiToSvg(source, { title: caption, preset: 'state', fontSize: 15 });
  return `<figure class="inline-diagram" data-no-try data-diagram-source="${escape(source)}" data-source-lang="text"><div class="inline-diagram-svg">${svg}</div><figcaption>${escape(caption)}</figcaption><details data-no-export><summary>View text source</summary><pre data-no-try><code>${escape(source)}</code></pre></details></figure>`;
}

import { type ElementType, useMemo } from 'react';
import { linkifyText } from './linkify';

/** Inline PROSE with R54 tooltips, for JSX-authored pages: <T>…prose with R7 and §4.6…</T>
 *
 *  Children are text, not markup — angle brackets are escaped before the
 *  reference pass runs. A sentence that mentions `<input bind={s.query}/>` says
 *  so; it does not render one. Use `linkifyCell` directly where a string is
 *  deliberately authored as HTML (the landscape table's cells). */
export function T({
  children,
  as: As = 'span',
  className,
}: {
  children: string;
  as?: ElementType;
  className?: string;
}) {
  const html = useMemo(() => linkifyText(children), [children]);
  return <As className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

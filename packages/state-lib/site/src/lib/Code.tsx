import { inlineDiagramHtml, isAsciiDiagram } from './inline-diagram';
import { snippetHref } from './snippet-transfer';
import { guideFor, guideHref } from './learning';
import { LiterateSource } from './LiterateSource';

/** Primary actions teach a complete scenario; exact-source inspection remains a separate action. */
export function Code({ children, repl, lang = 'ts' }: { children: string; repl?: string; lang?: string }) {
  if (isAsciiDiagram(children, lang)) return <div dangerouslySetInnerHTML={{ __html: inlineDiagramHtml(children) }} />;
  const guide = guideFor(children, '', repl);
  const id = repl ?? guide?.id;
  return (
    <div className="codeblock" data-code-source={children} data-source-lang={lang}>
      <div className="sample-actions" data-no-export>
        {id && (
          <a className="code-repl" href={guideHref(id)} title={guide?.title ?? 'Open the complete interactive example'}>
            Try example <span aria-hidden="true">→</span>
          </a>
        )}
        <a
          className="code-source"
          href={snippetHref(children, lang)}
          title="Inspect this exact source without running it"
        >
          View source
        </a>
      </div>
      <LiterateSource source={children} lang={lang} />
    </div>
  );
}

import { highlight } from './highlight';
import { href } from './router';
import { snippetHref } from './snippet-transfer';

/** A code sample: highlighted (R80), and — when it names a runnable example — carrying a
 *  button into the REPL, where the scaffolding it needs is added around it (R80). */
export function Code({ children, repl, lang = 'ts' }: { children: string; repl?: string; lang?: string }) {
  return (
    <div className="codeblock">
      {
        <a
          className="code-repl"
          href={repl ? href(`/repl/${repl}`) : snippetHref(children, lang)}
          title={
            repl
              ? 'Run the exact example with its scaffolding'
              : 'Edit this exact source; unavailable runtimes remain references'
          }
        >
          {repl ? 'run it →' : 'try it →'}
        </a>
      }
      <pre className={`pg-code lang-${lang}`}>
        <code dangerouslySetInnerHTML={{ __html: highlight(children) }} />
      </pre>
    </div>
  );
}

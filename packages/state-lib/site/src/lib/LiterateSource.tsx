import { highlight, literateParts } from './highlight';

/** Presentation only: the original source remains available unchanged to export and inspection. */
export function LiterateSource({ source, lang = 'ts' }: { source: string; lang?: string }) {
  const parts = /^(?:ts|tsx|js|jsx|javascript|typescript)$/.test(lang)
    ? literateParts(source)
    : [{ kind: 'code', text: source, raw: source }];
  return (
    <div className="literate-source" data-literate-source={source} data-source-lang={lang}>
      {parts.map(
        (part, index) =>
          part.text &&
          (part.kind === 'prose' ? (
            <p className="literate-prose" key={index}>
              {part.text}
            </p>
          ) : (
            <pre className={`pg-code lang-${lang}`} data-no-try key={index}>
              <code dangerouslySetInnerHTML={{ __html: highlight(part.text) }} />
            </pre>
          )),
      )}
    </div>
  );
}

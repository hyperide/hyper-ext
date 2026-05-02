import { Badge } from '@/components/ui/badge';

const capabilities = [
  'Live React canvas',
  'Element tree',
  'Visual selection',
  'Inspector style controls',
  'Context actions',
  'Go to Code',
  'AI edits with context',
  'Undo/Redo history',
  'TypeScript-first',
];

export default function Demo() {
  return (
    <section className="py-20 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Screenshot */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 blur-2xl" />
            <div className="relative overflow-hidden rounded-xl border bg-muted p-3 shadow-xl sm:p-4">
              <div className="grid gap-3 sm:gap-4">
                <figure className="overflow-hidden rounded-lg border bg-background shadow-lg">
                  <img
                    src="/screenshots/demo-inspector-a.png"
                    alt="HyperIDE selecting the Jump button in the bulka-the-dog project with code, canvas, and Inspector visible"
                    className="aspect-video w-full object-cover object-top"
                    loading="eager"
                  />
                  <figcaption className="border-t bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                    Select the rendered button and inspect the exact JSX-backed element.
                  </figcaption>
                </figure>
                <figure className="overflow-hidden rounded-lg border bg-background shadow-lg">
                  <img
                    src="/screenshots/demo-inspector-b.png"
                    alt="HyperIDE context menu opened on the selected Jump button with Go to Code visible"
                    className="aspect-video w-full object-cover object-top"
                    loading="eager"
                  />
                  <figcaption className="border-t bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                    Open context actions to go to code, duplicate, wrap, or ask AI.
                  </figcaption>
                </figure>
              </div>
            </div>
          </div>

          {/* Content */}
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Built for developers who value their time</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              HyperIDE keeps the edit loop inside one surface: select rendered React elements, inspect the generated JSX
              and Tailwind controls, then open context actions such as Go to Code without rebuilding the page in your
              head.
            </p>

            {/* Capabilities */}
            <div className="mt-8 flex flex-wrap gap-2">
              {capabilities.map((capability) => (
                <Badge key={capability} variant="secondary" className="px-3 py-1">
                  {capability}
                </Badge>
              ))}
            </div>

            {/* Stats */}
            <div className="mt-10 grid grid-cols-3 gap-4 border-t pt-10">
              <div>
                <div className="text-2xl font-bold sm:text-3xl">Select</div>
                <div className="text-sm text-muted-foreground">Rendered element</div>
              </div>
              <div>
                <div className="text-2xl font-bold sm:text-3xl">Inspect</div>
                <div className="text-sm text-muted-foreground">Styles and JSX</div>
              </div>
              <div>
                <div className="text-2xl font-bold sm:text-3xl">Act</div>
                <div className="text-sm text-muted-foreground">Code or AI</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

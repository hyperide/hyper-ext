import { Badge } from '@/components/ui/badge';

const capabilities = [
  'Tailwind CSS support',
  'TypeScript-first',
  'React DevTools integration',
  'Undo/Redo history',
  'Keyboard shortcuts',
  'Multi-canvas boards',
  'Component props editor',
  'CSS state variants',
];

export default function Demo() {
  return (
    <section className="py-20 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Screenshot */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 blur-2xl" />
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted shadow-xl">
              {/* Placeholder for demo screenshot */}
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <div className="text-4xl">📸</div>
                  <p className="mt-2 text-sm">feature-visual.png</p>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Built for developers who value their time</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Stop switching between code and browser. HyperIDE brings the design experience to your development
              workflow, without sacrificing code quality or control.
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
                <div className="text-3xl font-bold">5+</div>
                <div className="text-sm text-muted-foreground">Supported frameworks</div>
              </div>
              <div>
                <div className="text-3xl font-bold">50+</div>
                <div className="text-sm text-muted-foreground">Keyboard shortcuts</div>
              </div>
              <div>
                <div className="text-3xl font-bold">∞</div>
                <div className="text-sm text-muted-foreground">Time saved</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

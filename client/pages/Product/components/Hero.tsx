import { IconExternalLink } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { screenshotSrc } from '../screenshotSrc';

export default function Hero() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-32">
      {/* Background gradient */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(var(--primary-rgb),0.1),transparent_70%)]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background/50 px-4 py-1.5 text-sm backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            VS Code Extension
          </div>

          {/* Headline */}
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            Visual React Editor
            <br />
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              with AI Superpowers
            </span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Install HyperIDE in VS Code or Cursor, open your React project, and edit the real running UI with visual
            controls, code navigation, and AI context actions.
          </p>

          {/* CTA Buttons */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" className="w-full gap-2 sm:w-auto" asChild>
              <a
                href="https://marketplace.visualstudio.com/itemdetails?itemName=hyperide.hypercanvas-preview"
                target="_blank"
                rel="noopener noreferrer"
              >
                <IconExternalLink className="h-5 w-5" />
                Install from VS Marketplace
              </a>
            </Button>
            <Button size="lg" variant="outline" className="w-full gap-2 sm:w-auto" asChild>
              <a
                href="https://open-vsx.org/extension/hyperide/hypercanvas-preview"
                target="_blank"
                rel="noopener noreferrer"
              >
                <IconExternalLink className="h-5 w-5" />
                Open VSX Registry
              </a>
            </Button>
          </div>

          {/* Product screenshot */}
          <div className="mt-16 sm:mt-20">
            <div className="relative mx-auto max-w-5xl">
              <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 blur-2xl" />
              <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted shadow-2xl">
                <img
                  src={screenshotSrc('/screenshots/hero.png')}
                  alt="HyperIDE selecting the Jump button in the bulka-the-dog React project with code, live canvas, and Inspector visible"
                  className="h-full w-full object-cover object-top"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

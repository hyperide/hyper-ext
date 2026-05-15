import { IconBrandGithub, IconPlayerPlay } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';

export default function Hero() {
  // Use actual auth state instead of just localStorage flag
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

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
            Open Source
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
            Edit React components like Figma. Generate production-ready code with AI. Works with Next.js, Vite, and
            Remix.
          </p>

          {/* CTA Buttons */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" className="gap-2" asChild>
              <Link to={isAuthenticated ? '/projects' : '/login'}>
                <IconPlayerPlay className="h-5 w-5" />
                {isAuthenticated ? 'Continue work' : 'Get Started'}
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="gap-2" asChild>
              <a href="https://github.com/hyperide/hypercanvas" target="_blank" rel="noopener noreferrer">
                <IconBrandGithub className="h-5 w-5" />
                View on GitHub
              </a>
            </Button>
          </div>

          {/* Screenshot placeholder */}
          <div className="mt-16 sm:mt-20">
            <div className="relative mx-auto max-w-5xl">
              <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 blur-2xl" />
              <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted shadow-2xl">
                {/* Placeholder for screenshot */}
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <div className="text-4xl">📸</div>
                    <p className="mt-2 text-sm">hero-screenshot.png</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

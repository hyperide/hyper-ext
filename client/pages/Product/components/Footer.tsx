import { IconBrandGithub } from '@tabler/icons-react';

export default function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          {/* Logo & Copyright */}
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">HyperIDE</span>
            <span className="text-muted-foreground">
              © {new Date().getFullYear()}
            </span>
          </div>

          {/* Links */}
          <nav className="flex items-center gap-6">
            <a
              href="/docs"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Documentation
            </a>
            <a
              href="https://github.com/hyperide/hypercanvas"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconBrandGithub className="h-4 w-4" />
              GitHub
            </a>
            <a
              href="https://github.com/hyperide/hypercanvas/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Report Issue
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

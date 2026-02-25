import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/webview/**/*.{ts,tsx}',
    './src/webview-left/**/*.{ts,tsx}',
    './src/webview-right/**/*.{ts,tsx}',
    './src/webview-preview-panel/**/*.{ts,tsx}',
    // Reused shadcn/ui components from main project
    '../../client/components/ui/**/*.{ts,tsx}',
    // Reused components for left panel
    '../../client/components/LeftSidebar/**/*.{ts,tsx}',
    '../../client/components/ComponentGroupList.tsx',
    '../../client/components/ElementsTree.tsx',
    '../../client/components/icons/IconSquareRotatedPlus.tsx',
    // Reused components for right panel (inspector)
    '../../client/components/RightSidebar/**/*.{ts,tsx}',
    // Shared context menu
    '../../client/components/CanvasElementContextMenu.tsx',
  ],
  prefix: '',
  theme: {
    extend: {
      colors: {
        // No hsl() wrapper — CSS variables already contain full color values
        // (VS Code native --vscode-* vars are hex/rgb, not HSL channels)
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;

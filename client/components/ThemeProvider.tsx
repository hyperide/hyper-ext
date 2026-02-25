import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialThemeFromHtml(): ResolvedTheme {
  if (typeof document === 'undefined') return getSystemTheme();
  if (document.documentElement.classList.contains('light')) return 'light';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return getSystemTheme();
}

function resolveTheme(theme: Theme | null | undefined): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  return getSystemTheme();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const updateTheme = useAuthStore((state) => state.updateTheme);

  // Use user theme from DB, or read initial theme from HTML (set by server)
  const theme: Theme = user?.theme ?? 'system';
  const resolvedTheme = user ? resolveTheme(theme) : getInitialThemeFromHtml();

  // Apply theme class and color-scheme to html element
  // Tailwind requires class dark/light to work properly
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  // Listen to system theme changes when theme is 'system'
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const newTheme = mediaQuery.matches ? 'dark' : 'light';
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(newTheme);
      root.style.colorScheme = newTheme;
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      updateTheme(newTheme);
    },
    [updateTheme],
  );

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

import { useEffect } from 'react';
import { useApp } from './store';

/**
 * Applies theme, large-text mode, and language/direction to <html>.
 * Large-text is the Mother Mode default (§14).
 */
export function useAppearance(): void {
  const settings = useApp().settings;
  const mode = settings.activeMode;

  useEffect(() => {
    const root = document.documentElement;

    // Theme
    const applyTheme = () => {
      const prefersDark =
        typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
      root.classList.toggle('dark', dark);
    };
    applyTheme();

    let mq: MediaQueryList | null = null;
    if (settings.theme === 'system' && typeof window !== 'undefined') {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', applyTheme);
    }

    // Large text: always on in Mother Mode, otherwise user-controlled.
    const large = mode === 'mother' ? true : settings.largeText;
    root.classList.toggle('large-text', large);

    // Direction is always RTL for Arabic.
    root.setAttribute('dir', 'rtl');
    root.setAttribute('lang', 'ar');

    return () => mq?.removeEventListener('change', applyTheme);
  }, [settings.theme, settings.largeText, mode]);
}

/** Re-materialise doses when the app returns to the foreground (§9). */
export function useForegroundRefresh(onForeground: () => void): void {
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') onForeground();
    };
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
    };
  }, [onForeground]);
}

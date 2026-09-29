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

/**
 * Keep the WebView below the status bar on Android.
 *
 * By default Capacitor lets the WebView extend *under* the status bar, so
 * anything rendered at the very top of a page ends up inside the status bar
 * area — it looks like it is overlapping the notification icons and taps there
 * never reach it. Pushing the WebView below the bar makes the top of every
 * screen fully tappable.
 */
export function useNativeStatusBar(): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cap = (
          window as unknown as {
            Capacitor?: {
              isNativePlatform?: () => boolean;
              getPlatform?: () => string;
            };
          }
        ).Capacitor;
        if (!cap?.isNativePlatform?.()) return;
        if (cap.getPlatform?.() !== 'android') return;

        const mod = (await import('@capacitor/status-bar')) as unknown as {
          StatusBar?: { setOverlaysWebView?: (opts: { overlay: boolean }) => Promise<void> };
        };
        if (cancelled) return;
        await mod.StatusBar?.setOverlaysWebView?.({ overlay: false });
      } catch {
        // Plugin unavailable — the CSS safe-area padding is the fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
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

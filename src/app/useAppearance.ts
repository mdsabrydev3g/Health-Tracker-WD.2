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

/**
 * Ask the OS for the permissions this app needs as soon as it runs on Android,
 * the way every ordinary app does: the system shows its own Allow dialogs.
 *
 * Android 13+ will not show a reminder until POST_NOTIFICATIONS is granted,
 * and the user cannot be expected to hunt for it in Settings. The plugin call
 * itself triggers the system Allow dialog. We only fire once per install so a
 * user who chose "Don't allow" is not nagged on every launch — the Settings
 * screen and the in-app permission dialog stay available for a later change of
 * mind.
 *
 * Camera is requested here too (at the user's request) so both dialogs appear
 * on first run. Opening a MediaStream is what makes Android surface its
 * camera Allow dialog; the track is stopped immediately, so nothing is
 * recorded and no preview is shown.
 */
export function useStartupPermissions(): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cap = (
          window as unknown as {
            Capacitor?: { isNativePlatform?: () => boolean };
          }
        ).Capacitor;
        if (!cap?.isNativePlatform?.()) return;

        // Already answered (granted or denied) — never ask twice.
        const askedKey = 'ht:perms:asked-at-startup';
        try {
          if (window.localStorage.getItem(askedKey) === '1') return;
        } catch {
          /* private mode — fall through and ask */
        }

        // Give React a beat to paint before native dialogs cover the screen.
        await new Promise((r) => setTimeout(r, 800));
        if (cancelled) return;

        // 1. Notifications (+ the exact-alarm screen where the OS requires it).
        try {
          const mod = (await import('@capacitor/local-notifications')) as unknown as {
            LocalNotifications?: {
              requestPermissions?: () => Promise<{ display: string }>;
              changeExactNotificationSetting?: () => Promise<unknown>;
            };
          };
          await mod.LocalNotifications?.requestPermissions?.();
        } catch {
          /* plugin missing — the in-app dialog still offers a retry */
        }

        if (cancelled) return;

        // 2. Camera. getUserMedia is the call Android gates behind its own
        //    camera permission dialog.
        try {
          if (navigator.mediaDevices?.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach((t) => t.stop());
          }
        } catch {
          /* user declined — scanning will re-ask when it is actually needed */
        }

        try {
          window.localStorage.setItem(askedKey, '1');
        } catch {
          /* ignore */
        }
      } catch {
        /* never let a permission probe break startup */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

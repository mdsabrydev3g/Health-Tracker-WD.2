import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Render smoke tests.
 *
 * The unit tests cover the pure engine and the integration tests cover the
 * Dexie adapter — but neither proves the React tree actually mounts. These
 * do: they render the real <App/> in jsdom against a real (fake) IndexedDB,
 * and assert the caregiver UI comes up with Arabic content.
 *
 * This catches the failure mode that matters most: a crash on boot would
 * leave Mother with a blank screen and no reminders at all.
 */

// jsdom doesn't implement matchMedia, which useAppearance touches.
beforeAll(() => {
  // Tell React this environment supports act(), otherwise every render
  // prints "The current testing environment is not configured to support
  // act(...)" and the real failures get buried in the noise.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom has no layout engine: window.scrollTo is a stub that throws
  // "Not implemented". App calls it on route change; stub it out.
  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    configurable: true,
    value: () => {},
  });

  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  // Capacitor / native bridge is absent on the web; the app must not care.
  if (!('Notification' in window)) {
    Object.defineProperty(window, 'Notification', {
      writable: true,
      value: { permission: 'default', requestPermission: async () => 'default' },
    });
  }
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderApp() {
  const { App } = await import('@/app/App');
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });

  root = createRoot(container);
  await act(async () => {
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          BrowserRouter,
          // Opt into the v7 behaviours so we don't print future-flag warnings.
          { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
          React.createElement(App, null),
        ),
      ),
    );
  });
  // Let the store bootstrap + seed + materialise doses settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 800));
  });
  return container;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('App render smoke', () => {
  it('mounts without throwing', async () => {
    const el = await renderApp();
    expect(el).toBeTruthy();
    // Something was actually rendered, not an empty root.
    expect(el.innerHTML.length).toBeGreaterThan(100);
  });

  it('renders Arabic RTL content', async () => {
    const el = await renderApp();
    const text = el.textContent ?? '';
    // The seeded caregiver UI shows Arabic; assert real Arabic glyphs exist.
    expect(text).toMatch(/[\u0600-\u06FF]/);
  });

  it('shows no error boundary fallback on boot', async () => {
    const el = await renderApp();
    const text = el.textContent ?? '';
    // ErrorBoundary renders an Arabic "something went wrong" panel; if we
    // see it, boot failed and Mother would get a dead screen.
    expect(text).not.toMatch(/حدث خطأ|عذراً، حدث خطأ ما/);
  });

  it('does not crash when the native bridge is missing', async () => {
    // getNativeAlarmApi() must return null/undefined on web rather than throw.
    const { getNativeAlarmApi } = await import('@/core/notify/scheduler');
    expect(() => getNativeAlarmApi()).not.toThrow();
  });
});

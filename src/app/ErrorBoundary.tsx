import React from 'react';
import { Button } from '@/ui/button';
import { AlertBanner } from '@/ui/primitives';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary — the app must never show a blank screen (§1.7).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Logging must never contain medication names or clinical values (§13).
    console.error('[Health Tracker] render error', error.name, info.componentStack?.split('\n')[1]);
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <AlertBanner tone="danger" title="حدث خطأ غير متوقع">
            <p className="text-sm">لم يتم فقدان أي بيانات محفوظة. حاول إعادة تحميل التطبيق.</p>
            <p className="mt-2 text-xs opacity-75">{this.state.error.message}</p>
          </AlertBanner>
          <Button
            className="w-full"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            إعادة تحميل التطبيق
          </Button>
        </div>
      </div>
    );
  }
}

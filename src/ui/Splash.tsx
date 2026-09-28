import { HeartPulse } from 'lucide-react';

export function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
        <HeartPulse className="h-10 w-10 text-primary" />
      </div>
      <div className="text-center">
        <p className="text-xl font-extrabold">Health Tracker</p>
        <p className="mt-1 text-sm text-muted-foreground">رفيق الجرعات والصحة للعائلة</p>
      </div>
      <div className="mt-4 h-1.5 w-32 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
      </div>
    </div>
  );
}

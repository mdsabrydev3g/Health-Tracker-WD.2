import * as React from 'react';
import { cn } from '@/lib/utils';

type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'muted' | 'info';

const TONES: Record<BadgeTone, string> = {
  default: 'bg-primary/10 text-primary border-primary/20',
  success: 'bg-[hsl(var(--success))]/12 text-[hsl(var(--success))] border-[hsl(var(--success))]/25',
  warning: 'bg-[hsl(var(--warning))]/14 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30',
  danger: 'bg-destructive/12 text-destructive border-destructive/25',
  info: 'bg-secondary text-secondary-foreground border-border',
  muted: 'bg-muted text-muted-foreground border-border',
};

export function Badge({
  tone = 'default',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressRing({
  value,
  size = 96,
  stroke = 9,
  tone = 'primary',
  label,
  sublabel,
}: {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  label?: string;
  sublabel?: string;
}) {
  const safe = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * safe;

  const color =
    tone === 'success'
      ? 'hsl(var(--success))'
      : tone === 'warning'
        ? 'hsl(var(--warning))'
        : tone === 'danger'
          ? 'hsl(var(--destructive))'
          : 'hsl(var(--primary))';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label && <span className="numeric text-xl font-extrabold leading-none">{label}</span>}
        {sublabel && <span className="mt-0.5 text-[0.7rem] text-muted-foreground">{sublabel}</span>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-10 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <p className="text-base font-bold">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function AlertBanner({
  tone = 'danger',
  title,
  children,
  icon,
  action,
}: {
  tone?: 'danger' | 'warning' | 'info' | 'success';
  title: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const styles = {
    danger: 'border-destructive/40 bg-destructive/8 text-destructive',
    warning: 'border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]',
    info: 'border-border bg-muted text-foreground',
    success: 'border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]',
  }[tone];

  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border p-4', styles)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="flex-1 space-y-1">
        <p className="text-sm font-bold">{title}</p>
        {children && <div className="text-sm opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-muted', className)} />;
}

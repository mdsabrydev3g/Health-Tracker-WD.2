import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CalendarDays,
  ClipboardList,
  MoreHorizontal,
  Pill,
  Sun,
  Package,
  ShieldAlert,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/store';
import { hasCriticalAlarmIssue } from '@/core/notify/scheduler';

interface Tab {
  to: string;
  label: string;
  icon: typeof Sun;
}

const TABS: Tab[] = [
  { to: '/today', label: 'اليوم', icon: Sun },
  { to: '/medications', label: 'الأدوية', icon: Pill },
  { to: '/inventory', label: 'المخزون', icon: Package },
  { to: '/reports', label: 'التقارير', icon: ClipboardList },
  { to: '/more', label: 'المزيد', icon: MoreHorizontal },
];

/** Where we remember that the user hid the alarm warning (per device). */
function dismissKey(deviceId?: string): string {
  return `ht:banner:dismissed:${deviceId ?? 'unknown'}`;
}

export function CaregiverShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const device = useApp((s) => s.device);
  const person = useApp((s) => s.activePerson());

  const alarmBroken = hasCriticalAlarmIssue(device?.alarmHealth);
  const [dismissed, setDismissed] = useState(false);

  // Remembering the dismissal per device means hiding it on one phone never
  // hides the same warning on another.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(window.localStorage.getItem(dismissKey(device?.id)) === '1');
  }, [device?.id]);

  const dismissBanner = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(dismissKey(device?.id), '1');
    }
    setDismissed(true);
  };

  const showAlarmBanner = alarmBroken && !dismissed;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col">
      {showAlarmBanner && (
        <div className="flex items-center gap-2 bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground">
          <Link to="/settings" className="flex min-w-0 flex-1 items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="truncate">
              تنبيه: التذكيرات غير مضمونة على هذا الجهاز — اضغط للتفاصيل
            </span>
          </Link>
          <button
            type="button"
            onClick={dismissBanner}
            aria-label="إغلاق التنبيه"
            className="shrink-0 rounded p-1 hover:bg-destructive-foreground/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <main className="flex-1 px-4 pb-28 pt-5">{children}</main>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        <div className="mx-auto flex max-w-3xl items-stretch">
          {TABS.map((tab) => {
            const active =
              location.pathname === tab.to ||
              (tab.to !== '/today' && location.pathname.startsWith(tab.to));
            const Icon = tab.icon;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[0.7rem] font-semibold transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Person context chip — hidden when there is only one person. */}
      {person && (
        <div className="pointer-events-none fixed right-3 top-3 z-30 rounded-full border bg-card/90 px-3 py-1 text-xs font-semibold shadow-sm backdrop-blur">
          {person.nameAr}
        </div>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold leading-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export const MORE_ICONS = { CalendarDays };

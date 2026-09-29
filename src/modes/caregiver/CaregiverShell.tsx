import { Link, useLocation } from 'react-router-dom';
import {
  CalendarDays,
  ClipboardList,
  MoreHorizontal,
  Pill,
  Sun,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/store';
import { PermissionPrompt } from '@/features/permissions/PermissionPrompt';

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

export function CaregiverShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const person = useApp((s) => s.activePerson());
  const persons = useApp((s) => s.persons);

  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-3xl flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Permissions are requested through a normal "Allow" dialog instead of a
          permanent red bar, which used to sit under the status bar where taps
          never reached it. */}
      <PermissionPrompt />

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

      {/* Person context chip — only meaningful when more than one person is
          tracked, and kept below the status bar so it never overlaps the
          phone's notification area. */}
      {person && persons.length > 1 && (
        <div
          className="pointer-events-none fixed right-3 z-30 rounded-full border bg-card/90 px-3 py-1 text-xs font-semibold shadow-sm backdrop-blur"
          style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
        >
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

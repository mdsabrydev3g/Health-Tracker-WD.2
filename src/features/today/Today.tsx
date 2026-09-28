import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, ChevronLeft, Sparkles, Sun } from 'lucide-react';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { DoseRow, DayProgress } from './DoseRow';
import { AlertBanner, EmptyState } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { formatLocalTime, friendlyDayLabel, todayIn } from '@/core/time';
import { computeAdherence, arabicMissedCount } from '@/core/engine/adherence.engine';
import { projectStock } from '@/core/engine/inventory.engine';

export function Today() {
  const person = useApp((s) => s.activePerson());
  const doseEvents = useApp((s) => s.doseEvents);
  const medications = useApp((s) => s.medications);
  const schedules = useApp((s) => s.schedules);
  const inventoryByMed = useApp((s) => s.inventoryByMed);
  const settings = useApp((s) => s.settings);
  const statuses = useApp((s) => s.statuses);

  const today = person ? todayIn(person.timezone) : todayIn('Africa/Cairo');

  const todaysDoses = useMemo(
    () =>
      doseEvents
        .filter((e) => e.localDay === today)
        .sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)),
    [doseEvents, today],
  );

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const counts = useMemo(() => {
    let taken = 0;
    let remaining = 0;
    let missed = 0;
    for (const d of todaysDoses) {
      const s = statuses.get(d.id) ?? d.status;
      if (s === 'taken') taken++;
      else if (s === 'missed') missed++;
      else if (s !== 'skipped' && s !== 'cancelled') remaining++;
    }
    return { taken, remaining, missed, total: taken + remaining + missed };
  }, [todaysDoses, statuses]);

  const adherence = useMemo(() => computeAdherence(doseEvents), [doseEvents]);

  const nextDose = useMemo(() => {
    const now = Date.now();
    return todaysDoses
      .filter((d) => {
        const s = statuses.get(d.id) ?? d.status;
        return s !== 'taken' && s !== 'skipped' && s !== 'cancelled' && new Date(d.scheduledAtUtc).getTime() >= now - 3600_000;
      })
      .sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc))[0];
  }, [todaysDoses, statuses]);

  // Stock alerts — depletion and expiry-before-depletion are distinct (§7).
  const stockAlerts = useMemo(() => {
    if (!person) return [];
    const out: { medId: string; nameAr: string; text: string; tone: 'danger' | 'warning' }[] = [];
    for (const med of medications) {
      const proj = projectStock({
        medication: med,
        schedules,
        events: inventoryByMed[med.id] ?? [],
        today,
        lowStockThresholdDays: settings.lowStockThresholdDays,
      });
      if (proj.expiresBeforeDepletion) {
        out.push({
          medId: med.id,
          nameAr: med.nameAr,
          text: 'العلبة ستنتهي صلاحيتها قبل أن ينتهي الدواء',
          tone: 'warning',
        });
      }
      if (proj.isLow) {
        out.push({
          medId: med.id,
          nameAr: med.nameAr,
          text: `المخزون منخفض — يكفي ${proj.remainingDays === Infinity ? '—' : Math.floor(proj.remainingDays)} يوم`,
          tone: 'danger',
        });
      }
    }
    return out.slice(0, 3);
  }, [person, medications, schedules, inventoryByMed, today, settings.lowStockThresholdDays]);

  if (!person) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="اليوم"
        subtitle={`${friendlyDayLabel(today, today)} · ${person.nameAr}`}
      />

      {/* Hero: progress + next dose */}
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-5 pt-5">
          <DayProgress taken={counts.taken} total={counts.total} size={104} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sun className="h-4 w-4" />
              <span>ملخص اليوم</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="numeric text-xl font-extrabold text-[hsl(var(--success))]">{counts.taken}</p>
                <p className="text-[0.7rem] text-muted-foreground">تم أخذها</p>
              </div>
              <div>
                <p className="numeric text-xl font-extrabold">{counts.remaining}</p>
                <p className="text-[0.7rem] text-muted-foreground">المتبقية</p>
              </div>
              <div>
                <p className="numeric text-xl font-extrabold text-destructive">{counts.missed}</p>
                <p className="text-[0.7rem] text-muted-foreground">فائتة</p>
              </div>
            </div>
            {adherence.percent !== null && (
              <p className="text-xs text-muted-foreground">
                الالتزام العام: <span className="numeric font-bold">{adherence.percent}٪</span>{' '}
                (آخر ٤ أشهر)
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Next dose spotlight */}
      {nextDose ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-3 pt-5">
            <div className="flex items-center gap-2 text-sm font-bold text-primary">
              <CalendarClock className="h-4 w-4" />
              الجرعة القادمة
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-xl font-extrabold">
                {medById.get(nextDose.medId)?.nameAr ?? '—'}
              </p>
              <p className="numeric shrink-0 text-lg font-bold text-primary">
                {formatLocalTime(nextDose.scheduledAtUtc, person.timezone)}
              </p>
            </div>
            <DoseRow dose={nextDose} med={medById.get(nextDose.medId)} person={person} compact />
          </CardContent>
        </Card>
      ) : (
        <AlertBanner tone="success" title="لا توجد جرعات متبقية اليوم" icon={<Sparkles className="h-5 w-5" />}>
          <p>تم تسجيل جميع جرعات اليوم.</p>
        </AlertBanner>
      )}

      {/* Stock / expiry alerts */}
      {stockAlerts.length > 0 && (
        <div className="space-y-2">
          {stockAlerts.map((a, i) => (
            <AlertBanner
              key={`${a.medId}-${i}`}
              tone={a.tone}
              title={a.nameAr}
              icon={<AlertTriangle className="h-5 w-5" />}
              action={
                <Link to={`/medications/${a.medId}`}>
                  <Button size="sm" variant="outline">
                    تفاصيل
                  </Button>
                </Link>
              }
            >
              <p>{a.text}</p>
            </AlertBanner>
          ))}
        </div>
      )}

      {/* Full timeline */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">جدول اليوم</h2>
          <Link to="/calendar" className="flex items-center gap-1 text-sm font-semibold text-primary">
            التقويم
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </div>

        {todaysDoses.length === 0 ? (
          <EmptyState
            title="لا توجد جرعات مجدولة اليوم"
            description="أضف دواءً وجدولاً من صفحة الأدوية."
            action={
              <Link to="/medications">
                <Button>إضافة دواء</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-2">
            {todaysDoses.map((dose) => (
              <DoseRow
                key={dose.id}
                dose={dose}
                med={medById.get(dose.medId)}
                person={person}
              />
            ))}
          </div>
        )}
      </section>

      {counts.missed > 0 && (
        <p className="text-center text-xs text-muted-foreground">{arabicMissedCount(counts.missed)} اليوم</p>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Activity, ClipboardList, Coins, Download, TrendingUp } from 'lucide-react';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { Badge, EmptyState, ProgressRing } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import {
  adherenceGrade,
  arabicDayCount,
  bestStreak,
  computeAdherence,
  currentStreak,
} from '@/core/engine/adherence.engine';
import { buildCostReport, formatMoney } from '@/core/engine/cost.engine';
import { addLocalDays, enumerateLocalDays, todayIn } from '@/core/time';
import { downloadJson } from '@/lib/utils';
import { formatNumber } from '@/i18n/ar';

const RANGES = [
  { value: '7', label: 'آخر ٧ أيام' },
  { value: '30', label: 'آخر ٣٠ يوماً' },
  { value: '90', label: 'آخر ٩٠ يوماً' },
  { value: '120', label: 'آخر ٤ أشهر' },
];

export function Reports() {
  const person = useApp((s) => s.activePerson());
  const doseEvents = useApp((s) => s.doseEvents);
  const medications = useApp((s) => s.medications);
  const schedules = useApp((s) => s.schedules);
  const statuses = useApp((s) => s.statuses);

  const [range, setRange] = useState('30');

  const tz = person?.timezone ?? 'Africa/Cairo';
  const today = person ? todayIn(tz) : todayIn('Africa/Cairo');

  const inRange = useMemo(() => {
    const from = addLocalDays(today, -(Number(range) - 1));
    return doseEvents.filter((e) => e.localDay >= from && e.localDay <= today);
  }, [doseEvents, today, range]);

  const adherence = useMemo(() => computeAdherence(inRange), [inRange]);
  const streak = useMemo(() => currentStreak(doseEvents, today), [doseEvents, today]);
  const best = useMemo(() => bestStreak(doseEvents), [doseEvents]);

  const costReport = useMemo(
    () => (person ? buildCostReport({ person, medications, schedules, today }) : null),
    [person, medications, schedules, today],
  );

  /** Per-day adherence series for the mini bar chart. */
  const series = useMemo(() => {
    const days = enumerateLocalDays(addLocalDays(today, -(Number(range) - 1)), today);
    const byDay = new Map<string, typeof inRange>();
    for (const e of inRange) {
      const list = byDay.get(e.localDay) ?? [];
      list.push(e);
      byDay.set(e.localDay, list);
    }
    return days.map((day) => {
      const list = byDay.get(day) ?? [];
      const a = computeAdherence(list);
      return {
        day,
        percent: a.percent,
        taken: a.taken,
        missed: a.missed,
        total: a.totalConsidered,
      };
    });
  }, [inRange, today, range]);

  const perMedStats = useMemo(() => {
    return medications
      .filter((m) => m.status !== 'discontinued')
      .map((med) => {
        const list = inRange.filter((e) => e.medId === med.id);
        const a = computeAdherence(list);
        return { med, a };
      })
      .filter((r) => r.a.totalConsidered > 0)
      .sort((a, b) => (a.a.percent ?? 100) - (b.a.percent ?? 100));
  }, [medications, inRange]);

  if (!person) return null;

  const grade = adherenceGrade(adherence.percent);
  const gradeLabel = {
    excellent: 'ممتاز',
    good: 'جيد',
    fair: 'مقبول',
    attention: 'يحتاج متابعة',
    unknown: 'لا توجد بيانات',
  }[grade];
  const gradeTone =
    grade === 'excellent' ? 'success' : grade === 'good' ? 'success' : grade === 'fair' ? 'warning' : grade === 'attention' ? 'danger' : 'muted';

  const exportReport = () => {
    downloadJson(`health-tracker-report-${today}.json`, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      person: { nameAr: person.nameAr, timezone: person.timezone },
      period: { from: addLocalDays(today, -(Number(range) - 1)), to: today },
      adherence,
      streak,
      bestStreak: best,
      cost: costReport,
      perMedication: perMedStats.map(({ med, a }) => ({ nameAr: med.nameAr, ...a })),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="التقارير"
        subtitle="الالتزام بالجرعات والتكاليف"
        action={
          <Button variant="outline" size="sm" onClick={exportReport}>
            <Download className="h-4 w-4" />
            تصدير
          </Button>
        }
      />

      <Select value={range} onValueChange={setRange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Adherence headline */}
      <Card>
        <CardContent className="flex items-center gap-5 pt-5">
          <ProgressRing
            value={(adherence.percent ?? 0) / 100}
            size={112}
            stroke={10}
            tone={gradeTone === 'success' ? 'success' : gradeTone === 'danger' ? 'danger' : 'warning'}
            label={adherence.percent === null ? '—' : `${Math.round(adherence.percent)}٪`}
            sublabel="الالتزام"
          />
          <div className="flex-1 space-y-2">
            <Badge tone={gradeTone}>{gradeLabel}</Badge>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Mini label="تم أخذها" value={String(adherence.taken)} tone="success" />
              <Mini label="فائتة" value={String(adherence.missed)} tone="danger" />
              <Mini label="متخطاة" value={String(adherence.skipped)} tone="muted" />
            </div>
            <p className="text-xs text-muted-foreground">
              إجمالي الجرعات المحتسبة: <span className="numeric font-bold">{adherence.totalConsidered}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 pt-5">
            <TrendingUp className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">السلسلة الحالية</p>
              <p className="text-lg font-extrabold">{arabicDayCount(streak)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-5">
            <Activity className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">أطول سلسلة</p>
              <p className="text-lg font-extrabold">{arabicDayCount(best)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="trend">
        <TabsList>
          <TabsTrigger value="trend">الاتجاه اليومي</TabsTrigger>
          <TabsTrigger value="meds">حسب الدواء</TabsTrigger>
          <TabsTrigger value="cost">التكاليف</TabsTrigger>
        </TabsList>

        <TabsContent value="trend">
          <Card>
            <CardContent className="pt-5">
              <DailyChart series={series} />
              <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--success))]" /> كل الجرعات
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--warning))]" /> بعضها
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-destructive" /> فائتة
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-muted" /> بلا جرعات
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="meds" className="space-y-2">
          {perMedStats.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-10 w-10" />} title="لا توجد بيانات كافية" />
          ) : (
            perMedStats.map(({ med, a }) => (
              <Card key={med.id}>
                <CardContent className="flex items-center gap-4 pt-5">
                  <ProgressRing
                    value={(a.percent ?? 0) / 100}
                    size={56}
                    stroke={6}
                    tone={(a.percent ?? 0) >= 90 ? 'success' : (a.percent ?? 0) >= 75 ? 'warning' : 'danger'}
                    label={a.percent === null ? '—' : `${Math.round(a.percent)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{med.nameAr}</p>
                    <p className="numeric text-xs text-muted-foreground">
                      {a.taken} أُخذت · {a.missed} فائتة · {a.skipped} متخطاة
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="cost" className="space-y-3">
          {!costReport ? null : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <CostTile label="يومياً" value={costReport.totalPerDay} currency={costReport.currency} />
                <CostTile label="شهرياً" value={costReport.totalPerMonth} currency={costReport.currency} />
                <CostTile label="سنوياً" value={costReport.totalPerYear} currency={costReport.currency} />
              </div>

              <Card>
                <CardContent className="space-y-2 pt-5">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <Coins className="h-4 w-4 text-primary" />
                    التكلفة حسب الدواء (شهرياً)
                  </p>
                  {costReport.perMed.map((m) => (
                    <div key={m.medId} className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                      <span className="truncate">{m.nameAr}</span>
                      <span className="numeric font-bold">{formatMoney(m.costPerMonth, m.currency)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2">
                    <span className="font-bold">الإجمالي الشهري</span>
                    <span className="numeric font-extrabold text-primary">
                      {formatMoney(costReport.totalPerMonth, costReport.currency)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Keeps `statuses` in the render graph so derived labels stay fresh. */}
      <span className="sr-only">{statuses.size} سجل حالة</span>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: 'success' | 'danger' | 'muted' }) {
  const color =
    tone === 'success' ? 'text-[hsl(var(--success))]' : tone === 'danger' ? 'text-destructive' : 'text-muted-foreground';
  return (
    <div>
      <p className={`numeric text-lg font-extrabold ${color}`}>{value}</p>
      <p className="text-[0.7rem] text-muted-foreground">{label}</p>
    </div>
  );
}

function CostTile({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <Card>
      <CardContent className="pt-5 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="numeric mt-1 text-base font-extrabold">{formatMoney(value, currency)}</p>
      </CardContent>
    </Card>
  );
}

function DailyChart({
  series,
}: {
  series: { day: string; percent: number | null; taken: number; missed: number; total: number }[];
}) {
  const maxBars = 90;
  const shown = series.slice(-maxBars);

  return (
    <div className="flex h-32 items-end gap-[3px]" role="img" aria-label="مخطط الالتزام اليومي">
      {shown.map((d) => {
        const hasData = d.total > 0;
        const pct = d.percent ?? 0;
        const height = hasData ? Math.max(8, pct) : 4;
        const color = !hasData
          ? 'bg-muted'
          : d.missed > 0 && pct < 100
            ? pct >= 50
              ? 'bg-[hsl(var(--warning))]'
              : 'bg-destructive'
            : 'bg-[hsl(var(--success))]';
        return (
          <div
            key={d.day}
            className={`flex-1 rounded-sm ${color}`}
            style={{ height: `${height}%` }}
            title={`${d.day} · ${hasData ? `${Math.round(pct)}٪` : 'لا جرعات'}`}
          />
        );
      })}
    </div>
  );
}

export const REPORT_HELPERS = { formatNumber };

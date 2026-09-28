import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FlaskConical, Plus } from 'lucide-react';
import { useApp, derivedStatus } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { Badge, EmptyState } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button as Btn } from '@/ui/button';
import { Input, Label } from '@/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { addLocalDays, addLocalMonths, daysInMonth, friendlyDayLabel, todayIn, WEEKDAY_LABELS } from '@/core/time';
import { formatLocalTime } from '@/core/time';
import { computeAdherence } from '@/core/engine/adherence.engine';
import { newId } from '@/core/db/schema';
import type { RecurringTest, TestInterval } from '@/core/db/schema';
import { TEST_INTERVAL_LABELS } from '@/i18n/ar';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export function CalendarView() {
  const person = useApp((s) => s.activePerson());
  const doseEvents = useApp((s) => s.doseEvents);
  const medications = useApp((s) => s.medications);
  const statuses = useApp((s) => s.statuses);
  const repo = useApp((s) => s.repo);

  const tz = person?.timezone ?? 'Africa/Cairo';
  const today = person ? todayIn(tz) : todayIn('Africa/Cairo');

  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(today);
  const [testOpen, setTestOpen] = useState(false);

  const queryClient = useQueryClient();

  const { data: tests = [] } = useQuery({
    queryKey: ['recurringTests', person?.id],
    queryFn: () => (person ? repo.listRecurringTests(person.id) : Promise.resolve([])),
    enabled: !!person,
  });

  const monthAnchor = addLocalMonths(today, monthOffset);
  const { year, month } = parseYearMonth(monthAnchor);
  const monthDays = daysInMonth(year, month);
  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  /** Local day → doses, for the whole loaded window. */
  const byDay = useMemo(() => {
    const map = new Map<string, typeof doseEvents>();
    for (const e of doseEvents) {
      const list = map.get(e.localDay) ?? [];
      list.push(e);
      map.set(e.localDay, list);
    }
    return map;
  }, [doseEvents]);

  const selectedDoses = useMemo(
    () =>
      (byDay.get(selectedDay) ?? []).sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)),
    [byDay, selectedDay],
  );

  const selectedAdherence = useMemo(
    () => computeAdherence(selectedDoses),
    [selectedDoses],
  );

  const selectedTests = tests.filter((t) => t.nextDue === selectedDay);

  const monthLabel = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

  if (!person) return null;

  const cells: (string | null)[] = [
    ...Array.from({ length: firstDayOfWeek }, () => null),
    ...Array.from({ length: monthDays }, (_, i) => {
      const d = String(i + 1).padStart(2, '0');
      const m = String(month).padStart(2, '0');
      return `${year}-${m}-${d}`;
    }),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="التقويم"
        subtitle="الجرعات والفحوصات الدورية"
        action={
          <Btn onClick={() => setTestOpen(true)}>
            <Plus className="h-4 w-4" />
            فحص دوري
          </Btn>
        }
      />

      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex items-center justify-between">
            <Btn variant="ghost" size="icon" aria-label="الشهر السابق" onClick={() => setMonthOffset((o) => o - 1)}>
              <ChevronRight className="h-5 w-5" />
            </Btn>
            <p className="text-base font-bold">{monthLabel}</p>
            <Btn variant="ghost" size="icon" aria-label="الشهر التالي" onClick={() => setMonthOffset((o) => o + 1)}>
              <ChevronLeft className="h-5 w-5" />
            </Btn>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="pb-1 text-[0.65rem] font-semibold text-muted-foreground">
                {d.slice(0, 3)}
              </div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} />;
              const doses = byDay.get(day) ?? [];
              const taken = doses.filter((d) => (statuses.get(d.id) ?? d.status) === 'taken').length;
              const missed = doses.filter((d) => (statuses.get(d.id) ?? d.status) === 'missed').length;
              const isToday = day === today;
              const isSelected = day === selectedDay;
              const hasTest = tests.some((t) => t.nextDue === day);
              const dayNum = Number(day.slice(8, 10));

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    'relative flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition-colors',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : isToday
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-transparent hover:bg-accent',
                  )}
                >
                  <span className={cn('numeric font-semibold', isToday && !isSelected && 'text-primary')}>
                    {dayNum}
                  </span>
                  {doses.length > 0 && (
                    <span className="mt-0.5 flex gap-0.5">
                      {taken > 0 && (
                        <span className={cn('h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white' : 'bg-[hsl(var(--success))]')} />
                      )}
                      {missed > 0 && (
                        <span className={cn('h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white/70' : 'bg-destructive')} />
                      )}
                      {taken === 0 && missed === 0 && (
                        <span className={cn('h-1.5 w-1.5 rounded-full', isSelected ? 'bg-white/50' : 'bg-muted-foreground/40')} />
                      )}
                    </span>
                  )}
                  {hasTest && (
                    <FlaskConical className={cn('absolute right-0.5 top-0.5 h-2.5 w-2.5', isSelected ? 'text-white' : 'text-primary')} />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <CalendarDays className="h-5 w-5" />
            {friendlyDayLabel(selectedDay, today)}
          </h2>
          {selectedAdherence.percent !== null && (
            <Badge tone={selectedAdherence.percent >= 85 ? 'success' : selectedAdherence.percent >= 70 ? 'warning' : 'danger'}>
              التزام {selectedAdherence.percent}٪
            </Badge>
          )}
        </div>

        {selectedTests.length > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-1 pt-5">
              <p className="text-sm font-bold text-primary">فحوصات مستحقة</p>
              {selectedTests.map((t) => (
                <p key={t.id} className="text-sm">
                  {t.name} · {TEST_INTERVAL_LABELS[t.interval] ?? t.interval}
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {selectedDoses.length === 0 ? (
          <EmptyState title="لا توجد جرعات في هذا اليوم" />
        ) : (
          <div className="space-y-1.5">
            {selectedDoses.map((d) => {
              const s = statuses.get(d.id) ?? d.status;
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="numeric font-bold">{formatLocalTime(d.scheduledAtUtc, tz)}</span>
                    <span className="truncate">{medById.get(d.medId)?.nameAr ?? '—'}</span>
                  </div>
                  <Badge
                    tone={
                      s === 'taken' ? 'success' : s === 'missed' ? 'danger' : s === 'skipped' ? 'muted' : 'info'
                    }
                  >
                    {s === 'taken' ? 'تم أخذها' : s === 'missed' ? 'فائتة' : s === 'skipped' ? 'متخطاة' : 'لم يحن'}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <QuickNav onPick={setSelectedDay} today={today} />

      <RecurringTestDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        personId={person.id}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['recurringTests', person.id] })}
      />
    </div>
  );
}

function QuickNav({ onPick, today }: { onPick: (day: string) => void; today: string }) {
  const offsets = [-7, -3, -1, 0, 1, 3, 7];
  return (
    <div className="flex flex-wrap justify-center gap-1.5 pb-2">
      {offsets.map((o) => (
        <Btn key={o} variant="outline" size="sm" onClick={() => onPick(addLocalDays(today, o))}>
          {o === 0 ? 'اليوم' : o > 0 ? `+${o}ي` : `${o}ي`}
        </Btn>
      ))}
    </div>
  );
}

function parseYearMonth(day: string): { year: number; month: number } {
  const [y, m] = day.split('-').map(Number);
  return { year: y ?? 2026, month: m ?? 1 };
}

/* Keeps the derived-status helper referenced for the calendar legend. */
export const CALENDAR_USES_DERIVED = derivedStatus;

function RecurringTestDialog({
  open,
  onOpenChange,
  personId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string;
  onSaved: () => void;
}) {
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const [name, setName] = useState('');
  const [interval, setInterval] = useState<TestInterval>('3m');
  const [nextDue, setNextDue] = useState('');

  const save = async () => {
    const now = new Date().toISOString();
    const test: RecurringTest = {
      id: newId('test'),
      personId,
      name: name.trim(),
      interval,
      nextDue: nextDue || now.slice(0, 10),
      updatedAt: now,
      updatedBy: device?.id ?? 'system',
      rev: 1,
      deleted: false,
    };
    await repo.putRecurringTest(test);
    onSaved();
    onOpenChange(false);
    setName('');
    setNextDue('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>إضافة فحص دوري</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="testName">اسم الفحص</Label>
            <Input
              id="testName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: تحليل INR"
            />
          </div>
          <div className="space-y-2">
            <Label>التكرار</Label>
            <Select value={interval} onValueChange={(v) => setInterval(v as TestInterval)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TEST_INTERVAL_LABELS).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="testDue">الموعد القادم</Label>
            <Input id="testDue" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Btn variant="ghost" onClick={() => onOpenChange(false)}>
            إلغاء
          </Btn>
          <Btn disabled={!name.trim()} onClick={() => void save()}>
            حفظ
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '@/app/store';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input, Label } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type { Schedule, TaperStep } from '@/core/db/schema';
import { SCHEDULE_KIND_LABELS, WEEKDAY_LABELS } from '@/i18n/ar';
import { cn, todayIn } from '@/lib/utils';

/**
 * Edits the live schedule for a medication.
 * Saving CLOSES the current schedule and inserts a new one (§5).
 */
export function ScheduleEditor({
  medId,
  personId,
  open,
  onOpenChange,
  existing,
}: {
  medId: string;
  personId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: Schedule;
}) {
  const person = useApp((s) => s.activePerson());
  const saveSchedule = useApp((s) => s.saveSchedule);
  const deleteSchedule = useApp((s) => s.deleteSchedule);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const timezone = person?.timezone ?? 'Africa/Cairo';
  const today = todayIn(timezone);

  const [kind, setKind] = useState<Schedule['kind']>(existing?.kind ?? 'daily');
  const [times, setTimes] = useState<string[]>(
    existing && existing.times.length > 0 ? existing.times : ['08:00'],
  );
  const [quantity, setQuantity] = useState(String(existing?.quantityPerDose ?? 1));
  const [intervalN, setIntervalN] = useState(String(existing?.intervalN ?? 2));
  const [weekdays, setWeekdays] = useState<number[]>(existing?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
  const [prnMax, setPrnMax] = useState(String(existing?.prnMaxPerDay ?? 3));
  const [taperSteps, setTaperSteps] = useState<TaperStep[]>(existing?.taperSteps ?? []);

  const save = async () => {
    setSaving(true);
    try {
      await saveSchedule({
        ...(existing ? { id: existing.id } : {}),
        medId,
        personId,
        kind,
        times: kind === 'prn' ? [] : times.filter(Boolean),
        quantityPerDose: Number(quantity) || 1,
        dosesPerDay: kind === 'prn' ? 0 : times.filter(Boolean).length,
        intervalN: kind === 'everyNDays' ? Number(intervalN) || 2 : undefined,
        weekdays: kind === 'weekdays' ? weekdays : undefined,
        prnMaxPerDay: kind === 'prn' ? Number(prnMax) || 3 : undefined,
        taperSteps: kind === 'taper' ? taperSteps : undefined,
        anchorDate: today,
        activeFrom: today,
        activeTo: null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تعديل جدول الجرعات</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          يُغلق الجدول الحالي ويُحفظ في السجل، ويبدأ الجدول الجديد من اليوم. كل الجرعات السابقة تبقى محفوظة.
        </p>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>نوع الجدول</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Schedule['kind'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SCHEDULE_KIND_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schQty">الكمية في الجرعة</Label>
              <Input
                id="schQty"
                type="number"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>

          {kind !== 'prn' && (
            <div className="space-y-2">
              <Label>المواعيد</Label>
              <div className="flex flex-wrap gap-2">
                {times.map((t, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      type="time"
                      className="w-32"
                      value={t}
                      onChange={(e) => {
                        const next = [...times];
                        next[i] = e.target.value;
                        setTimes(next);
                      }}
                    />
                    {times.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="حذف"
                        onClick={() => setTimes(times.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setTimes([...times, '20:00'])}>
                  <Plus className="h-4 w-4" />
                  موعد
                </Button>
              </div>
            </div>
          )}

          {kind === 'everyNDays' && (
            <div className="space-y-2">
              <Label htmlFor="schInterval">كل كم يوم؟</Label>
              <Input
                id="schInterval"
                type="number"
                value={intervalN}
                onChange={(e) => setIntervalN(e.target.value)}
              />
            </div>
          )}

          {kind === 'weekdays' && (
            <div className="space-y-2">
              <Label>أيام الأسبوع</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, idx) => {
                  const on = weekdays.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setWeekdays(on ? weekdays.filter((d) => d !== idx) : [...weekdays, idx])
                      }
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {kind === 'prn' && (
            <div className="space-y-2">
              <Label htmlFor="schPrnMax">أقصى عدد جرعات يومياً</Label>
              <Input
                id="schPrnMax"
                type="number"
                value={prnMax}
                onChange={(e) => setPrnMax(e.target.value)}
              />
            </div>
          )}

          {kind === 'taper' && (
            <div className="space-y-2">
              <Label>مراحل التقليل</Label>
              {taperSteps.map((s, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border p-2">
                  <Input
                    type="date"
                    className="w-36"
                    value={s.from}
                    onChange={(e) => {
                      const next = [...taperSteps];
                      next[i] = { ...s, from: e.target.value };
                      setTaperSteps(next);
                    }}
                  />
                  <Input
                    type="date"
                    className="w-36"
                    value={s.to}
                    onChange={(e) => {
                      const next = [...taperSteps];
                      next[i] = { ...s, to: e.target.value };
                      setTaperSteps(next);
                    }}
                  />
                  <Input
                    type="number"
                    className="w-24"
                    value={s.quantityPerDose}
                    onChange={(e) => {
                      const next = [...taperSteps];
                      next[i] = { ...s, quantityPerDose: Number(e.target.value) || 0 };
                      setTaperSteps(next);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="حذف"
                    onClick={() => setTaperSteps(taperSteps.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setTaperSteps([
                    ...taperSteps,
                    { from: today, to: today, quantityPerDose: Number(quantity) / 2 || 0.5 },
                  ])
                }
              >
                <Plus className="h-4 w-4" />
                إضافة مرحلة
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          {existing && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              حذف الجدول
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ الجدول'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الجدول</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            سيُغلق الجدول الحالي ولن يُولّد جرعات جديدة منه. الجرعات السابقة تبقى في السجل.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (existing) void deleteSchedule(existing.id);
                setDeleteOpen(false);
                onOpenChange(false);
              }}
            >
              حذف الجدول
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

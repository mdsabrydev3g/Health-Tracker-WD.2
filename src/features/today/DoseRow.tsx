import { useState } from 'react';
import { Check, Clock, Coffee, Ban, Undo2, Pill as PillIcon } from 'lucide-react';
import type { DoseEvent, Medication, Person } from '@/core/db/schema';
import { cn } from '@/lib/utils';
import { Badge, ProgressRing } from '@/ui/primitives';
import { Button } from '@/ui/button';
import { formatLocalTime } from '@/core/time';
import { FOOD_RULE_LABELS, FORM_LABELS } from '@/i18n/ar';
import { snoozeOptions } from '@/core/notify/scheduler';
import { useApp, derivedStatus } from '@/app/store';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'info' | 'default'> = {
  taken: 'success',
  due: 'warning',
  missed: 'danger',
  skipped: 'muted',
  snoozed: 'info',
  upcoming: 'default',
  cancelled: 'muted',
};

const STATUS_LABEL: Record<string, string> = {
  taken: 'تم أخذها',
  due: 'حان الموعد',
  missed: 'فائتة',
  skipped: 'متخطاة',
  snoozed: 'مؤجلة',
  upcoming: 'لم يحن بعد',
  cancelled: 'ملغاة',
};

export function DoseRow({
  dose,
  med,
  person,
  compact = false,
}: {
  dose: DoseEvent;
  med: Medication | undefined;
  person: Person | undefined;
  compact?: boolean;
}) {
  const state = useApp();
  const status = derivedStatus(state, dose);
  const markTaken = useApp((s) => s.markTaken);
  const skipDose = useApp((s) => s.skipDose);
  const snoozeDose = useApp((s) => s.snoozeDose);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const tz = person?.timezone ?? 'Africa/Cairo';
  const timeLabel = formatLocalTime(dose.scheduledAtUtc, tz);
  const food = med?.foodRule ? FOOD_RULE_LABELS[med.foodRule.mode] : undefined;
  const actionable = status === 'due' || status === 'upcoming' || status === 'snoozed';

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border bg-card p-3.5 transition-colors',
          status === 'due' && 'border-[hsl(var(--warning))]/50 bg-[hsl(var(--warning))]/5',
          status === 'missed' && 'border-destructive/40 bg-destructive/5',
          compact && 'p-3',
        )}
      >
        <div className="flex flex-col items-center gap-1">
          <span className="numeric text-sm font-bold">{timeLabel}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PillIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p
              className={cn('truncate font-bold', compact ? 'text-sm' : 'text-base')}
              data-testid={`dose-med-${dose.id}`}
            >
              {med?.nameAr ?? 'دواء محذوف'}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="numeric">
              {dose.quantity ?? 1} × {med?.strength.value ?? ''} {med?.strength.unit ?? ''}
            </span>
            {med?.form && <span>{FORM_LABELS[med.form] ?? med.form}</span>}
            {food && (
              <span className="inline-flex items-center gap-1">
                <Coffee className="h-3 w-3" />
                {food}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={STATUS_TONE[status] ?? 'muted'}>{STATUS_LABEL[status] ?? status}</Badge>

          {actionable && (
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                variant={status === 'due' ? 'success' : 'outline'}
                disabled={busy}
                onClick={() => void act(() => markTaken(dose.id, 'caregiver'))}
                aria-label="تم أخذ الجرعة"
                title="تم أخذ الجرعة"
                data-testid={`dose-take-${dose.id}`}
              >
                <Check className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                disabled={busy}
                onClick={() => setSnoozeOpen(true)}
                aria-label="تأجيل"
                title="تأجيل"
                data-testid={`dose-snooze-${dose.id}`}
              >
                <Clock className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={() => void act(() => skipDose(dose.id, 'caregiver'))}
                aria-label="تخطي"
                title="تخطي"
                data-testid={`dose-skip-${dose.id}`}
              >
                <Ban className="h-4 w-4" />
              </Button>
            </div>
          )}

          {status === 'missed' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => markTaken(dose.id, 'caregiver'))}
            >
              <Undo2 className="h-4 w-4" />
              سُجّلت متأخرة
            </Button>
          )}
        </div>
      </div>

      <Dialog open={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأجيل التذكير</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {snoozeOptions().map((opt) => (
              <Button
                key={opt.minutes}
                variant="outline"
                onClick={() => {
                  setSnoozeOpen(false);
                  void act(() => snoozeDose(dose.id, opt.minutes));
                }}
              >
                {opt.labelAr}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSnoozeOpen(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DayProgress({
  taken,
  total,
  size = 100,
}: {
  taken: number;
  total: number;
  size?: number;
}) {
  const pct = total > 0 ? taken / total : 0;
  const tone = pct >= 0.99 ? 'success' : pct >= 0.5 ? 'primary' : 'warning';
  return (
    <ProgressRing
      value={pct}
      size={size}
      tone={tone}
      label={`${taken}/${total}`}
      sublabel={total === 0 ? 'لا جرعات' : 'جرعات اليوم'}
    />
  );
}

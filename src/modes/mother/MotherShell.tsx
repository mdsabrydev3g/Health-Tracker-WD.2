import { useEffect, useMemo, useState } from 'react';
import { Check, Clock, HeartPulse, Volume2 } from 'lucide-react';
import { useApp } from '@/app/store';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { ProgressRing } from '@/ui/primitives';
import { formatLocalTime, todayIn } from '@/core/time';
import { FOOD_RULE_LABELS } from '@/i18n/ar';
import { snoozeOptions } from '@/core/notify/scheduler';
import { hapticTap, speakArabic, cn } from '@/lib/utils';
import { CaregiverPinDialog } from './CaregiverPinDialog';

/**
 * Mother Mode — one screen, giant buttons, Arabic only, no settings, no
 * navigation to caregiver areas (§4).
 *
 * Leaving requires the caregiver PIN, which is separate from the app lock.
 */
export function MotherShell() {
  const person = useApp((s) => s.activePerson());
  const doseEvents = useApp((s) => s.doseEvents);
  const medications = useApp((s) => s.medications);
  const statuses = useApp((s) => s.statuses);
  const settings = useApp((s) => s.settings);
  const markTaken = useApp((s) => s.markTaken);
  const snoozeDose = useApp((s) => s.snoozeDose);

  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = person ? todayIn(person.timezone) : todayIn('Africa/Cairo');

  const todaysDoses = useMemo(
    () =>
      doseEvents
        .filter((e) => e.localDay === today)
        .sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)),
    [doseEvents, today],
  );

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const { next, taken, total } = useMemo(() => {
    const now = Date.now();
    let takenCount = 0;
    let relevant = 0;
    for (const d of todaysDoses) {
      const s = statuses.get(d.id) ?? d.status;
      if (s === 'taken') takenCount++;
      if (s !== 'skipped' && s !== 'cancelled') relevant++;
    }
    // The "next" dose is the first one not yet taken — no time gating, so the
    // mother can always see what to do next even if she is late.
    const nextDose = todaysDoses.find((d) => {
      const s = statuses.get(d.id) ?? d.status;
      return s !== 'taken' && s !== 'skipped' && s !== 'cancelled';
    });
    void now;
    return { next: nextDose, taken: takenCount, total: relevant };
  }, [todaysDoses, statuses]);

  // Long-press the heart icon for 3s to reveal the caregiver PIN prompt.
  const [holdProgress, setHoldProgress] = useState(0);

  useEffect(() => {
    if (holdProgress === 0) return;
    const t = setTimeout(() => setHoldProgress((p) => Math.min(100, p + 4)), 40);
    return () => clearTimeout(t);
  }, [holdProgress]);

  useEffect(() => {
    if (holdProgress >= 100) {
      setHoldProgress(0);
      setExitOpen(true);
    }
  }, [holdProgress]);

  const med = next ? medById.get(next.medId) : undefined;
  const food = med?.foodRule ? FOOD_RULE_LABELS[med.foodRule.mode] : undefined;

  const handleTaken = async () => {
    if (!next || busy) return;
    setBusy(true);
    void hapticTap();
    try {
      await markTaken(next.id, 'mother');
      const msg = 'بارك الله فيك، تم تسجيل الجرعة';
      setToast(msg);
      if (settings.speakAloud) speakArabic(msg);
      setTimeout(() => setToast(null), 2600);
    } finally {
      setBusy(false);
    }
  };

  if (!person) return null;

  return (
    <div className="flex min-h-screen flex-col bg-background" dir="rtl">
      {/* Header: person + today's ring */}
      <header className="safe-top flex items-center justify-between gap-3 px-5 pb-2 pt-5">
        <div
          onMouseDown={() => setHoldProgress(1)}
          onMouseUp={() => setHoldProgress(0)}
          onMouseLeave={() => setHoldProgress(0)}
          onTouchStart={() => setHoldProgress(1)}
          onTouchEnd={() => setHoldProgress(0)}
          className="relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl bg-primary/10"
          title="اضغط مطولاً للخروج"
        >
          <HeartPulse className="h-6 w-6 text-primary" />
          {holdProgress > 0 && (
            <span
              className="absolute inset-0 rounded-2xl border-2 border-primary"
              style={{ clipPath: `inset(0 0 ${100 - holdProgress}% 0)` }}
            />
          )}
        </div>
        <div className="text-center">
          <p className="text-base font-extrabold">{person.nameAr}</p>
          <p className="text-xs text-muted-foreground">Health Tracker</p>
        </div>
        <ProgressRing value={total > 0 ? taken / total : 0} size={52} stroke={6} label={`${taken}/${total}`} />
      </header>

      {/* Giant next-dose card */}
      <main className="flex flex-1 flex-col justify-center gap-5 px-5 py-4">
        {next && med ? (
          <>
            <div className="dose-card-giant border-primary/40 bg-primary/5">
              <p className="text-lg font-bold text-primary">حان موعد جرعة</p>
              <p className="mt-2 text-3xl font-extrabold leading-tight">{med.nameAr}</p>
              <p className="numeric mt-2 text-2xl font-bold text-foreground">
                {formatLocalTime(next.scheduledAtUtc, person.timezone)}
              </p>
              <p className="mt-3 text-lg text-muted-foreground">
                {next.quantity ?? 1} × {med.strength.value} {med.strength.unit}
              </p>
              {food && <p className="mt-1 text-base text-muted-foreground">{food}</p>}
            </div>

            {settings.speakAloud && (
              <Button
                variant="ghost"
                className="mx-auto"
                onClick={() => speakArabic(`حان موعد جرعة ${med.nameAr}. ${food ?? ''}`)}
              >
                <Volume2 className="h-5 w-5" />
                اقرأ بصوت عالٍ
              </Button>
            )}

            <Button
              size="xl"
              variant="success"
              className="h-28 w-full text-2xl font-extrabold"
              disabled={busy}
              onClick={() => void handleTaken()}
              data-testid="mother-take-dose"
            >
              <Check className="h-9 w-9" />
              أخذت الدواء
            </Button>

            <Button
              size="lg"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => setSnoozeOpen(true)}
            >
              <Clock className="h-6 w-6" />
              تأجيل
            </Button>
          </>
        ) : (
          <div className="dose-card-giant border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/8">
            <Check className="mx-auto h-16 w-16 text-[hsl(var(--success))]" />
            <p className="mt-4 text-2xl font-extrabold text-[hsl(var(--success))]">
              لا توجد جرعات متبقية اليوم
            </p>
            <p className="mt-2 text-lg text-muted-foreground">تم أخذ جميع جرعات اليوم. بارك الله فيك.</p>
          </div>
        )}
      </main>

      {/* Today's progress footer */}
      <footer className="border-t bg-card px-5 py-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-center gap-8 text-center">
          <div>
            <p className="numeric text-2xl font-extrabold text-[hsl(var(--success))]">{taken}</p>
            <p className="text-sm text-muted-foreground">تم أخذها</p>
          </div>
          <div className="h-10 w-px bg-border" />
          <div>
            <p className="numeric text-2xl font-extrabold">{Math.max(0, total - taken)}</p>
            <p className="text-sm text-muted-foreground">المتبقية</p>
          </div>
        </div>
      </footer>

      {/* Success toast */}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-4 top-4 z-50 rounded-2xl bg-[hsl(var(--success))] px-5 py-4 text-center text-lg font-bold text-[hsl(var(--success-foreground))] shadow-lg transition-all duration-300',
          toast ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0',
        )}
        role="status"
        aria-live="polite"
      >
        {toast ?? ''}
      </div>

      {/* Snooze */}
      <Dialog open={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl">تأجيل التذكير</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {snoozeOptions().map((opt) => (
              <Button
                key={opt.minutes}
                size="lg"
                variant="outline"
                className="text-lg"
                onClick={() => {
                  setSnoozeOpen(false);
                  if (next) void snoozeDose(next.id, opt.minutes);
                }}
              >
                {opt.labelAr}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Exit requires the caregiver PIN */}
      <CaregiverPinDialog open={exitOpen} onOpenChange={setExitOpen} />
    </div>
  );
}

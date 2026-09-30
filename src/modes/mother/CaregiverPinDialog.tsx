import { useEffect, useState } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import { useApp } from '@/app/store';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { hashString } from '@/core/db/schema';

/**
 * Leaving Mother Mode requires the caregiver PIN (§4).
 *
 * The PIN is stored in settings and is separate from the app-lock PIN.
 *
 * HONESTY ABOUT THE STORAGE: `hashString` is deliberately a small,
 * NON-cryptographic hash (see schema.ts) — it exists to avoid keeping the PIN
 * in plain text, not to withstand a determined attacker with the device. The
 * PIN's job is to stop an elderly parent from wandering out of the simple
 * screen by accident, and it is only reachable behind a 3-second long-press on
 * the heart icon. Treating it as real cryptography would be a lie.
 */
const PIN_KEY = 'health-tracker:caregiver-pin-hash';

export function hashPin(pin: string): string {
  return hashString(`ht::caregiver::${pin}`);
}

export function setCaregiverPin(pin: string): void {
  localStorage.setItem(PIN_KEY, hashPin(pin));
}

export function hasCaregiverPin(): boolean {
  return !!localStorage.getItem(PIN_KEY);
}

export function verifyCaregiverPin(pin: string): boolean {
  const stored = localStorage.getItem(PIN_KEY);
  if (!stored) return false;
  return stored === hashPin(pin);
}

export function CaregiverPinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const switchMode = useApp((s) => s.switchMode);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  /** No PIN on this device = nothing to check, and locking the user out of
   *  their own app would be worse than the (nil) protection it provides. */
  const [pinExists, setPinExists] = useState(true);

  useEffect(() => {
    if (!open) {
      setPin('');
      setError('');
      return;
    }
    setPinExists(hasCaregiverPin());
  }, [open]);

  const exitWithoutPin = async () => {
    setPin('');
    onOpenChange(false);
    await switchMode('caregiver');
  };

  const submit = async () => {
    if (verifyCaregiverPin(pin)) {
      setPin('');
      onOpenChange(false);
      await switchMode('caregiver');
      return;
    }
    setAttempts((a) => a + 1);
    setError('الرقم السري غير صحيح');
    setPin('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            الخروج من وضع الوالدة
          </DialogTitle>
        </DialogHeader>

        {!pinExists ? (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm leading-relaxed">
                لم يتم ضبط رقم سري على هذا الجهاز، لذلك لا يوجد ما يمنع الخروج. يُنصح بضبط
                رقم سري من الإعدادات بعد الدخول.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                إلغاء
              </Button>
              <Button onClick={() => void exitWithoutPin()}>الدخول إلى وضع الإدارة</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              أدخل الرقم السري لمقدم الرعاية للعودة إلى وضع الإدارة الكامل.
            </p>
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              placeholder="الرقم السري"
              onChange={(e) => {
                setPin(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
            {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
            {attempts >= 3 && (
              <div className="space-y-1 rounded-lg border p-3">
                <p className="text-xs font-semibold">نسيت الرقم السري؟</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  الرقم مخزَّن مشفَّرًا ولا يمكن استرجاعه. لإعادة ضبطه: أوقف التطبيق، ثم من
                  إعدادات الهاتف ← التطبيقات ← Health Tracker ← التخزين ← «مسح البيانات»،
                  وبعدها أعد الإعداد من جديد. إن كنت قد صدّرت نسخة احتياطية فيمكنك
                  استعادتها.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                إلغاء
              </Button>
              <Button onClick={() => void submit()} disabled={pin.length < 4}>
                تأكيد
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

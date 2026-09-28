import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { useApp } from '@/app/store';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { hashString } from '@/core/db/schema';

/**
 * Leaving Mother Mode requires the caregiver PIN (§4).
 * The PIN is stored as a salted hash in settings, never in plain text,
 * and is separate from the app-lock PIN.
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

  useEffect(() => {
    if (!open) {
      setPin('');
      setError('');
    }
  }, [open]);

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
          <p className="text-xs text-muted-foreground">
            إذا نسيت الرقم السري، افتح التطبيق على جهازك الآخر وغيّره من الإعدادات.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => void submit()} disabled={pin.length < 4}>
            تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

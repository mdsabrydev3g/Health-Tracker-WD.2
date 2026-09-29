import { useEffect, useState } from 'react';
import { BellRing, Camera, ShieldCheck } from 'lucide-react';
import { useApp } from '@/app/store';
import {
  hasCriticalAlarmIssue,
  refreshAlarmHealth,
  requestRuntimePermissions,
  type PermissionRequestResult,
} from '@/core/notify/scheduler';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';

/** A real grant is remembered for good; "later" only silences this session. */
const GRANTED_KEY = 'ht:perms:granted';
const LATER_KEY = 'ht:perms:later';

function StatusRow({
  icon,
  label,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <span className="flex items-center gap-2 text-sm">
        {icon}
        {label}
      </span>
      <span className={ok ? 'text-sm font-semibold text-primary' : 'text-sm text-muted-foreground'}>
        {ok ? 'مسموح' : 'غير مسموح'}
      </span>
    </div>
  );
}

/**
 * Asks for notifications + camera the way any ordinary app does: one friendly
 * dialog, then the OS shows its own Allow prompt. Replaces the old red banner
 * that sat at the very top of the screen, sat under the status bar and did not
 * respond to taps.
 */
export function PermissionPrompt() {
  const device = useApp((s) => s.device);
  const repo = useApp((s) => s.repo);

  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState<PermissionRequestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === 'undefined') return;
      // Granted for good → never ask again. "Later" only mutes this session,
      // so the prompt reliably comes back on the next launch until it is granted.
      if (window.localStorage.getItem(GRANTED_KEY) === '1') return;
      if (window.sessionStorage.getItem(LATER_KEY) === '1') return;

      const health = await refreshAlarmHealth();
      if (cancelled || !health) return;
      if (hasCriticalAlarmIssue(health)) setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allow = async () => {
    setRequesting(true);
    try {
      const res = await requestRuntimePermissions();
      setResult(res);

      const health = await refreshAlarmHealth();
      if (device && health) {
        await repo.putDevice({
          ...device,
          alarmHealth: health,
          lastSeenAt: new Date().toISOString(),
          rev: device.rev + 1,
        });
        useApp.setState({ device: { ...device, alarmHealth: health } });
      }

      // Everything we need is granted — stop asking for good.
      if (health && !hasCriticalAlarmIssue(health)) {
        window.localStorage.setItem(GRANTED_KEY, '1');
        setOpen(false);
      }
    } finally {
      setRequesting(false);
    }
  };

  const later = () => {
    window.sessionStorage.setItem(LATER_KEY, '1');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>السماح بالأذونات المطلوبة</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            عشان التذكيرات توصلك في معادها بالظبط، التطبيق محتاج إذن الإشعارات
            والمنبّه الدقيق. وإذن الكاميرا مطلوب بس لو حبيت تمسح باركود علبة الدواء.
          </p>

          {result && (
            <div className="space-y-2">
              <StatusRow
                icon={<BellRing className="h-4 w-4" />}
                label="الإشعارات"
                ok={result.notifGranted}
              />
              <StatusRow
                icon={<ShieldCheck className="h-4 w-4" />}
                label="المنبّه الدقيق"
                ok={result.exactAlarmGranted}
              />
              <StatusRow
                icon={<Camera className="h-4 w-4" />}
                label="الكاميرا"
                ok={result.cameraGranted}
              />
              {hasCriticalAlarmIssue({
                notifGranted: result.notifGranted,
                exactAlarmGranted: result.exactAlarmGranted,
                batteryExempt: true,
                lastRescheduleAtUtc: new Date().toISOString(),
              }) && (
                <p className="text-xs text-muted-foreground">
                  لسه في إذن ناقص. تقدر تسمح بيه من إعدادات الهاتف، أو تضغط «السماح» تاني.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={later} disabled={requesting}>
            لاحقًا
          </Button>
          <Button onClick={() => void allow()} disabled={requesting}>
            {requesting ? 'جارٍ الطلب…' : 'السماح'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

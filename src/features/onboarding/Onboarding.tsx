import { useState } from 'react';
import {
  BellRing,
  BatteryCharging,
  Check,
  HeartPulse,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { Button } from '@/ui/button';
import { Input, Label } from '@/ui/input';
import { AlertBanner } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { getNativeAlarmApi, checkAlarmHealth } from '@/core/notify/scheduler';
import { CaregiverPinDialog, setCaregiverPin, hasCaregiverPin } from '@/modes/mother/CaregiverPinDialog';

type Step = 'welcome' | 'permissions' | 'pin' | 'device' | 'done';

const TIMEZONES = [
  { value: 'Africa/Cairo', label: 'القاهرة (Africa/Cairo)' },
  { value: 'Asia/Riyadh', label: 'الرياض (Asia/Riyadh)' },
  { value: 'Asia/Dubai', label: 'دبي (Asia/Dubai)' },
  { value: 'Asia/Amman', label: 'عمّان (Asia/Amman)' },
  { value: 'Africa/Khartoum', label: 'الخرطوم (Africa/Khartoum)' },
];

/**
 * First-run wizard on the caregiver's device (§4).
 * Requests notifications, exact alarms, and battery exemption with a plain
 * Arabic explanation — never silently falls back (§9).
 */
export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('الوالدة');
  const [timezone, setTimezone] = useState('Africa/Cairo');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [permissionState, setPermissionState] = useState<{
    notifGranted: boolean;
    exactAlarmGranted: boolean;
    batteryExempt: boolean;
  }>({ notifGranted: false, exactAlarmGranted: false, batteryExempt: false });
  const [requesting, setRequesting] = useState(false);

  const addPerson = useApp((s) => s.addPerson);
  const setActivePerson = useApp((s) => s.setActivePerson);
  const device = useApp((s) => s.device);
  const repo = useApp((s) => s.repo);

  /** Persist the caregiver PIN and the new person, then finish. */
  const completeSetup = async () => {
    if (pin.length >= 4 && pin === pinConfirm) setCaregiverPin(pin);
    const person = await addPerson({
      nameAr: name.trim() || 'الوالدة',
      timezone,
      largeTextDefault: true,
    });
    await setActivePerson(person.id);
    setStep('done');
  };

  const requestPermissions = async () => {
    setRequesting(true);
    try {
      // Browser notification permission (web/PWA path).
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission().catch(() => undefined);
      }

      const api = await getNativeAlarmApi();
      if (api) {
        const perms = await api.requestPermissions();
        if (perms.display !== 'granted') void perms;
        if (api.requestExactAlarmPermission) await api.requestExactAlarmPermission().catch(() => undefined);
        if (api.requestBatteryOptimizationExemption) {
          await api.requestBatteryOptimizationExemption().catch(() => undefined);
        }
      }

      const health = await checkAlarmHealth(api);
      setPermissionState({
        notifGranted: health.notifGranted,
        exactAlarmGranted: health.exactAlarmGranted,
        batteryExempt: health.batteryExempt,
      });

      // Record health so the watchdog and the caregiver banner work (§9).
      if (device) {
        await repo.putDevice({ ...device, alarmHealth: health, lastSeenAt: new Date().toISOString() });
      }
    } finally {
      setRequesting(false);
    }
  };

  const finish = async () => {
    // The person already exists; just leave onboarding.
    setStep('done');
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-5 p-5">
      <header className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10">
          <HeartPulse className="h-8 w-8 text-primary" />
        </div>
        <h1 className="mt-3 text-2xl font-extrabold">Health Tracker</h1>
        <p className="text-sm text-muted-foreground">رفيق الجرعات والصحة للعائلة</p>
      </header>

      <StepDots step={step} />

      {step === 'welcome' && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <h2 className="text-lg font-bold">أهلاً بك</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              هذا التطبيق لعائلتك: لمتابعة جرعات الوالدة والتأكد من عدم فوات أي دواء.
              كل البيانات تُحفظ على الجهاز وتُنسخ احتياطياً، ويعمل التطبيق بدون إنترنت.
            </p>
            <ul className="space-y-2 text-sm">
              {[
                'تذكيرات دقيقة بمواعيد الجرعات',
                'متابعة المخزون وصلاحية الأدوية',
                'ملفات طبية وملخصات بالعربية',
                'وضع مبسّط للوالدة بضغطة واحدة',
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Button className="w-full" size="lg" onClick={() => setStep('permissions')}>
              ابدأ الإعداد
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'permissions' && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <h2 className="text-lg font-bold">أذونات التذكير</h2>
            <p className="text-sm text-muted-foreground">
              هذه أهم خطوة: بدونها لن تصل التذكيرات في وقتها، وقد تفوت جرعة دواء للقلب.
            </p>

            <div className="space-y-3">
              <PermissionRow
                icon={<BellRing className="h-5 w-5" />}
                title="إذن الإشعارات"
                description="ليظهر تذكير الجرعة على الشاشة في وقتها."
                granted={permissionState.notifGranted}
              />
              <PermissionRow
                icon={<ShieldCheck className="h-5 w-5" />}
                title="المنبّهات الدقيقة"
                description="حتى لا يتأخر التذكير عند نوم الهاتف (مطلوب في أندرويد ١٤+)."
                granted={permissionState.exactAlarmGranted}
              />
              <PermissionRow
                icon={<BatteryCharging className="h-5 w-5" />}
                title="استثناء من تحسين البطارية"
                description="يمنع النظام من إيقاف التطبيق وإفلات التذكير."
                granted={permissionState.batteryExempt}
              />
            </div>

            {!permissionState.notifGranted && (
              <AlertBanner tone="warning" title="لم تُمنح الأذونات بعد">
                <p>اضغط الزر أدناه، ثم اسمح بكل طلب يظهر على الشاشة.</p>
              </AlertBanner>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('pin')}>
                لاحقاً
              </Button>
              <Button
                className="flex-1"
                disabled={requesting}
                onClick={() => void requestPermissions()}
              >
                {requesting ? 'جارٍ الطلب…' : 'منح الأذونات'}
              </Button>
            </div>

            {permissionState.notifGranted && (
              <Button variant="success" className="w-full" onClick={() => setStep('pin')}>
                متابعة
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {step === 'pin' && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <h2 className="text-lg font-bold">الرقم السري لمقدم الرعاية</h2>
            <p className="text-sm text-muted-foreground">
              يُستخدم للخروج من وضع الوالدة المبسّط، ولحماية البيانات الحساسة. اختر ٤ أرقام على الأقل.
            </p>

            <div className="space-y-2">
              <Label htmlFor="pin">الرقم السري</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="٤ أرقام على الأقل"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin2">تأكيد الرقم السري</Label>
              <Input
                id="pin2"
                type="password"
                inputMode="numeric"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="أعد إدخاله"
              />
            </div>

            {pin.length >= 4 && pin !== pinConfirm && pinConfirm.length > 0 && (
              <p className="text-sm font-semibold text-destructive">الرقمان غير متطابقين</p>
            )}

            <Button
              className="w-full"
              disabled={pin.length < 4 || pin !== pinConfirm}
              onClick={() => setStep('device')}
            >
              متابعة
            </Button>
            {hasCaregiverPin() && (
              <p className="text-xs text-muted-foreground">يوجد رقم سري محفوظ مسبقاً على هذا الجهاز.</p>
            )}
          </CardContent>
        </Card>
      )}

      {step === 'device' && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <User className="h-5 w-5" />
              بيانات المتابَع
            </h2>

            <div className="space-y-2">
              <Label htmlFor="name">الاسم</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: الوالدة"
              />
            </div>

            <div className="space-y-2">
              <Label>المنطقة الزمنية</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                تُستخدم لحساب مواعيد الجرعات بدقة — بما في ذلك التوقيت الصيفي.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('pin')}>
                رجوع
              </Button>
              <Button className="flex-1" onClick={() => void completeSetup()}>
                إنهاء الإعداد
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'done' && (
        <Card>
          <CardContent className="space-y-4 pt-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--success))]/12">
              <Check className="h-8 w-8 text-[hsl(var(--success))]" />
            </div>
            <h2 className="text-lg font-bold">تم الإعداد بنجاح</h2>
            <p className="text-sm text-muted-foreground">
              يمكنك الآن تجربة وضع الوالدة على هاتفها، ثم العودة إلى وضع مقدم الرعاية بالرقم السري.
            </p>
            <Button className="w-full" size="lg" onClick={() => void finish()}>
              <Smartphone className="h-5 w-5" />
              ابدأ الاستخدام
            </Button>
          </CardContent>
        </Card>
      )}

      <CaregiverPinDialog open={false} onOpenChange={() => {}} />
    </div>
  );
}

function PermissionRow({
  icon,
  title,
  description,
  granted,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  granted: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border p-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <span
        className={
          granted
            ? 'mt-1 h-3 w-3 shrink-0 rounded-full bg-[hsl(var(--success))]'
            : 'mt-1 h-3 w-3 shrink-0 rounded-full bg-destructive'
        }
        aria-label={granted ? 'ممنوح' : 'غير ممنوح'}
      />
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ['welcome', 'permissions', 'pin', 'device', 'done'];
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden>
      {order.map((s, i) => (
        <span
          key={s}
          className={
            i <= idx
              ? 'h-1.5 w-6 rounded-full bg-primary transition-all'
              : 'h-1.5 w-3 rounded-full bg-muted transition-all'
          }
        />
      ))}
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  BellRing,
  BatteryCharging,
  Lock,
  Monitor,
  Palette,
  ShieldCheck,
  Smartphone,
  Type,
  UserCog,
  Volume2,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { AlertBanner, Badge } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input, Label } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Switch } from '@/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import {
  checkAlarmHealth,
  describeAlarmHealthIssues,
  getNativeAlarmApi,
} from '@/core/notify/scheduler';
import { setCaregiverPin } from '@/modes/mother/CaregiverPinDialog';

export function Settings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const device = useApp((s) => s.device);
  const repo = useApp((s) => s.repo);
  const person = useApp((s) => s.activePerson());
  const persons = useApp((s) => s.persons);

  const [pinOpen, setPinOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [checking, setChecking] = useState(false);

  const issues = device?.alarmHealth ? describeAlarmHealthIssues(device.alarmHealth) : [];

  const recheck = async () => {
    setChecking(true);
    try {
      const api = await getNativeAlarmApi();
      const health = await checkAlarmHealth(api);
      if (device) {
        await repo.putDevice({
          ...device,
          alarmHealth: health,
          lastSeenAt: new Date().toISOString(),
          rev: device.rev + 1,
        });
        useApp.setState({ device: { ...device, alarmHealth: health } });
      }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!device?.alarmHealth?.lastRescheduleAtUtc) void recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePin = async () => {
    if (newPin.length >= 4 && newPin === pinConfirm) {
      setCaregiverPin(newPin);
      setPinOpen(false);
      setNewPin('');
      setPinConfirm('');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="الإعدادات" subtitle={device?.label ?? ''} />

      {/* Alarm health — the watchdog surface (§9) */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 font-bold">
              <BellRing className="h-4 w-4 text-primary" />
              حالة التذكيرات
            </p>
            <Button size="sm" variant="outline" disabled={checking} onClick={() => void recheck()}>
              {checking ? 'جارٍ الفحص…' : 'فحص الآن'}
            </Button>
          </div>

          {device?.alarmHealth && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <HealthTile
                icon={<BellRing className="h-4 w-4" />}
                label="الإشعارات"
                ok={device.alarmHealth.notifGranted}
              />
              <HealthTile
                icon={<ShieldCheck className="h-4 w-4" />}
                label="منبّه دقيق"
                ok={device.alarmHealth.exactAlarmGranted}
              />
              <HealthTile
                icon={<BatteryCharging className="h-4 w-4" />}
                label="استثناء البطارية"
                ok={device.alarmHealth.batteryExempt}
              />
            </div>
          )}

          {issues.length === 0 ? (
            <AlertBanner tone="success" title="التذكيرات تعمل بشكل صحيح">
              <p>جميع الأذونات المطلوبة ممنوحة على هذا الجهاز.</p>
            </AlertBanner>
          ) : (
            issues.map((issue) => (
              <AlertBanner key={issue.key} tone="danger" title={issue.messageAr}>
                <p>{issue.actionAr}</p>
              </AlertBanner>
            ))
          )}

          {device?.alarmHealth?.lastRescheduleAtUtc && (
            <p className="numeric text-xs text-muted-foreground">
              آخر تحديث للتذكيرات: {device.alarmHealth.lastRescheduleAtUtc.slice(0, 16).replace('T', ' ')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Mode */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <UserCog className="h-4 w-4 text-primary" />
            الوضع
          </p>
          <Select
            value={settings.activeMode}
            onValueChange={(v) => void setSettings({ activeMode: v as 'caregiver' | 'mother' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="caregiver">وضع مقدم الرعاية (كامل)</SelectItem>
              <SelectItem value="mother">وضع الوالدة (مبسّط ومقفل)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            في وضع الوالدة تظهر شاشة واحدة فقط بزر كبير لأخذ الدواء، ولا يمكن الوصول إلى باقي الشاشات بدون
            الرقم السري.
          </p>
        </CardContent>
      </Card>

      {/* Person selector */}
      {persons.length > 1 && (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="font-bold">الشخص المتابَع</p>
            <Select value={person?.id ?? ''} onValueChange={(v) => void useApp.getState().setActivePerson(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {persons.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {/* Appearance */}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <Palette className="h-4 w-4 text-primary" />
            المظهر وسهولة القراءة
          </p>

          <Row label="المظهر" icon={<Monitor className="h-4 w-4" />}>
            <Select
              value={settings.theme}
              onValueChange={(v) => void setSettings({ theme: v as 'light' | 'dark' | 'system' })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">فاتح</SelectItem>
                <SelectItem value="dark">داكن</SelectItem>
                <SelectItem value="system">حسب النظام</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label="شكل الأرقام" icon={<Type className="h-4 w-4" />}>
            <Select
              value={settings.numeralStyle}
              onValueChange={(v) => void setSettings({ numeralStyle: v as 'western' | 'eastern' })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="western">0123</SelectItem>
                <SelectItem value="eastern">٠١٢٣</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <ToggleRow
            label="خط كبير"
            description="نص أكبر وأزرار أسهل للمس."
            icon={<Type className="h-4 w-4" />}
            checked={settings.largeText}
            onChange={(v) => void setSettings({ largeText: v })}
          />

          <ToggleRow
            label="القراءة بصوت عالٍ"
            description="يقرأ اسم الدواء والتعليمات بالعربية."
            icon={<Volume2 className="h-4 w-4" />}
            checked={settings.speakAloud}
            onChange={(v) => void setSettings({ speakAloud: v })}
          />
        </CardContent>
      </Card>

      {/* Reminder thresholds */}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <BellRing className="h-4 w-4 text-primary" />
            قواعد التذكير والمخزون
          </p>

          <Row label="مهلة التأخير قبل اعتبار الجرعة فائتة">
            <Select
              value={String(settings.missedGraceMinutes)}
              onValueChange={(v) => void setSettings({ missedGraceMinutes: Number(v) })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[30, 60, 90, 120, 180, 240].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} دقيقة
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label="حد التنبيه للمخزون المنخفض">
            <Select
              value={String(settings.lowStockThresholdDays)}
              onValueChange={(v) => void setSettings({ lowStockThresholdDays: Number(v) })}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 5, 7].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} يوم
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <Lock className="h-4 w-4 text-primary" />
            الأمان
          </p>

          <ToggleRow
            label="قفل التطبيق"
            description="يطلب الرقم السري عند فتح التطبيق."
            icon={<Lock className="h-4 w-4" />}
            checked={settings.appLockEnabled}
            onChange={(v) => void setSettings({ appLockEnabled: v })}
          />

          {settings.appLockEnabled && (
            <Row label="القفل التلقائي بعد">
              <Select
                value={String(settings.autoLockMinutes)}
                onValueChange={(v) => void setSettings({ autoLockMinutes: Number(v) })}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 5, 10, 30].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} دقيقة
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          )}

          <Button variant="outline" className="w-full" onClick={() => setPinOpen(true)}>
            تغيير الرقم السري لمقدم الرعاية
          </Button>
        </CardContent>
      </Card>

      {/* Device */}
      <Card>
        <CardContent className="space-y-2 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <Smartphone className="h-4 w-4 text-primary" />
            هذا الجهاز
          </p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">النوع</span>
            <span className="font-semibold">{device?.label ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">مرتبط بـ</span>
            <span className="font-semibold">
              {device?.boundPersonId
                ? (persons.find((p) => p.id === device.boundPersonId)?.nameAr ?? '—')
                : 'لا يوجد (جهاز مقدم الرعاية)'}
            </span>
          </div>
          {device?.boundPersonId && <Badge tone="success">يستقبل أزرار الجرعة التفاعلية</Badge>}
        </CardContent>
      </Card>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تغيير الرقم السري</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="np">الرقم الجديد</Label>
              <Input
                id="np"
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np2">تأكيد الرقم</Label>
              <Input
                id="np2"
                type="password"
                inputMode="numeric"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
            </div>
            {newPin.length >= 4 && newPin !== pinConfirm && pinConfirm.length > 0 && (
              <p className="text-sm font-semibold text-destructive">الرقمان غير متطابقين</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPinOpen(false)}>
              إلغاء
            </Button>
            <Button disabled={newPin.length < 4 || newPin !== pinConfirm} onClick={() => void savePin()}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  icon,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function HealthTile({ icon, label, ok }: { icon: React.ReactNode; label: string; ok: boolean }) {
  return (
    <div
      className={
        ok
          ? 'rounded-xl border border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/8 p-2.5'
          : 'rounded-xl border border-destructive/40 bg-destructive/8 p-2.5'
      }
    >
      <div className={ok ? 'mx-auto text-[hsl(var(--success))]' : 'mx-auto text-destructive'}>{icon}</div>
      <p className="mt-1 text-[0.7rem] font-semibold">{label}</p>
      <p className={ok ? 'text-[0.7rem] font-bold text-[hsl(var(--success))]' : 'text-[0.7rem] font-bold text-destructive'}>
        {ok ? 'سليم' : 'يحتاج إصلاح'}
      </p>
    </div>
  );
}

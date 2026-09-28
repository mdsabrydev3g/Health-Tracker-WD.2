import { useMemo, useState } from 'react';
import { Phone, Plus, ShieldPlus, User } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { AlertBanner, Badge, EmptyState } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input, Label } from '@/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type { Person } from '@/core/db/schema';
import { newId } from '@/core/db/schema';

const TIMEZONES = [
  'Africa/Cairo',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Amman',
  'Africa/Khartoum',
  'Africa/Casablanca',
  'Europe/London',
];

export function People() {
  const persons = useApp((s) => s.persons);
  const activePersonId = useApp((s) => s.activePersonId);
  const setActivePerson = useApp((s) => s.setActivePerson);
  const addPerson = useApp((s) => s.addPerson);
  const medications = useApp((s) => s.medications);
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Africa/Cairo');
  const [dob, setDob] = useState('');
  const [bloodType, setBloodType] = useState('');

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: () => repo.listDevices(),
  });

  const deviceByPerson = useMemo(() => {
    const map = new Map<string, typeof devices>();
    for (const d of devices) {
      if (!d.boundPersonId) continue;
      const list = map.get(d.boundPersonId) ?? [];
      list.push(d);
      map.set(d.boundPersonId, list);
    }
    return map;
  }, [devices]);

  const save = async () => {
    const person = await addPerson({ nameAr: name.trim(), timezone, ...(dob ? { dob } : {}), ...(bloodType ? { bloodType } : {}) });
    if (persons.length === 0) await setActivePerson(person.id);
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
    setOpen(false);
    setName('');
    setDob('');
    setBloodType('');
  };

  const bindDevice = async (person: Person, deviceId: string) => {
    const d = devices.find((x) => x.id === deviceId);
    if (!d) return;
    // A device is bound to at most ONE person (§4).
    const now = new Date().toISOString();
    await repo.putDevice({
      ...d,
      boundPersonId: d.boundPersonId === person.id ? null : person.id,
      updatedAt: now,
      updatedBy: device?.id ?? 'system',
      rev: d.rev + 1,
    });
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="الأشخاص"
        subtitle={`${persons.length} شخص · الأجهزة المرتبطة`}
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        }
      />

      <AlertBanner tone="info" title="كيف يعمل وضع الوالدة؟" icon={<ShieldPlus className="h-5 w-5" />}>
        <p>
          اربط هاتف الوالدة باسمها من هنا، ثم فعّل «وضع الوالدة» من الإعدادات على ذلك الهاتف. الجهاز المرتبط
          بشخص واحد فقط يستقبل أزرار الجرعة التفاعلية.
        </p>
      </AlertBanner>

      {persons.length === 0 ? (
        <EmptyState icon={<User className="h-10 w-10" />} title="لا يوجد أشخاص بعد" />
      ) : (
        <div className="space-y-2">
          {persons.map((p) => {
            const bound = deviceByPerson.get(p.id) ?? [];
            const medCount = medications.filter((m) => m.personId === p.id).length;
            const isActive = p.id === activePersonId;
            return (
              <Card key={p.id} className={isActive ? 'border-primary/50' : undefined}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold text-white"
                      style={{ backgroundColor: p.colorTag ?? '#0f766e' }}
                    >
                      {p.nameAr.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-bold">{p.nameAr}</p>
                        {isActive && <Badge tone="success">المتابَع حالياً</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.timezone}
                        {p.dob ? ` · ${p.dob}` : ''}
                        {p.bloodType ? ` · ${p.bloodType}` : ''}
                      </p>
                      <p className="numeric mt-0.5 text-xs text-muted-foreground">{medCount} دواء</p>
                    </div>
                    {!isActive && (
                      <Button size="sm" variant="outline" onClick={() => void setActivePerson(p.id)}>
                        متابعة
                      </Button>
                    )}
                  </div>

                  {p.emergencyContact && (
                    <a
                      href={`tel:${p.emergencyContact.phone}`}
                      className="flex items-center gap-2 rounded-xl border p-2.5 text-sm hover:bg-accent"
                    >
                      <Phone className="h-4 w-4 text-primary" />
                      <span>
                        {p.emergencyContact.name} · {p.emergencyContact.relation}
                      </span>
                      <span className="numeric ms-auto text-muted-foreground" dir="ltr">
                        {p.emergencyContact.phone}
                      </span>
                    </a>
                  )}

                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">
                      الأجهزة المرتبطة {bound.length > 0 ? `(${bound.length})` : ''}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {devices.map((d) => {
                        const isBound = d.boundPersonId === p.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => void bindDevice(p, d.id)}
                            className={
                              isBound
                                ? 'rounded-lg border border-primary bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground'
                                : 'rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-accent'
                            }
                          >
                            {d.label}
                            {d.boundPersonId && !isBound ? ' (مرتبط بغيره)' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إضافة شخص</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pName">الاسم *</Label>
              <Input id="pName" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>المنطقة الزمنية</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pDob">تاريخ الميلاد</Label>
                <Input id="pDob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pBlood">فصيلة الدم</Label>
                <Input id="pBlood" value={bloodType} onChange={(e) => setBloodType(e.target.value)} placeholder="O+" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button disabled={!name.trim()} onClick={() => void save()}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Stable id helper kept local to avoid an unused-import warning elsewhere. */
export const peopleNewId = newId;

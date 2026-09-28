import { useMemo, useState } from 'react';
import { Phone, Plus, Share2, Siren } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { AlertBanner } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input, Label } from '@/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import type { EmergencyContact } from '@/core/db/schema';

/**
 * Emergency card — big, printable, shareable, NOT public by default (§10 #9).
 * Everything is rendered from local data; nothing is uploaded.
 */
export function Emergency() {
  const person = useApp((s) => s.activePerson());
  const medications = useApp((s) => s.medications);
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<EmergencyContact>({ name: '', phone: '', relation: '' });

  const activeMeds = useMemo(
    () => medications.filter((m) => m.status === 'active'),
    [medications],
  );

  const { data: persons = [] } = useQuery({
    queryKey: ['persons'],
    queryFn: () => repo.listPersons(),
  });
  void persons;

  const saveContact = async () => {
    if (!person) return;
    const now = new Date().toISOString();
    await repo.putPerson({
      ...person,
      emergencyContact: contact,
      updatedAt: now,
      updatedBy: device?.id ?? 'system',
      rev: person.rev + 1,
    });
    void queryClient.invalidateQueries({ queryKey: ['persons'] });
    const store = useApp.getState();
    const refreshed = await repo.listPersons();
    useApp.setState({ persons: refreshed, activePersonId: store.activePersonId });
    setOpen(false);
  };

  const share = async () => {
    if (!person) return;
    const text = buildEmergencyText(person, activeMeds);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'بطاقة طوارئ', text });
        return;
      } catch {
        // user cancelled — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      alert('تم نسخ بطاقة الطوارئ إلى الحافظة');
    } catch {
      alert(text);
    }
  };

  if (!person) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="بطاقة الطوارئ"
        subtitle="تُعرض للطبيب أو المسعف عند الحاجة"
        action={
          <Button variant="outline" onClick={() => void share()}>
            <Share2 className="h-4 w-4" />
            مشاركة
          </Button>
        }
      />

      <AlertBanner tone="warning" title="خصوصية" icon={<Siren className="h-5 w-5" />}>
        <p>
          هذه البطاقة تحتوي على بيانات طبية حساسة. لا تُشارَك تلقائياً ولا تُنشر علناً — تُرسل فقط لمن تختاره
          بنفسك.
        </p>
      </AlertBanner>

      <Card className="border-2 border-destructive/40">
        <CardContent className="space-y-4 pt-5">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-destructive">بطاقة طوارئ طبية</p>
            <p className="mt-1 text-2xl font-extrabold">{person.nameAr}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="فصيلة الدم" value={person.bloodType ?? '—'} highlight />
            <Field label="تاريخ الميلاد" value={person.dob ?? '—'} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground">الحساسية</p>
            <p className="mt-1 text-base font-semibold text-destructive">
              {person.allergies.length > 0 ? person.allergies.join('، ') : 'لا توجد حساسية مسجلة'}
            </p>
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground">الأدوية الحالية ({activeMeds.length})</p>
            <ul className="mt-1 space-y-1">
              {activeMeds.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{m.nameAr}</span>
                  <span className="numeric text-muted-foreground">
                    {m.strength.value} {m.strength.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {person.notes && (
            <div>
              <p className="text-xs font-bold text-muted-foreground">ملاحظات مهمة</p>
              <p className="mt-1 text-sm">{person.notes}</p>
            </div>
          )}

          <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-bold text-primary">جهة الاتصال في الطوارئ</p>
            {person.emergencyContact ? (
              <>
                <p className="mt-1 text-lg font-extrabold">{person.emergencyContact.name}</p>
                <p className="text-sm text-muted-foreground">{person.emergencyContact.relation}</p>
                <a
                  href={`tel:${person.emergencyContact.phone}`}
                  className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-base font-bold text-primary-foreground"
                >
                  <Phone className="h-5 w-5" />
                  <span className="numeric" dir="ltr">
                    {person.emergencyContact.phone}
                  </span>
                </a>
              </>
            ) : (
              <Button variant="outline" className="mt-2 w-full" onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" />
                إضافة جهة اتصال
              </Button>
            )}
          </div>

          <p className="text-center text-[0.65rem] text-muted-foreground">
            ليست وصفة طبية ولا توصية علاجية — للمرجعية الطارئة فقط.
          </p>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => window.print()}>
        طباعة البطاقة
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>جهة الاتصال في الطوارئ</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="cName">الاسم</Label>
              <Input
                id="cName"
                value={contact.name}
                onChange={(e) => setContact({ ...contact, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cRelation">صلة القرابة</Label>
              <Input
                id="cRelation"
                value={contact.relation}
                onChange={(e) => setContact({ ...contact, relation: e.target.value })}
                placeholder="مثال: الابن"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cPhone">رقم الهاتف</Label>
              <Input
                id="cPhone"
                type="tel"
                dir="ltr"
                value={contact.phone}
                onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                placeholder="+201000000000"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button disabled={!contact.name.trim() || !contact.phone.trim()} onClick={() => void saveContact()}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={highlight ? 'numeric text-xl font-extrabold text-destructive' : 'numeric text-base font-bold'}>
        {value}
      </p>
    </div>
  );
}

function buildEmergencyText(
  person: { nameAr: string; bloodType?: string; dob?: string; allergies: string[]; notes?: string; emergencyContact?: EmergencyContact },
  meds: { nameAr: string; strength: { value: number; unit: string } }[],
): string {
  const lines = [
    'بطاقة طوارئ طبية',
    `الاسم: ${person.nameAr}`,
    `فصيلة الدم: ${person.bloodType ?? 'غير محددة'}`,
    `تاريخ الميلاد: ${person.dob ?? 'غير محدد'}`,
    `الحساسية: ${person.allergies.length > 0 ? person.allergies.join('، ') : 'لا يوجد'}`,
    'الأدوية الحالية:',
    ...meds.map((m) => `- ${m.nameAr} ${m.strength.value} ${m.strength.unit}`),
  ];
  if (person.notes) lines.push(`ملاحظات: ${person.notes}`);
  if (person.emergencyContact) {
    lines.push(
      `جهة الاتصال: ${person.emergencyContact.name} (${person.emergencyContact.relation}) — ${person.emergencyContact.phone}`,
    );
  }
  lines.push('', 'ليست وصفة طبية ولا توصية علاجية.');
  return lines.join('\n');
}

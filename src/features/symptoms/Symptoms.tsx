import { useMemo, useState } from 'react';
import { Activity, Plus, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { Badge, EmptyState } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Label, Textarea } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import type { Symptom } from '@/core/db/schema';
import { newId } from '@/core/db/schema';
import { formatLocalDateTime } from '@/core/time';

const SEVERITY_LABELS: Record<number, string> = {
  1: 'بسيط جداً',
  2: 'بسيط',
  3: 'متوسط',
  4: 'شديد',
  5: 'شديد جداً',
};

export function Symptoms() {
  const person = useApp((s) => s.activePerson());
  const medications = useApp((s) => s.medications);
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState('3');
  const [note, setNote] = useState('');
  const [relatedMedId, setRelatedMedId] = useState('none');

  const { data: symptoms = [] } = useQuery({
    queryKey: ['symptoms', person?.id],
    queryFn: () => (person ? repo.listSymptoms(person.id) : Promise.resolve([])),
    enabled: !!person,
  });

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const save = async () => {
    if (!person) return;
    const now = new Date().toISOString();
    const symptom: Symptom = {
      id: newId('sym'),
      personId: person.id,
      atUtc: now,
      severity: Number(severity) as Symptom['severity'],
      note: note.trim(),
      ...(relatedMedId !== 'none' ? { relatedMedId } : {}),
      updatedAt: now,
      updatedBy: device?.id ?? 'system',
      rev: 1,
      deleted: false,
    };
    await repo.putSymptom(symptom);
    void queryClient.invalidateQueries({ queryKey: ['symptoms', person.id] });
    setOpen(false);
    setNote('');
    setSeverity('3');
    setRelatedMedId('none');
  };

  const remove = async (id: string) => {
    const s = symptoms.find((x) => x.id === id);
    if (!s) return;
    await repo.putSymptom({ ...s, deleted: true, rev: s.rev + 1, updatedAt: new Date().toISOString() });
    void queryClient.invalidateQueries({ queryKey: ['symptoms', person?.id] });
  };

  if (!person) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="الأعراض"
        subtitle="سجّل ما تشعر به الوالدة لمتابعته مع الطبيب"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            تسجيل
          </Button>
        }
      />

      {symptoms.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="لا توجد أعراض مسجلة"
          description="سجّل أي عرض لاحظته — يساعد الطبيب على تقييم الحالة."
          action={<Button onClick={() => setOpen(true)}>تسجيل عرض</Button>}
        />
      ) : (
        <div className="space-y-2">
          {symptoms.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex items-start gap-3 pt-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={s.severity >= 4 ? 'danger' : s.severity === 3 ? 'warning' : 'success'}>
                      {SEVERITY_LABELS[s.severity]}
                    </Badge>
                    {s.relatedMedId && medById.get(s.relatedMedId) && (
                      <span className="text-xs text-muted-foreground">
                        مرتبط بـ {medById.get(s.relatedMedId)!.nameAr}
                      </span>
                    )}
                  </div>
                  {s.note && <p className="mt-2 text-sm">{s.note}</p>}
                  <p className="numeric mt-1 text-xs text-muted-foreground">
                    {formatLocalDateTime(s.atUtc, person.timezone)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label="حذف" onClick={() => void remove(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تسجيل عرض</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>شدة العرض</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {v} — {SEVERITY_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>دواء مرتبط (اختياري)</Label>
              <Select value={relatedMedId} onValueChange={setRelatedMedId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون</SelectItem>
                  {medications.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="symNote">الوصف</Label>
              <Textarea
                id="symNote"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="مثال: دوار بعد جرعة الصباح"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button disabled={!note.trim()} onClick={() => void save()}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

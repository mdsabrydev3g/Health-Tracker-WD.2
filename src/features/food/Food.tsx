import { useMemo, useState } from 'react';
import { Plus, Trash2, Utensils } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { EmptyState } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input, Label } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import type { FoodLog } from '@/core/db/schema';
import { newId } from '@/core/db/schema';
import { formatLocalDateTime } from '@/core/time';

export function Food() {
  const person = useApp((s) => s.activePerson());
  const medications = useApp((s) => s.medications);
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [relatedMedId, setRelatedMedId] = useState('none');

  const { data: logs = [] } = useQuery({
    queryKey: ['foodLogs', person?.id],
    queryFn: () => (person ? repo.listFoodLogs(person.id) : Promise.resolve([])),
    enabled: !!person,
  });

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  // Medications with a food rule are the ones worth pairing a log with.
  const foodSensitive = medications.filter(
    (m) => m.foodRule.mode !== 'with' && m.status === 'active',
  );

  const save = async () => {
    if (!person) return;
    const now = new Date().toISOString();
    const log: FoodLog = {
      id: newId('food'),
      personId: person.id,
      atUtc: now,
      text: text.trim(),
      ...(relatedMedId !== 'none' ? { relatedMedId } : {}),
      updatedAt: now,
      updatedBy: device?.id ?? 'system',
      rev: 1,
      deleted: false,
    };
    await repo.putFoodLog(log);
    void queryClient.invalidateQueries({ queryKey: ['foodLogs', person.id] });
    setOpen(false);
    setText('');
    setRelatedMedId('none');
  };

  const remove = async (id: string) => {
    const l = logs.find((x) => x.id === id);
    if (!l) return;
    await repo.putFoodLog({ ...l, deleted: true, rev: l.rev + 1, updatedAt: new Date().toISOString() });
    void queryClient.invalidateQueries({ queryKey: ['foodLogs', person?.id] });
  };

  if (!person) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="سجل الطعام"
        subtitle="اربط الطعام بتعليمات الدواء"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            تسجيل
          </Button>
        }
      />

      {foodSensitive.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-1 pt-5">
            <p className="text-sm font-bold text-primary">أدوية لديها تعليمات طعام</p>
            {foodSensitive.map((m) => (
              <p key={m.id} className="text-sm">
                {m.nameAr} — {m.foodRule.text ?? m.foodRule.mode}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {logs.length === 0 ? (
        <EmptyState
          icon={<Utensils className="h-10 w-10" />}
          title="لا توجد سجلات طعام"
          description="سجّل الوجبات لمعرفة إن كان هناك تفاعل مع أدوية معينة."
          action={<Button onClick={() => setOpen(true)}>تسجيل وجبة</Button>}
        />
      ) : (
        <div className="space-y-2">
          {logs.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-start gap-3 pt-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{l.text}</p>
                  {l.relatedMedId && medById.get(l.relatedMedId) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      مرتبط بـ {medById.get(l.relatedMedId)!.nameAr}
                    </p>
                  )}
                  <p className="numeric mt-1 text-xs text-muted-foreground">
                    {formatLocalDateTime(l.atUtc, person.timezone)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label="حذف" onClick={() => void remove(l.id)}>
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
            <DialogTitle>تسجيل طعام</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="foodText">ما تناولته</Label>
              <Input
                id="foodText"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="مثال: فول وبيض"
              />
            </div>
            <div className="space-y-2">
              <Label>دواء مرتبط</Label>
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button disabled={!text.trim()} onClick={() => void save()}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

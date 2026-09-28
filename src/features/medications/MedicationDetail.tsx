import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Ban,
  Edit3,
  Package,
  Plus,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { Badge, EmptyState, ProgressRing, AlertBanner } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input, Label, Textarea } from '@/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { projectStock } from '@/core/engine/inventory.engine';
import { buildCostReport, formatMoney } from '@/core/engine/cost.engine';
import { formatLocalTime, todayIn } from '@/core/time';
import { FOOD_RULE_LABELS, FORM_LABELS, SCHEDULE_KIND_LABELS, STATUS_AR } from '@/i18n/ar';
import { MedicationWizard } from './MedicationWizard';
import { ScheduleEditor } from './ScheduleEditor';

export function MedicationDetail() {
  const { medId } = useParams<{ medId: string }>();
  const navigate = useNavigate();

  const person = useApp((s) => s.activePerson());
  const medications = useApp((s) => s.medications);
  const schedules = useApp((s) => s.schedules);
  const inventoryByMed = useApp((s) => s.inventoryByMed);
  const doseEvents = useApp((s) => s.doseEvents);
  const settings = useApp((s) => s.settings);
  const adjustInventory = useApp((s) => s.adjustInventory);
  const archiveMedication = useApp((s) => s.archiveMedication);
  const logPrnDose = useApp((s) => s.logPrnDose);

  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [refillOpen, setRefillOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const [refillQty, setRefillQty] = useState('30');
  const [refillPrice, setRefillPrice] = useState('');
  const [correctQty, setCorrectQty] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [archiveReason, setArchiveReason] = useState('');

  const med = medications.find((m) => m.id === medId);
  const personTz = person?.timezone ?? 'Africa/Cairo';
  const today = person ? todayIn(personTz) : todayIn('Africa/Cairo');

  const medSchedules = useMemo(() => schedules.filter((s) => s.medId === medId), [schedules, medId]);
  const events = useMemo(() => (medId ? inventoryByMed[medId] ?? [] : []), [medId, inventoryByMed]);

  const proj = useMemo(
    () =>
      med
        ? projectStock({
            medication: med,
            schedules: medSchedules,
            events,
            today,
            lowStockThresholdDays: settings.lowStockThresholdDays,
          })
        : null,
    [med, medSchedules, events, today, settings.lowStockThresholdDays],
  );

  const costInfo = useMemo(() => {
    if (!person || !med) return null;
    const report = buildCostReport({ person, medications: medications.filter((m) => m.id === med.id), schedules: medSchedules, today });
    return report.perMed[0] ?? null;
  }, [person, med, medications, medSchedules, today]);

  const recentEvents = useMemo(
    () => events.slice(-25).reverse(),
    [events],
  );

  const recentDoses = useMemo(
    () =>
      doseEvents
        .filter((d) => d.medId === medId && d.localDay <= today)
        .sort((a, b) => b.scheduledAtUtc.localeCompare(a.scheduledAtUtc))
        .slice(0, 20),
    [doseEvents, medId, today],
  );

  const isPrn = medSchedules.some((s) => s.kind === 'prn' && s.activeTo === null);

  if (!med || !person || !proj) {
    return (
      <EmptyState
        title="الدواء غير موجود"
        action={
          <Button onClick={() => navigate('/medications')}>رجوع إلى الأدوية</Button>
        }
      />
    );
  }

  const fraction =
    proj.dailyConsumption > 0
      ? Math.min(1, (proj.remainingDays === Infinity ? 1 : proj.remainingDays) / 30)
      : 1;
  const tone = proj.isLow ? 'danger' : proj.expiresBeforeDepletion ? 'warning' : 'success';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="رجوع" onClick={() => navigate(-1)}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold">{med.nameAr}</h1>
          <p className="numeric text-xs text-muted-foreground">
            {med.strength.value} {med.strength.unit} · {FORM_LABELS[med.form]} ·{' '}
            {STATUS_AR[med.status]}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Edit3 className="h-4 w-4" />
          تعديل
        </Button>
      </div>

      {(proj.isLow || proj.expiresBeforeDepletion) && (
        <AlertBanner
          tone={proj.isLow ? 'danger' : 'warning'}
          title={proj.isLow ? 'المخزون منخفض' : 'تنبيه صلاحية'}
          icon={<TriangleAlert className="h-5 w-5" />}
          action={
            <Button size="sm" variant="outline" onClick={() => setRefillOpen(true)}>
              إعادة تعبئة
            </Button>
          }
        >
          {proj.expiresBeforeDepletion && <p>العلبة ستنتهي صلاحيتها قبل أن ينتهي الدواء.</p>}
          {proj.isLow && (
            <p>
              يكفي{' '}
              <span className="numeric font-bold">
                {proj.remainingDays === Infinity ? '—' : Math.floor(proj.remainingDays)}
              </span>{' '}
              يوم فقط.
            </p>
          )}
        </AlertBanner>
      )}

      {/* Stock summary */}
      <Card>
        <CardContent className="flex items-center gap-5 pt-5">
          <ProgressRing
            value={fraction}
            size={96}
            tone={tone}
            label={proj.remainingDays === Infinity ? '—' : String(Math.floor(proj.remainingDays))}
            sublabel="يوم"
          />
          <div className="grid flex-1 grid-cols-2 gap-3 text-sm">
            <Stat label="الرصيد" value={String(proj.balance)} />
            <Stat label="المستهلك يومياً" value={String(proj.dailyConsumption)} />
            <Stat label="تاريخ النفاد" value={proj.depletionDate ?? '—'} />
            <Stat label="الصلاحية" value={med.packExpiry ?? '—'} />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="outline" onClick={() => setRefillOpen(true)}>
          <Package className="h-4 w-4" />
          إعادة تعبئة
        </Button>
        <Button variant="outline" onClick={() => setScheduleOpen(true)}>
          <Plus className="h-4 w-4" />
          تعديل الجدول
        </Button>
        <Button
          variant="outline"
          disabled={!isPrn}
          onClick={() => void logPrnDose(med.id, 1, 'caregiver')}
          title={isPrn ? 'تسجيل جرعة عند الحاجة' : 'هذا الدواء ليس عند الحاجة'}
        >
          <Undo2 className="h-4 w-4" />
          جرعة الآن
        </Button>
        <Button variant="outline" onClick={() => setArchiveOpen(true)}>
          <Ban className="h-4 w-4" />
          إيقاف الدواء
        </Button>
      </div>

      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">الجدول</TabsTrigger>
          <TabsTrigger value="doses">سجل الجرعات</TabsTrigger>
          <TabsTrigger value="stock">حركة المخزون</TabsTrigger>
          <TabsTrigger value="info">تفاصيل</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-2">
          {medSchedules.length === 0 ? (
            <EmptyState title="لا يوجد جدول" description="أضف جدولاً ليبدأ التطبيق بتوليد الجرعات." />
          ) : (
            medSchedules.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex items-center justify-between gap-3 pt-5">
                  <div>
                    <p className="font-bold">{SCHEDULE_KIND_LABELS[s.kind] ?? s.kind}</p>
                    <p className="numeric mt-1 text-xs text-muted-foreground">
                      {s.kind === 'prn'
                        ? `عند الحاجة · أقصى ${s.prnMaxPerDay ?? '—'} يومياً`
                        : s.times.join(' · ')}
                      {' · '}
                      الكمية: {s.quantityPerDose}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.activeFrom} ← {s.activeTo ?? 'الآن'}
                    </p>
                  </div>
                  <Badge tone={s.activeTo === null ? 'success' : 'muted'}>
                    {s.activeTo === null ? 'ساري' : 'منتهي'}
                  </Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="doses" className="space-y-1.5">
          {recentDoses.length === 0 ? (
            <EmptyState title="لا توجد جرعات مسجلة بعد" />
          ) : (
            recentDoses.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5 text-sm"
              >
                <div>
                  <p className="numeric font-semibold">
                    {d.localDay} · {formatLocalTime(d.scheduledAtUtc, personTz)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.source === 'mother' ? 'سجّلتها الوالدة' : d.source === 'caregiver' ? 'سجّلها مقدم الرعاية' : 'لم تُسجَّل'}
                  </p>
                </div>
                <Badge
                  tone={
                    d.status === 'taken'
                      ? 'success'
                      : d.status === 'missed'
                        ? 'danger'
                        : d.status === 'skipped'
                          ? 'muted'
                          : 'info'
                  }
                >
                  {d.status === 'taken'
                    ? 'تم أخذها'
                    : d.status === 'missed'
                      ? 'فائتة'
                      : d.status === 'skipped'
                        ? 'متخطاة'
                        : 'قادمة'}
                </Badge>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="stock" className="space-y-1.5">
          <Button variant="outline" className="w-full" onClick={() => setCorrectOpen(true)}>
            تصحيح الرصيد (يتطلب سبباً)
          </Button>
          {recentEvents.length === 0 ? (
            <EmptyState title="لا توجد حركات مخزون" />
          ) : (
            recentEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5 text-sm"
              >
                <div>
                  <p className="font-semibold">{INVENTORY_TYPE_AR[e.type] ?? e.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.atUtc.slice(0, 16).replace('T', ' ')}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </p>
                </div>
                <div className="text-left">
                  <p
                    className={
                      e.qty >= 0
                        ? 'numeric font-bold text-[hsl(var(--success))]'
                        : 'numeric font-bold text-destructive'
                    }
                  >
                    {e.qty > 0 ? '+' : ''}
                    {e.qty}
                  </p>
                  <p className="numeric text-xs text-muted-foreground">الرصيد: {e.newBalance}</p>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="info" className="space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-5 text-sm">
              <Row label="الاسم بالإنجليزية" value={med.nameEn ?? '—'} />
              <Row label="المواد الفعالة" value={med.activeIngredients.join('، ') || '—'} />
              <Row label="تعليمات الطعام" value={FOOD_RULE_LABELS[med.foodRule.mode] ?? '—'} />
              {med.foodRule.text && <Row label="ملاحظة الطعام" value={med.foodRule.text} />}
              <Row label="الطبيب" value={med.doctor ?? '—'} />
              <Row label="الحالة" value={med.condition ?? '—'} />
              <Row label="تاريخ البداية" value={med.startDate} />
              <Row
                label="العبوة"
                value={`${med.package.pillCount} وحدة${
                  med.package.kind === 'strips'
                    ? ` (${med.package.strips ?? 0} × ${med.package.pillsPerStrip ?? 0})`
                    : ''
                }`}
              />
              <Row label="سعر العبوة" value={formatMoney(med.cost.packagePrice, med.cost.currency)} />
              {costInfo && (
                <>
                  <Row label="تكلفة الوحدة" value={formatMoney(costInfo.costPerUnit, costInfo.currency)} />
                  <Row label="تكلفة شهرية" value={formatMoney(costInfo.costPerMonth, costInfo.currency)} />
                  <Row label="تكلفة سنوية" value={formatMoney(costInfo.costPerYear, costInfo.currency)} />
                </>
              )}
              <Row label="بوصفة طبية" value={med.rx.isPrescription ? 'نعم' : 'لا'} />
              <Row label="خاضع للرقابة" value={med.rx.isControlled ? 'نعم' : 'لا'} />
              {med.notes && <Row label="ملاحظات" value={med.notes} />}
              {med.discontinuedReason && <Row label="سبب الإيقاف" value={med.discontinuedReason} />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Link to="/inventory" className="block text-center text-sm font-semibold text-primary">
        عرض المخزون الكامل
      </Link>

      {/* Refill dialog */}
      <Dialog open={refillOpen} onOpenChange={setRefillOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إعادة تعبئة المخزون</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="refillQty">الكمية المضافة</Label>
              <Input
                id="refillQty"
                type="number"
                inputMode="decimal"
                value={refillQty}
                onChange={(e) => setRefillQty(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refillPrice">سعر العبوة (اختياري)</Label>
              <Input
                id="refillPrice"
                type="number"
                inputMode="decimal"
                value={refillPrice}
                onChange={(e) => setRefillPrice(e.target.value)}
                placeholder="لحساب التكلفة بدقة"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefillOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                void adjustInventory({
                  medId: med.id,
                  qty: Number(refillQty) || 0,
                  type: 'purchase',
                  reason: 'إعادة تعبئة',
                });
                setRefillOpen(false);
              }}
            >
              إضافة للمخزون
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Correction dialog — reason is mandatory (§7) */}
      <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تصحيح الرصيد</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            استخدم هذا عند وجود فرق بين الرصيد المسجّل والرصيد الفعلي. السبب إلزامي ويُسجّل في سجل التغييرات.
          </p>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="corrQty">الرصيد الفعلي الصحيح</Label>
              <Input
                id="corrQty"
                type="number"
                inputMode="decimal"
                value={correctQty}
                onChange={(e) => setCorrectQty(e.target.value)}
                placeholder={String(proj.balance)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corrReason">السبب *</Label>
              <Textarea
                id="corrReason"
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
                placeholder="مثال: عددت العلبة ووجدت كمية مختلفة"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCorrectOpen(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!correctReason.trim() || correctQty === ''}
              onClick={() => {
                const target = Number(correctQty) || 0;
                const delta = target - proj.balance;
                void adjustInventory({
                  medId: med.id,
                  qty: delta,
                  type: 'correction',
                  reason: correctReason.trim(),
                });
                setCorrectOpen(false);
                setCorrectQty('');
                setCorrectReason('');
              }}
            >
              تصحيح
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive dialog */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إيقاف الدواء</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            سيتوقف التطبيق عن توليد جرعات جديدة، وتبقى كل الجرعات السابقة في السجل.
          </p>
          <div className="space-y-2">
            <Label htmlFor="archiveReason">سبب الإيقاف *</Label>
            <Textarea
              id="archiveReason"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="مثال: قرر الطبيب إيقافه"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              disabled={!archiveReason.trim()}
              onClick={() => {
                void archiveMedication(med.id, archiveReason.trim());
                setArchiveOpen(false);
              }}
            >
              إيقاف الدواء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MedicationWizard personId={person.id} open={editOpen} onOpenChange={setEditOpen} initial={med} />
      <ScheduleEditor
        medId={med.id}
        personId={person.id}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        existing={medSchedules.find((s) => s.activeTo === null)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric font-bold">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-left font-semibold">{value}</span>
    </div>
  );
}

const INVENTORY_TYPE_AR: Record<string, string> = {
  initial: 'رصيد افتتاحي',
  doseTaken: 'جرعة تم أخذها',
  manualAdd: 'إضافة يدوية',
  manualRemove: 'خصم يدوي',
  purchase: 'إعادة تعبئة',
  correction: 'تصحيح',
  discontinued: 'إيقاف',
};

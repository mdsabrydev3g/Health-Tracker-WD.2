import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, Package, Pill, Plus, ScanLine, Search, Trash2, Utensils } from 'lucide-react';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { Badge, EmptyState, ProgressRing } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
  projectStock,
  dailyConsumption,
  dosesRemaining,
  unitLabelAr,
} from '@/core/engine/inventory.engine';
import { todayIn } from '@/lib/utils';
import { FOOD_RULE_LABELS, FORM_LABELS, STATUS_AR } from '@/i18n/ar';
import { MedicationWizard } from './MedicationWizard';
import { ScanDialog } from './ScanDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';

export function Medications() {
  const person = useApp((s) => s.activePerson());
  const medications = useApp((s) => s.medications);
  const schedules = useApp((s) => s.schedules);
  const inventoryByMed = useApp((s) => s.inventoryByMed);
  const settings = useApp((s) => s.settings);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMedication = useApp((s) => s.deleteMedication);

  const today = person ? todayIn(person.timezone) : todayIn('Africa/Cairo');

  const enriched = useMemo(() => {
    return medications.map((med) => {
      const events = inventoryByMed[med.id] ?? [];
      const proj = projectStock({
        medication: med,
        schedules,
        events,
        today,
        lowStockThresholdDays: settings.lowStockThresholdDays,
      });
      const rate = dailyConsumption(med.id, schedules, today);
      const qpd = schedules.find((s) => s.medId === med.id && s.activeTo === null)?.quantityPerDose ?? 1;
      const doses = dosesRemaining(proj, qpd);
      return { med, proj, rate, doses, unit: unitLabelAr(med.form) };
    });
  }, [medications, schedules, inventoryByMed, today, settings.lowStockThresholdDays]);

  const visible = enriched.filter(({ med }) => {
    if (filter === 'active' && med.status !== 'active') return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      med.nameAr.toLowerCase().includes(q) ||
      (med.nameEn ?? '').toLowerCase().includes(q) ||
      med.activeIngredients.some((i) => i.toLowerCase().includes(q))
    );
  });

  const activeCount = medications.filter((m) => m.status === 'active').length;
  const lowCount = enriched.filter((e) => e.proj.isLow).length;

  if (!person) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="الأدوية"
        subtitle={`${activeCount} دواء نشط · ${lowCount} يحتاج إعادة تعبئة`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setScanOpen(true)}>
              <ScanLine className="h-4 w-4" />
              مسح
            </Button>
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        }
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو المادة الفعالة"
            className="pr-9"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as 'active' | 'all')}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">النشطة</SelectItem>
            <SelectItem value="all">الكل</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Pill className="h-10 w-10" />}
          title="لا توجد أدوية مطابقة"
          description="أضف دواءً جديداً بالضغط على زر الإضافة."
          action={
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4" />
              إضافة دواء
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map(({ med, proj, rate, doses, unit }) => {
            const fraction = rate > 0 ? Math.min(1, (proj.remainingDays === Infinity ? 1 : proj.remainingDays) / 30) : 1;
            const tone = proj.isLow ? 'danger' : proj.expiresBeforeDepletion ? 'warning' : 'success';
            const daysLeft = proj.remainingDays === Number.POSITIVE_INFINITY ? '—' : String(Math.floor(proj.remainingDays));
            return (
              <Link key={med.id} to={`/medications/${med.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center gap-4 pt-5">
                    <ProgressRing
                      value={fraction}
                      size={64}
                      stroke={7}
                      tone={tone}
                      label={daysLeft}
                      sublabel="يوم"
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-base font-bold">{med.nameAr}</p>
                        {med.isImportant && (
                          <Badge tone="danger">هام</Badge>
                        )}
                        <Badge tone={med.status === 'active' ? 'success' : 'muted'}>
                          {STATUS_AR[med.status] ?? med.status}
                        </Badge>
                      </div>
                      <p className="numeric text-xs text-muted-foreground">
                        {med.strength.value} {med.strength.unit} · {FORM_LABELS[med.form] ?? med.form}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Package className="h-3 w-3" />
                          <span className="numeric font-semibold">{proj.balance}</span> {unit}
                        </span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Pill className="h-3 w-3" />
                          <span className="numeric font-semibold">{doses}</span> جرعة
                        </span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <CalendarDays className="h-3 w-3" />
                          <span className="numeric font-semibold">{daysLeft}</span> يوم
                        </span>
                        {med.foodRule.mode !== 'with' && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Utensils className="h-3 w-3" />
                            {FOOD_RULE_LABELS[med.foodRule.mode]}
                          </span>
                        )}
                      </div>
                      {proj.expiresBeforeDepletion && (
                        <p className="text-xs font-semibold text-[hsl(var(--warning))]">
                          العلبة ستنتهي صلاحيتها قبل أن ينتهي الدواء
                        </p>
                      )}
                      {proj.isLow && (
                        <p className="text-xs font-semibold text-destructive">المخزون منخفض</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="حذف الدواء"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteTarget({ id: med.id, name: med.nameAr });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <MedicationWizard
        key={scannedBarcode || 'new'}
        personId={person.id}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        prefillBarcode={scannedBarcode}
      />

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onScan={(code) => {
          setScannedBarcode(code);
          setScanOpen(false);
          setWizardOpen(true);
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الدواء</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            سيتم حذف «{deleteTarget?.name}» وجدوله وأحداث جرعاته مستقبلاً. يبقى سجل الجرعات السابقة والعمليات في
            الأرشيف. لا يمكن التراجع.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void deleteMedication(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Package, PackagePlus, Search, TriangleAlert } from 'lucide-react';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { AlertBanner, Badge, EmptyState, ProgressRing } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input, Label } from '@/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { projectStock } from '@/core/engine/inventory.engine';
import { costPerUnit, formatMoney } from '@/core/engine/cost.engine';
import { todayIn } from '@/lib/utils';
import { formatNumber } from '@/i18n/ar';

type SortKey = 'days' | 'name' | 'balance';

export function Inventory() {
  const person = useApp((s) => s.activePerson());
  const medications = useApp((s) => s.medications);
  const schedules = useApp((s) => s.schedules);
  const inventoryByMed = useApp((s) => s.inventoryByMed);
  const settings = useApp((s) => s.settings);
  const adjustInventory = useApp((s) => s.adjustInventory);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('days');
  const [refillMed, setRefillMed] = useState<string | null>(null);
  const [refillQty, setRefillQty] = useState('30');

  const today = person ? todayIn(person.timezone) : todayIn('Africa/Cairo');

  const rows = useMemo(() => {
    const list = medications.map((med) => ({
      med,
      proj: projectStock({
        medication: med,
        schedules,
        events: inventoryByMed[med.id] ?? [],
        today,
        lowStockThresholdDays: settings.lowStockThresholdDays,
      }),
    }));
    return list;
  }, [medications, schedules, inventoryByMed, today, settings.lowStockThresholdDays]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(({ med }) => !q || med.nameAr.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.med.nameAr.localeCompare(b.med.nameAr, 'ar');
      if (sort === 'balance') return b.proj.balance - a.proj.balance;
      const av = a.proj.remainingDays === Infinity ? 1e9 : a.proj.remainingDays;
      const bv = b.proj.remainingDays === Infinity ? 1e9 : b.proj.remainingDays;
      return av - bv;
    });
  }, [rows, query, sort]);

  const lowList = filtered.filter((r) => r.proj.isLow);
  const expiryRisk = filtered.filter((r) => r.proj.expiresBeforeDepletion || (r.proj.daysUntilExpiry !== null && r.proj.daysUntilExpiry <= 30));

  const totalValue = filtered.reduce(
    (sum, { med, proj }) => sum + costPerUnit(med) * proj.balance,
    0,
  );

  if (!person) return null;

  const target = refillMed ? filtered.find((r) => r.med.id === refillMed) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="المخزون"
        subtitle={`${filtered.length} دواء · قيمة المخزون ${formatMoney(totalValue, filtered[0]?.med.cost.currency ?? 'EGP')}`}
      />

      {(lowList.length > 0 || expiryRisk.length > 0) && (
        <div className="space-y-2">
          {lowList.length > 0 && (
            <AlertBanner tone="danger" title={`يحتاج إعادة تعبئة (${lowList.length})`} icon={<AlertTriangle className="h-5 w-5" />}>
              <p>{lowList.map((r) => r.med.nameAr).join('، ')}</p>
            </AlertBanner>
          )}
          {expiryRisk.length > 0 && (
            <AlertBanner tone="warning" title={`صلاحية قريبة الانتهاء (${expiryRisk.length})`} icon={<TriangleAlert className="h-5 w-5" />}>
              <p>{expiryRisk.map((r) => r.med.nameAr).join('، ')}</p>
            </AlertBanner>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن دواء"
            className="pr-9"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="days">الأقرب نفاداً</SelectItem>
            <SelectItem value="name">الاسم</SelectItem>
            <SelectItem value="balance">الرصيد</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Package className="h-10 w-10" />} title="لا توجد أدوية" />
      ) : (
        <div className="space-y-2">
          {filtered.map(({ med, proj }) => {
            const fraction =
              proj.dailyConsumption > 0
                ? Math.min(1, (proj.remainingDays === Infinity ? 1 : proj.remainingDays) / 30)
                : 1;
            const tone = proj.isLow ? 'danger' : proj.expiresBeforeDepletion ? 'warning' : 'success';
            return (
              <Card key={med.id}>
                <CardContent className="flex items-center gap-4 pt-5">
                  <ProgressRing
                    value={fraction}
                    size={60}
                    stroke={6}
                    tone={tone}
                    label={proj.remainingDays === Infinity ? '—' : String(Math.floor(proj.remainingDays))}
                    sublabel="يوم"
                  />
                  <div className="min-w-0 flex-1">
                    <Link to={`/medications/${med.id}`} className="truncate font-bold hover:underline">
                      {med.nameAr}
                    </Link>
                    <p className="numeric mt-0.5 text-xs text-muted-foreground">
                      الرصيد: {formatNumber(proj.balance, 'western')} · يستهلك{' '}
                      {formatNumber(proj.dailyConsumption, 'western')}/يوم
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {proj.isLow && <Badge tone="danger">منخفض</Badge>}
                      {proj.expiresBeforeDepletion && <Badge tone="warning">صلاحية أقرب من النفاد</Badge>}
                      {proj.daysUntilExpiry !== null && proj.daysUntilExpiry <= 30 && proj.daysUntilExpiry >= 0 && (
                        <Badge tone="warning">تنتهي بعد {formatNumber(proj.daysUntilExpiry, 'western')} يوم</Badge>
                      )}
                      {proj.depletionDate && (
                        <Badge tone="info">ينفد في {proj.depletionDate}</Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRefillMed(med.id);
                      setRefillQty(String(Math.max(30, Math.ceil(proj.dailyConsumption * 30))));
                    }}
                  >
                    <PackagePlus className="h-4 w-4" />
                    تعبئة
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Tabs defaultValue="summary" className="pt-2">
        <TabsList>
          <TabsTrigger value="summary">ملخص</TabsTrigger>
          <TabsTrigger value="value">قيمة المخزون</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          <Card>
            <CardContent className="grid grid-cols-2 gap-3 pt-5 text-sm sm:grid-cols-4">
              <Mini label="عدد الأدوية" value={String(filtered.length)} />
              <Mini label="مخزون منخفض" value={String(lowList.length)} />
              <Mini label="قرب انتهاء الصلاحية" value={String(expiryRisk.length)} />
              <Mini label="قيمة المخزون" value={formatMoney(totalValue, filtered[0]?.med.cost.currency ?? 'EGP')} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="value">
          <Card>
            <CardContent className="space-y-2 pt-5">
              {filtered
                .map(({ med, proj }) => ({ med, value: costPerUnit(med) * proj.balance }))
                .sort((a, b) => b.value - a.value)
                .map(({ med, value }) => (
                  <div key={med.id} className="flex items-center justify-between border-b border-border/60 pb-2 text-sm last:border-0">
                    <span>{med.nameAr}</span>
                    <span className="numeric font-bold">{formatMoney(value, med.cost.currency)}</span>
                  </div>
                ))}
              <div className="flex items-center justify-between pt-2 text-base">
                <span className="font-bold">الإجمالي</span>
                <span className="numeric font-extrabold text-primary">
                  {formatMoney(totalValue, filtered[0]?.med.cost.currency ?? 'EGP')}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Refill dialog */}
      <Dialog open={!!refillMed} onOpenChange={(o) => !o && setRefillMed(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إعادة تعبئة: {target?.med.nameAr}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rfQty">الكمية المضافة</Label>
              <Input
                id="rfQty"
                type="number"
                inputMode="decimal"
                value={refillQty}
                onChange={(e) => setRefillQty(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              الرصيد بعد التعبئة:{' '}
              <span className="numeric font-bold">
                {formatNumber((target?.proj.balance ?? 0) + (Number(refillQty) || 0), 'western')}
              </span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefillMed(null)}>
              إلغاء
            </Button>
            <Button
              disabled={!refillMed || !Number(refillQty)}
              onClick={() => {
                if (!refillMed) return;
                void adjustInventory({
                  medId: refillMed,
                  qty: Number(refillQty) || 0,
                  type: 'purchase',
                  reason: 'إعادة تعبئة من شاشة المخزون',
                });
                setRefillMed(null);
              }}
            >
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric mt-0.5 font-bold">{value}</p>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { useApp } from '@/app/store';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input, Label, Textarea } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Badge, AlertBanner } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Switch } from '@/ui/switch';
import type { DoseForm, FoodRule, Medication, Schedule, TaperStep } from '@/core/db/schema';
import { FORM_OPTIONS, FOOD_RULE_OPTIONS, SCHEDULE_KIND_LABELS, WEEKDAY_LABELS } from '@/i18n/ar';
import { addLocalDays, todayIn } from '@/core/time';
import { formatNumber } from '@/i18n/ar';
import { cn } from '@/lib/utils';

interface Props {
  personId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing medication to edit, if any. */
  initial?: Medication;
}

interface WizardState {
  nameAr: string;
  nameEn: string;
  ingredients: string;
  strengthValue: string;
  strengthUnit: string;
  form: DoseForm;
  kind: Schedule['kind'];
  times: string[];
  quantityPerDose: string;
  intervalN: string;
  weekdays: number[];
  prnMaxPerDay: string;
  taperSteps: TaperStep[];
  foodMode: FoodRule['mode'];
  foodText: string;
  packageKind: 'strips' | 'direct';
  strips: string;
  pillsPerStrip: string;
  pillCount: string;
  unitPrice: string;
  packagePrice: string;
  packExpiry: string;
  initialStock: string;
  doctor: string;
  condition: string;
  isPrescription: boolean;
  isControlled: boolean;
  notes: string;
}

function initialState(med?: Medication): WizardState {
  return {
    nameAr: med?.nameAr ?? '',
    nameEn: med?.nameEn ?? '',
    ingredients: (med?.activeIngredients ?? []).join('، '),
    strengthValue: String(med?.strength.value ?? 1),
    strengthUnit: med?.strength.unit ?? 'mg',
    form: med?.form ?? 'tablet',
    kind: 'daily',
    times: ['08:00'],
    quantityPerDose: '1',
    intervalN: '2',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    prnMaxPerDay: '3',
    taperSteps: [],
    foodMode: med?.foodRule.mode ?? 'with',
    foodText: med?.foodRule.text ?? '',
    packageKind: med?.package.kind ?? 'strips',
    strips: String(med?.package.strips ?? 3),
    pillsPerStrip: String(med?.package.pillsPerStrip ?? 10),
    pillCount: String(med?.package.pillCount ?? 30),
    unitPrice: '',
    packagePrice: String(med?.cost.packagePrice ?? 0),
    packExpiry: med?.packExpiry ?? '',
    initialStock: '0',
    doctor: med?.doctor ?? '',
    condition: med?.condition ?? '',
    isPrescription: med?.rx.isPrescription ?? true,
    isControlled: med?.rx.isControlled ?? false,
    notes: med?.notes ?? '',
  };
}

/**
 * Add / edit wizard with a LIVE calculation preview (§10 #2, §15 phase 3).
 * The preview shows exactly what the engines will compute before saving.
 */
export function MedicationWizard({ personId, open, onOpenChange, initial }: Props) {
  const person = useApp((s) => s.activePerson());
  const saveMedication = useApp((s) => s.saveMedication);
  const saveSchedule = useApp((s) => s.saveSchedule);

  const [state, setState] = useState<WizardState>(() => initialState(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const timezone = person?.timezone ?? 'Africa/Cairo';
  const today = todayIn(timezone);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  /* ---------------- Live preview (§15 phase 3) ---------------- */

  const preview = useMemo(() => {
    const qty = Number(state.quantityPerDose) || 0;
    const times = state.times.filter(Boolean);

    let perDay = 0;
    if (state.kind === 'daily') perDay = times.length * qty;
    else if (state.kind === 'everyNDays') {
      const n = Math.max(1, Number(state.intervalN) || 1);
      perDay = (times.length * qty) / n;
    } else if (state.kind === 'weekdays') perDay = (state.weekdays.length / 7) * times.length * qty;
    else if (state.kind === 'taper') {
      const avg =
        state.taperSteps.length > 0
          ? state.taperSteps.reduce((s, t) => s + t.quantityPerDose, 0) / state.taperSteps.length
          : qty;
      perDay = times.length * avg;
    } else perDay = 0; // PRN

    const pkgSize =
      state.packageKind === 'strips'
        ? (Number(state.strips) || 0) * (Number(state.pillsPerStrip) || 0)
        : Number(state.pillCount) || 0;

    const price = Number(state.packagePrice) || 0;
    const unitCost = pkgSize > 0 ? price / pkgSize : 0;
    const stock = Number(state.initialStock) || 0;
    const daysLeft = perDay > 0 ? stock / perDay : Infinity;
    const depletion = perDay > 0 ? addLocalDays(today, Math.ceil(stock / perDay)) : null;
    const monthly = unitCost * perDay * 30;
    const expiryBeforeDepletion =
      !!state.packExpiry && !!depletion && state.packExpiry > depletion;

    return { perDay, pkgSize, unitCost, stock, daysLeft, depletion, monthly, expiryBeforeDepletion };
  }, [state, today]);

  const valid =
    state.nameAr.trim().length > 0 &&
    Number(state.strengthValue) > 0 &&
    (state.kind === 'prn' || state.times.filter(Boolean).length > 0) &&
    (state.kind !== 'weekdays' || state.weekdays.length > 0) &&
    (state.kind !== 'taper' || state.taperSteps.length > 0);

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const pkgSize =
        state.packageKind === 'strips'
          ? (Number(state.strips) || 0) * (Number(state.pillsPerStrip) || 0)
          : Number(state.pillCount) || 0;

      const med = await saveMedication({
        ...(initial ? { id: initial.id } : {}),
        personId,
        nameAr: state.nameAr.trim(),
        nameEn: state.nameEn.trim() || undefined,
        activeIngredients: state.ingredients
          .split(/[،,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        strength: { value: Number(state.strengthValue) || 1, unit: state.strengthUnit },
        form: state.form,
        package: {
          kind: state.packageKind,
          strips: state.packageKind === 'strips' ? Number(state.strips) || 1 : undefined,
          pillsPerStrip: state.packageKind === 'strips' ? Number(state.pillsPerStrip) || 10 : undefined,
          pillCount: pkgSize,
        },
        foodRule: {
          mode: state.foodMode,
          ...(state.foodText.trim() ? { text: state.foodText.trim() } : {}),
        },
        cost: {
          packagePrice: Number(state.packagePrice) || 0,
          currency: 'EGP',
          purchasedAt: today,
          packageSize: pkgSize,
        },
        ...(state.packExpiry ? { packExpiry: state.packExpiry } : {}),
        doctor: state.doctor.trim() || undefined,
        condition: state.condition.trim() || undefined,
        notes: state.notes.trim() || undefined,
        rx: { isPrescription: state.isPrescription, isControlled: state.isControlled },
        startDate: today,
        status: 'active',
        ...(!initial ? { balanceCache: Number(state.initialStock) || 0 } : {}),
      });

      // Creating a medication always creates its first schedule (§15 phase 3).
      if (!initial) {
        await saveSchedule({
          medId: med.id,
          personId,
          kind: state.kind,
          times: state.kind === 'prn' ? [] : state.times.filter(Boolean),
          quantityPerDose: Number(state.quantityPerDose) || 1,
          dosesPerDay: state.kind === 'prn' ? 0 : state.times.filter(Boolean).length,
          intervalN: state.kind === 'everyNDays' ? Number(state.intervalN) || 2 : undefined,
          weekdays: state.kind === 'weekdays' ? state.weekdays : undefined,
          prnMaxPerDay: state.kind === 'prn' ? Number(state.prnMaxPerDay) || 3 : undefined,
          taperSteps: state.kind === 'taper' ? state.taperSteps : undefined,
          anchorDate: today,
          activeFrom: today,
          activeTo: null,
        });
      }

      onOpenChange(false);
      if (!initial) setState(initialState());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'تعديل دواء' : 'إضافة دواء جديد'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-muted-foreground">بيانات الدواء</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nameAr">الاسم بالعربية *</Label>
                <Input
                  id="nameAr"
                  value={state.nameAr}
                  onChange={(e) => set('nameAr', e.target.value)}
                  placeholder="مثال: أسبيرين ٨١"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nameEn">الاسم بالإنجليزية</Label>
                <Input
                  id="nameEn"
                  value={state.nameEn}
                  onChange={(e) => set('nameEn', e.target.value)}
                  placeholder="Aspirin 81"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ingredients">المواد الفعالة</Label>
              <Input
                id="ingredients"
                value={state.ingredients}
                onChange={(e) => set('ingredients', e.target.value)}
                placeholder="افصل بينها بفاصلة"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="strength">التركيز *</Label>
                <Input
                  id="strength"
                  type="number"
                  inputMode="decimal"
                  value={state.strengthValue}
                  onChange={(e) => set('strengthValue', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>الوحدة</Label>
                <Select value={state.strengthUnit} onValueChange={(v) => set('strengthUnit', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['mg', 'mcg', 'g', 'ml', 'IU', '%'].map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الشكل</Label>
                <Select value={state.form} onValueChange={(v) => set('form', v as DoseForm)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Schedule — only for new medications */}
          {!initial && (
            <section className="space-y-3">
              <h3 className="text-sm font-bold text-muted-foreground">الجدول</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>نوع الجدول</Label>
                  <Select value={state.kind} onValueChange={(v) => set('kind', v as Schedule['kind'])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SCHEDULE_KIND_LABELS).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="qty">الكمية في الجرعة</Label>
                  <Input
                    id="qty"
                    type="number"
                    inputMode="decimal"
                    value={state.quantityPerDose}
                    onChange={(e) => set('quantityPerDose', e.target.value)}
                  />
                </div>
              </div>

              {state.kind !== 'prn' && (
                <div className="space-y-2">
                  <Label>مواعيد الجرعات</Label>
                  <div className="flex flex-wrap gap-2">
                    {state.times.map((t, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input
                          type="time"
                          value={t}
                          className="w-32"
                          onChange={(e) => {
                            const next = [...state.times];
                            next[i] = e.target.value;
                            set('times', next);
                          }}
                        />
                        {state.times.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="حذف الموعد"
                            onClick={() => set('times', state.times.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => set('times', [...state.times, '20:00'])}
                    >
                      <Plus className="h-4 w-4" />
                      موعد آخر
                    </Button>
                  </div>
                </div>
              )}

              {state.kind === 'everyNDays' && (
                <div className="space-y-2">
                  <Label htmlFor="interval">كل كم يوم؟</Label>
                  <Input
                    id="interval"
                    type="number"
                    value={state.intervalN}
                    onChange={(e) => set('intervalN', e.target.value)}
                  />
                </div>
              )}

              {state.kind === 'weekdays' && (
                <div className="space-y-2">
                  <Label>أيام الأسبوع</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_LABELS.map((label, idx) => {
                      const on = state.weekdays.includes(idx);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            set(
                              'weekdays',
                              on ? state.weekdays.filter((d) => d !== idx) : [...state.weekdays, idx],
                            )
                          }
                          className={cn(
                            'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {state.kind === 'prn' && (
                <div className="space-y-2">
                  <Label htmlFor="prnMax">أقصى عدد جرعات في اليوم</Label>
                  <Input
                    id="prnMax"
                    type="number"
                    value={state.prnMaxPerDay}
                    onChange={(e) => set('prnMaxPerDay', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    جرعات «عند الحاجة» تُسجَّل عند أخذها فقط، ولا تُحسب كجرعة فائتة أبداً.
                  </p>
                </div>
              )}

              {state.kind === 'taper' && (
                <TaperEditor steps={state.taperSteps} onChange={(s) => set('taperSteps', s)} today={today} />
              )}
            </section>
          )}

          {/* Food rule */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-muted-foreground">تعليمات الطعام</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>العلاقة بالطعام</Label>
                <Select value={state.foodMode} onValueChange={(v) => set('foodMode', v as FoodRule['mode'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOOD_RULE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="foodText">ملاحظة إضافية</Label>
                <Input
                  id="foodText"
                  value={state.foodText}
                  onChange={(e) => set('foodText', e.target.value)}
                  placeholder="مثال: بعد الإفطار"
                />
              </div>
            </div>
          </section>

          {/* Package & cost */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-muted-foreground">العبوة والتكلفة</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>نوع العبوة</Label>
                <Select
                  value={state.packageKind}
                  onValueChange={(v) => set('packageKind', v as 'strips' | 'direct')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strips">شرائط داخل علبة</SelectItem>
                    <SelectItem value="direct">عدد مباشر</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {state.packageKind === 'strips' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="strips">عدد الشرائط</Label>
                    <Input
                      id="strips"
                      type="number"
                      value={state.strips}
                      onChange={(e) => set('strips', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="perStrip">أقراص/شريط</Label>
                    <Input
                      id="perStrip"
                      type="number"
                      value={state.pillsPerStrip}
                      onChange={(e) => set('pillsPerStrip', e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="pillCount">عدد الوحدات</Label>
                  <Input
                    id="pillCount"
                    type="number"
                    value={state.pillCount}
                    onChange={(e) => set('pillCount', e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="price">سعر العبوة</Label>
                <Input
                  id="price"
                  type="number"
                  inputMode="decimal"
                  value={state.packagePrice}
                  onChange={(e) => set('packagePrice', e.target.value)}
                />
              </div>
              {!initial && (
                <div className="space-y-2">
                  <Label htmlFor="stock">الرصيد الحالي</Label>
                  <Input
                    id="stock"
                    type="number"
                    inputMode="decimal"
                    value={state.initialStock}
                    onChange={(e) => set('initialStock', e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="expiry">صلاحية العبوة</Label>
                <Input
                  id="expiry"
                  type="date"
                  value={state.packExpiry}
                  onChange={(e) => set('packExpiry', e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Notes & flags */}
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="doctor">الطبيب</Label>
                <Input id="doctor" value={state.doctor} onChange={(e) => set('doctor', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="condition">الحالة</Label>
                <Input
                  id="condition"
                  value={state.condition}
                  onChange={(e) => set('condition', e.target.value)}
                  placeholder="مثال: ضغط الدم"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">ملاحظات</Label>
              <Textarea id="notes" value={state.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <span className="text-sm font-semibold">دواء بوصفة طبية</span>
              <Switch
                checked={state.isPrescription}
                onCheckedChange={(v) => set('isPrescription', v)}
                aria-label="دواء بوصفة"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <span className="text-sm font-semibold">دواء خاضع للرقابة</span>
              <Switch
                checked={state.isControlled}
                onCheckedChange={(v) => set('isControlled', v)}
                aria-label="دواء خاضع للرقابة"
              />
            </div>
          </section>

          {/* Live calculation preview */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-2 pt-5">
              <p className="flex items-center gap-2 text-sm font-bold text-primary">
                <Calculator className="h-4 w-4" />
                حساب مباشر قبل الحفظ
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Preview label="وحدات/يوم" value={formatNumber(preview.perDay, 'western')} />
                <Preview
                  label="يكفي لمدة"
                  value={
                    preview.daysLeft === Infinity
                      ? '—'
                      : `${formatNumber(Math.floor(preview.daysLeft), 'western')} يوم`
                  }
                />
                <Preview label="تاريخ النفاد" value={preview.depletion ?? '—'} />
                <Preview label="تكلفة/شهر" value={formatNumber(preview.monthly, 'western', 0)} />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge tone="info">
                  حجم العبوة: <span className="numeric">{formatNumber(preview.pkgSize, 'western')}</span>
                </Badge>
                <Badge tone="info">
                  تكلفة الوحدة: <span className="numeric">{formatNumber(preview.unitCost, 'western')}</span>
                </Badge>
              </div>
              {preview.expiryBeforeDepletion && (
                <AlertBanner tone="warning" title="تنبيه مبكر">
                  <p>العلبة ستنتهي صلاحيتها قبل أن ينتهي الدواء — فكّر في كمية أصغر.</p>
                </AlertBanner>
              )}
            </CardContent>
          </Card>

          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={!valid || saving} onClick={() => void handleSave()}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ الدواء'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Preview({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric font-bold">{value}</p>
    </div>
  );
}

function TaperEditor({
  steps,
  onChange,
  today,
}: {
  steps: TaperStep[];
  onChange: (steps: TaperStep[]) => void;
  today: string;
}) {
  return (
    <div className="space-y-2">
      <Label>مراحل التقليل التدريجي</Label>
      {steps.map((s, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border p-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">من</span>
            <Input
              type="date"
              value={s.from}
              className="w-36"
              onChange={(e) => {
                const next = [...steps];
                next[i] = { ...s, from: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">إلى</span>
            <Input
              type="date"
              value={s.to}
              className="w-36"
              onChange={(e) => {
                const next = [...steps];
                next[i] = { ...s, to: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">الكمية</span>
            <Input
              type="number"
              value={s.quantityPerDose}
              className="w-24"
              onChange={(e) => {
                const next = [...steps];
                next[i] = { ...s, quantityPerDose: Number(e.target.value) || 0 };
                onChange(next);
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="حذف المرحلة"
            onClick={() => onChange(steps.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const last = steps[steps.length - 1];
          const from = last ? last.to : today;
          onChange([...steps, { from, to: from, quantityPerDose: 0.5 }]);
        }}
      >
        <Plus className="h-4 w-4" />
        إضافة مرحلة
      </Button>
    </div>
  );
}

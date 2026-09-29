import { useMemo, useRef, useState } from 'react';
import { FileText, Loader2, Sparkles, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { AlertBanner, Badge, EmptyState } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Label, Textarea } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import type { LabResult } from '@/core/db/schema';
import { newId } from '@/core/db/schema';
import { AI_DISCLAIMER } from '@/core/notify/scheduler';
import { isAiConfigured, aiFunctionUrl } from '@/core/sync/outbox';
import { extractText, summariseLabText, dataUrlToFile } from '@/core/ai/freeAi';
import { readFileAsDataUrl } from '@/lib/utils';

const LAB_TYPES = [
  'تحليل دم شامل',
  'وظائف الكلى',
  'وظائف الكبد',
  'INR / سيولة الدم',
  'الكوليسترول والدهون',
  'سكر الدم',
  'الغدة الدرقية',
  'إنزيمات القلب',
  'أشعة / رسم قلب',
  'أخرى',
];

export function Labs() {
  const person = useApp((s) => s.activePerson());
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const deleteLab = useApp((s) => s.deleteLab);
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [labType, setLabType] = useState(LAB_TYPES[0]!);
  const [labDate, setLabDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [summarising, setSummarising] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<LabResult | null>(null);
  const [deleteLabId, setDeleteLabId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: labs = [] } = useQuery({
    queryKey: ['labs', person?.id],
    queryFn: () => (person ? repo.listLabResults(person.id) : Promise.resolve([])),
    enabled: !!person,
  });

  const aiReady = isAiConfigured();

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['labs', person?.id] });

  const upload = async () => {
    if (!person || !file) return;
    setError('');
    const now = new Date().toISOString();

    try {
      // The original file is ALWAYS kept, even if AI fails (§11).
      const dataUrl = await readFileAsDataUrl(file);
      const id = newId('lab');
      const storagePath = `local://${id}/${file.name}`;

      // Best-effort local cache of the document so the caregiver can reopen it.
      try {
        localStorage.setItem(
          `ht:doc:${id}`,
          JSON.stringify({ name: file.name, type: file.type, data: dataUrl, at: now }),
        );
      } catch {
        // Storage quota — the record still exists, just without a preview.
      }

      const lab: LabResult = {
        id,
        personId: person.id,
        type: labType,
        date: labDate,
        fileRef: storagePath,
        status: 'pending',
        updatedAt: now,
        updatedBy: device?.id ?? 'system',
        rev: 1,
        deleted: false,
      };
      await repo.putLabResult(lab);

      await repo.appendAuditLog({
        id: newId('aud'),
        actorDeviceId: device?.id ?? 'system',
        atUtc: now,
        entity: 'labResults',
        entityId: id,
        action: 'upload',
        after: { type: labType, date: labDate },
        updatedAt: now,
        updatedBy: device?.id ?? 'system',
        rev: 1,
        deleted: false,
      });

      invalidate();
      setUploadOpen(false);
      setFile(null);
      setNotes('');
      void summarise(lab.id, dataUrl, labType, labDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر رفع الملف');
    }
  };

  /**
   * AI summary — fully FREE and keyless by default (§11).
   *
   * The client OCRs the image locally (Tesseract) or extracts PDF text, then:
   *   - if a Cloud Function is configured, sends the TEXT to it (better model);
   *   - otherwise summarises directly via Pollinations (no key, no cost).
   * The original file is always kept; a failure only flips status to `failed`.
   */
  const getStoredDataUrl = (labId: string): string | null => {
    try {
      const raw = localStorage.getItem(`ht:doc:${labId}`);
      return raw ? (JSON.parse(raw).data as string) : null;
    } catch {
      return null;
    }
  };

  const summarise = async (labId: string, dataUrl: string, type: string, date: string) => {
    setSummarising(labId);
    try {
      const du = dataUrl || getStoredDataUrl(labId);
      if (!du) throw new Error('no file');

      const file = dataUrlToFile(du, `${labId}.bin`);
      const text = await extractText(file);

      const url = aiFunctionUrl('summariseLab');
      let summary: string;
      let model: string;
      if (url) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, labType: type, labDate: date, lang: 'ar' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { summary?: string; text?: string; model?: string };
        summary = json.summary ?? json.text ?? '';
        model = json.model ?? 'cloud';
      } else {
        summary = await summariseLabText(text);
        model = 'pollinations-free';
      }

      const existing = await repo.listLabResults(person?.id ?? '');
      const lab = existing.find((l) => l.id === labId);
      if (!lab) return;

      await repo.putLabResult({
        ...lab,
        status: 'summarised',
        aiSummary: {
          schemaVersion: 1,
          model,
          atUtc: new Date().toISOString(),
          sections: { mainResults: summary },
        },
        updatedAt: new Date().toISOString(),
        rev: lab.rev + 1,
      });
      invalidate();
    } catch {
      const existing = await repo.listLabResults(person?.id ?? '');
      const lab = existing.find((l) => l.id === labId);
      if (lab) {
        await repo.putLabResult({ ...lab, status: 'failed', updatedAt: new Date().toISOString(), rev: lab.rev + 1 });
        invalidate();
      }
    } finally {
      setSummarising(null);
    }
  };

  if (!person) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="الملفات الطبية"
        subtitle={`${labs.length} ملف محفوظ`}
        action={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            رفع ملف
          </Button>
        }
      />

      {!aiReady ? (
        <AlertBanner tone="success" title="الملخص الذكي المجاني مُفعّل" icon={<Sparkles className="h-5 w-5" />}>
          <p>
            يقرأ المساعد صور التحاليل والإشاعات مجاناً وبلا أي مفتاح، ويعرض النتيجة أسفل الملف مباشرة. يلزم اتصال
            بالإنترنت أثناء القراءة. (لرفع الجودة يمكن لاحقاً ربط دالة سحابية.)
          </p>
        </AlertBanner>
      ) : (
        <AlertBanner tone="info" title="الملخص الذكي مُفعّل (سحابة)" icon={<Sparkles className="h-5 w-5" />}>
          <p>يُرسَل النص المستخرج محلياً إلى دالة السحابة المُهيّأة لملخص أدق. الملف الأصلي يُحفظ دائماً.</p>
        </AlertBanner>
      )}

      {labs.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="لا توجد ملفات طبية بعد"
          description="ارفع صورة تحليل أو تقريراً ليُحفظ بأمان ويمكن تلخيصه بالعربية."
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" />
              رفع أول ملف
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {labs.map((lab) => (
            <Card key={lab.id}>
              <CardContent className="flex items-center gap-3 pt-5">
                <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{lab.type}</p>
                  <p className="numeric text-xs text-muted-foreground">{lab.date}</p>
                </div>
                {summarising === lab.id ? (
                  <Badge tone="info">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    جارٍ التلخيص
                  </Badge>
                ) : lab.status === 'summarised' ? (
                  <Badge tone="success">ملخص جاهز</Badge>
                ) : lab.status === 'failed' ? (
                  <Badge tone="danger">فشل التلخيص</Badge>
                ) : (
                  <Badge tone="muted">بدون ملخص</Badge>
                )}
                <Button size="sm" variant="outline" onClick={() => setViewing(lab)}>
                  عرض
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="حذف"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteLabId(lab.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>رفع ملف طبي</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>نوع الفحص</Label>
              <Select value={labType} onValueChange={setLabType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAB_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="labDate">التاريخ</Label>
              <input
                id="labDate"
                type="date"
                value={labDate}
                onChange={(e) => setLabDate(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-input bg-background px-4 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label>الملف (صورة أو PDF)</Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-4 file:py-2.5 file:font-semibold"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labNotes">ملاحظات (اختياري)</Label>
              <Textarea id="labNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
            <AlertBanner tone="warning" title="تنبيه مهم" icon={<TriangleAlert className="h-5 w-5" />}>
              <p>
                الملخص الآلي للمرجعية السريعة فقط ولا يُغني عن مراجعة الطبيب. الملف الأصلي يُحفظ دائماً.
              </p>
            </AlertBanner>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              إلغاء
            </Button>
            <Button disabled={!file} onClick={() => void upload()}>
              رفع وحفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Summary viewer */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.type}</DialogTitle>
          </DialogHeader>
          {viewing?.aiSummary ? (
            <div className="space-y-3 text-sm">
              {Object.entries(viewing.aiSummary.sections).map(([key, value]) => (
                <div key={key}>
                  <p className="font-bold">{SECTION_LABELS[key] ?? key}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                  </p>
                </div>
              ))}
              <p className="numeric text-xs text-muted-foreground">
                {viewing.aiSummary.model} · {viewing.aiSummary.atUtc.slice(0, 16).replace('T', ' ')}
              </p>
              <AlertBanner tone="info" title="تنبيه">
                <p>{AI_DISCLAIMER}</p>
              </AlertBanner>
              <div className="flex justify-end pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setDeleteLabId(viewing?.id ?? null)}
                >
                  <Trash2 className="h-4 w-4" />
                  حذف الملف
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              لا يوجد ملخص لهذا الملف. الملف الأصلي محفوظ كما هو.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteLabId} onOpenChange={(o) => !o && setDeleteLabId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الملف الطبي</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            سيُحذف هذا الملف وملخصه. لا يمكن التراجع.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteLabId(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteLabId) void deleteLab(deleteLabId);
                setDeleteLabId(null);
                setViewing(null);
                invalidate();
              }}
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const SECTION_LABELS: Record<string, string> = {
  type: 'نوع الفحص',
  date: 'التاريخ',
  mainResults: 'النتائج الرئيسية',
  abnormalValues: 'القيم غير الطبيعية',
  normalValues: 'القيم الطبيعية المهمة',
  notes: 'ملاحظات',
  doctorQuestions: 'أسئلة مقترحة للطبيب',
};

export const LAB_TYPES_EXPORT = LAB_TYPES;
export const LAB_HELPERS = { useMemo };

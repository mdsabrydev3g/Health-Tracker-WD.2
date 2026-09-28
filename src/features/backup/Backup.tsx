import { useRef, useState } from 'react';
import { AlertTriangle, CloudUpload, Download, HardDriveDownload, Upload } from 'lucide-react';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { AlertBanner } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { downloadJson, readFileAsText } from '@/lib/utils';
import { buildOutboxItem, isSyncConfigured } from '@/core/sync/outbox';
import type { PersonExport } from '@/core/db/repository';
import { CURRENT_SCHEMA_VERSION } from '@/core/db/repository';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { newId } from '@/core/db/schema';

/**
 * Backup & restore — one button each (§12).
 * The export is a schema-versioned JSON, not a raw table dump.
 */
export function Backup() {
  const person = useApp((s) => s.activePerson());
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreData, setRestoreData] = useState<PersonExport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const backupNow = async () => {
    if (!person) return;
    setStatus(null);
    const dataset = await repo.exportPerson(person.id);
    const payload = {
      ...dataset,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
    };
    downloadJson(`health-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);

    // Queue a cloud upload when sync is configured.
    if (isSyncConfigured() && device) {
      await repo.enqueueOutbox(
        buildOutboxItem({
          entity: 'backup',
          entityId: newId('bkp'),
          op: 'upsert',
          payload: { personId: person.id, exportedAt: payload.exportedAt },
        }),
      );
      setStatus('تم إنشاء النسخة الاحتياطية وإضافتها لقائمة الرفع السحابي.');
    } else {
      setStatus('تم تنزيل النسخة الاحتياطية على هذا الجهاز.');
    }
  };

  const pickRestore = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const parsed = JSON.parse(text) as PersonExport;
      if (!parsed.person || !Array.isArray(parsed.medications)) throw new Error('ملف غير صالح');
      setRestoreData(parsed);
      setRestoreOpen(true);
    } catch {
      setStatus('تعذّر قراءة ملف النسخة الاحتياطية.');
    }
  };

  const confirmRestore = async () => {
    if (!restoreData) return;
    await repo.importPerson(restoreData);
    await useApp.getState().bootstrap();
    setRestoreOpen(false);
    setRestoreData(null);
    setStatus('تمت الاستعادة بنجاح.');
  };

  return (
    <div className="space-y-4">
      <PageHeader title="النسخ الاحتياطي" subtitle="نسخة كاملة قابلة للاستعادة" />

      <AlertBanner tone="info" title="بياناتك تبقى ملكك" icon={<HardDriveDownload className="h-5 w-5" />}>
        <p>
          التصدير ملف واحد بصيغة JSON موثّقة، يحتوي على كل شيء: الأدوية، الجداول، الجرعات، المخزون، الملفات
          الطبية. يمكن استعادته على أي جهاز جديد.
        </p>
      </AlertBanner>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <Download className="h-4 w-4 text-primary" />
            إنشاء نسخة احتياطية
          </p>
          <p className="text-sm text-muted-foreground">
            {person ? `سيتم تصدير بيانات: ${person.nameAr}` : 'لا يوجد شخص محدد'}
          </p>
          <Button className="w-full" disabled={!person} onClick={() => void backupNow()}>
            <Download className="h-4 w-4" />
            نسخ احتياطي الآن
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <Upload className="h-4 w-4 text-primary" />
            استعادة من نسخة
          </p>
          <p className="text-sm text-muted-foreground">
            سيُعرض ملخص للبيانات أولاً، ولن يُستبدل أي شيء بدون تأكيدك.
          </p>
          <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" />
            اختر ملف النسخة
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickRestore(f);
              e.target.value = '';
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-5">
          <p className="flex items-center gap-2 font-bold">
            <CloudUpload className="h-4 w-4 text-primary" />
            النسخ السحابي اليومي
          </p>
          {isSyncConfigured() ? (
            <AlertBanner tone="success" title="مُفعّل">
              <p>تُنشئ دالة السحابة نسخة يومية تلقائياً وتُحفظ في مساحة خاصة.</p>
            </AlertBanner>
          ) : (
            <div className="space-y-2">
              <AlertBanner tone="warning" title="غير مُفعّل" icon={<AlertTriangle className="h-5 w-5" />}>
                <p>
                  لإضافة نسخ احتياطي سحابي يومي، أضف إعدادات Firebase ومتغير ‎VITE_FUNCTIONS_BASE_URL‎ ثم انشر
                  دوال السحابة المرفقة في مجلد <span dir="ltr">functions/</span>.
                </p>
              </AlertBanner>
            </div>
          )}
        </CardContent>
      </Card>

      {status && (
        <AlertBanner tone="success" title="تم">
          <p>{status}</p>
        </AlertBanner>
      )}

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد الاستعادة</DialogTitle>
          </DialogHeader>
          {restoreData && (
            <div className="space-y-2 text-sm">
              <p className="font-bold">{restoreData.person.nameAr}</p>
              <ul className="space-y-1 text-muted-foreground">
                <li className="numeric">الأدوية: {restoreData.medications.length}</li>
                <li className="numeric">الجداول: {restoreData.schedules.length}</li>
                <li className="numeric">الجرعات: {restoreData.doseEvents.length}</li>
                <li className="numeric">حركات المخزون: {restoreData.inventoryEvents.length}</li>
              </ul>
              <AlertBanner tone="warning" title="مهم">
                <p>سيتم دمج البيانات مع الموجودة على هذا الجهاز.</p>
              </AlertBanner>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoreOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => void confirmRestore()}>استعادة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

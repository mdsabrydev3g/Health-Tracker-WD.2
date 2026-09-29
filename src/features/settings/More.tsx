import { useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  CloudUpload,
  Coins,
  Download,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  Siren,
  Upload,
  Users,
  Utensils,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { AlertBanner } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { useApp } from '@/app/store';
import { isCloudSyncConfigured } from '@/core/sync/cloudSync';
import { readFileAsText, downloadJson } from '@/lib/utils';
import type { PersonExport } from '@/core/db/repository';
import { CURRENT_SCHEMA_VERSION } from '@/core/db/repository';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';

const LINKS = [
  { to: '/calendar', label: 'التقويم', description: 'الجرعات والفحوصات الدورية', icon: CalendarDays },
  { to: '/labs', label: 'الملفات الطبية', description: 'تحاليل وتقارير وملخصات', icon: FileText },
  { to: '/symptoms', label: 'الأعراض', description: 'سجل ما تشعر به الوالدة', icon: FlaskConical },
  { to: '/food', label: 'سجل الطعام', description: 'اربط الطعام بالأدوية', icon: Utensils },
  { to: '/people', label: 'الأشخاص والأجهزة', description: 'ربط هاتف الوالدة', icon: Users },
  { to: '/emergency', label: 'بطاقة الطوارئ', description: 'للطبيب أو المسعف', icon: Siren },
  { to: '/reports', label: 'التقارير والتكاليف', description: 'الالتزام والمصاريف', icon: Coins },
  { to: '/backup', label: 'النسخ الاحتياطي', description: 'نسخ واستعادة', icon: Download },
  { to: '/audit', label: 'سجل التغييرات', description: 'من غيّر ماذا ومتى', icon: History },
  { to: '/settings', label: 'الإعدادات', description: 'المظهر والأمان والتذكيرات', icon: ClipboardList },
];

export function More() {
  const person = useApp((s) => s.activePerson());
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<PersonExport | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    if (!person) return;
    const data = await repo.exportPerson(person.id);
    downloadJson(`health-tracker-${person.nameAr}-${new Date().toISOString().slice(0, 10)}.json`, data);
  };

  const pickImport = async (file: File) => {
    setError('');
    try {
      const text = await readFileAsText(file);
      const parsed = JSON.parse(text) as PersonExport;
      if (!parsed.person || !Array.isArray(parsed.medications)) {
        throw new Error('الملف لا يحتوي على بيانات صالحة');
      }
      setImportData(parsed);
      setImportOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر قراءة الملف');
    }
  };

  const confirmImport = async () => {
    if (!importData) return;
    await repo.importPerson(importData);
    await useApp.getState().bootstrap();
    setImportOpen(false);
    setImportData(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="المزيد" subtitle="كل الشاشات والإعدادات" />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-4 pt-5">
          <HeartPulse className="h-9 w-9 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{person?.nameAr ?? '—'}</p>
            <p className="text-xs text-muted-foreground">{device?.label ?? ''}</p>
          </div>
          <Link to="/settings">
            <Button size="sm" variant="outline">
              الإعدادات
            </Button>
          </Link>
        </CardContent>
      </Card>

      <AlertBanner
        tone={isCloudSyncConfigured() ? 'success' : 'info'}
        title={isCloudSyncConfigured() ? 'المزامنة السحابية مُفعّلة' : 'المزامنة السحابية غير مُفعّلة'}
        icon={<CloudUpload className="h-5 w-5" />}
      >
        <p>
          {isCloudSyncConfigured()
            ? 'تُرفع التغييرات تلقائياً عند توفر الإنترنت.'
            : 'التطبيق يعمل بالكامل بدون إنترنت. لم يتم ضبط عنوان المزامنة السحابية بعد.'}
        </p>
      </AlertBanner>

      <div className="space-y-2">
        {LINKS.map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.to} to={l.to} className="block">
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-4 pt-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                    <Icon className="h-5 w-5 text-secondary-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{l.label}</p>
                    <p className="text-xs text-muted-foreground">{l.description}</p>
                  </div>
                  <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => void exportAll()}>
          <Download className="h-4 w-4" />
          تصدير الكل
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" />
          استيراد نسخة
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickImport(f);
          e.target.value = '';
        }}
      />

      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد الاستيراد</DialogTitle>
          </DialogHeader>
          {importData && (
            <div className="space-y-2 text-sm">
              <p className="font-bold">{importData.person.nameAr}</p>
              <ul className="space-y-1 text-muted-foreground">
                <li className="numeric">الأدوية: {importData.medications.length}</li>
                <li className="numeric">الجرعات المسجلة: {importData.doseEvents.length}</li>
                <li className="numeric">حركات المخزون: {importData.inventoryEvents.length}</li>
                <li className="numeric">نسخة المخطط: {importData.schemaVersion} / {CURRENT_SCHEMA_VERSION}</li>
              </ul>
              <AlertBanner tone="warning" title="تنبيه">
                <p>
                  سيتم دمج هذه البيانات مع الموجودة. لن يُحذف شيء تلقائياً. راجع البيانات قبل التأكيد.
                </p>
              </AlertBanner>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => void confirmImport()}>استيراد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

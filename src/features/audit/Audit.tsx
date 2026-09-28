import { History, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/app/store';
import { PageHeader } from '@/modes/caregiver/CaregiverShell';
import { Badge, EmptyState } from '@/ui/primitives';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { formatLocalDateTime } from '@/core/time';

const ACTION_AR: Record<string, string> = {
  taken: 'تسجيل جرعة',
  skipped: 'تخطي جرعة',
  discontinue: 'إيقاف دواء',
  upload: 'رفع ملف',
  correction: 'تصحيح رصيد',
  purchase: 'إعادة تعبئة',
  initial: 'رصيد افتتاحي',
  manualAdd: 'إضافة يدوية',
  manualRemove: 'خصم يدوي',
};

const ENTITY_AR: Record<string, string> = {
  doseEvents: 'جرعة',
  medications: 'دواء',
  inventoryEvents: 'مخزون',
  labResults: 'ملف طبي',
  schedules: 'جدول',
  persons: 'شخص',
};

/**
 * Audit log — append-only, readable by the caregiver (§13).
 * Never renders clinical free-text beyond field names (§5).
 */
export function Audit() {
  const repo = useApp((s) => s.repo);
  const device = useApp((s) => s.device);
  const queryClient = useQueryClient();

  const { data: logs = [] } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => repo.listAuditLogs(300),
  });

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: () => repo.listDevices(),
  });

  const deviceLabel = (id: string) => {
    if (id === device?.id) return 'هذا الجهاز';
    return devices.find((d) => d.id === id)?.label ?? 'جهاز آخر';
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="سجل التغييرات"
        subtitle={`${logs.length} سجل · لا يمكن حذفه`}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['auditLogs'] })}
          >
            تحديث
          </Button>
        }
      />

      {logs.length === 0 ? (
        <EmptyState
          icon={<History className="h-10 w-10" />}
          title="لا توجد سجلات بعد"
          description="كل عملية على الجرعات أو المخزون تُسجَّل هنا تلقائياً."
        />
      ) : (
        <div className="space-y-1.5">
          {logs.map((log) => (
            <Card key={log.id}>
              <CardContent className="flex items-start gap-3 pt-5">
                <div className="mt-0.5 text-muted-foreground">
                  <Trash2 className="h-4 w-4 opacity-0" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">{ACTION_AR[log.action] ?? log.action}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {ENTITY_AR[log.entity] ?? log.entity}
                    </span>
                  </div>
                  {log.after && Object.keys(log.after).length > 0 && (
                    <p className="mt-1.5 truncate text-xs text-muted-foreground">
                      {Object.entries(log.after)
                        .filter(([, v]) => typeof v !== 'object')
                        .map(([k, v]) => `${FIELD_AR[k] ?? k}: ${String(v)}`)
                        .join(' · ')}
                    </p>
                  )}
                  <p className="numeric mt-1 text-xs text-muted-foreground">
                    {formatLocalDateTime(log.atUtc, 'Africa/Cairo')} · {deviceLabel(log.actorDeviceId)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        السجل للقراءة فقط. حذف السجلات غير متاح للحفاظ على نزاهة المتابعة.
      </p>
    </div>
  );
}

const FIELD_AR: Record<string, string> = {
  status: 'الحالة',
  quantity: 'الكمية',
  balance: 'الرصيد',
  qty: 'التغيير',
  reason: 'السبب',
  type: 'النوع',
  date: 'التاريخ',
  medName: 'الدواء',
};

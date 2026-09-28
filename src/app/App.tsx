import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './store';
import { ErrorBoundary } from './ErrorBoundary';
import { useAppearance, useForegroundRefresh } from './useAppearance';
import { CaregiverShell } from '@/modes/caregiver/CaregiverShell';
import { MotherShell } from '@/modes/mother/MotherShell';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { Today } from '@/features/today/Today';
import { Medications } from '@/features/medications/Medications';
import { MedicationDetail } from '@/features/medications/MedicationDetail';
import { Inventory } from '@/features/inventory/Inventory';
import { CalendarView } from '@/features/calendar/CalendarView';
import { Reports } from '@/features/reports/Reports';
import { Labs } from '@/features/labs/Labs';
import { Symptoms } from '@/features/symptoms/Symptoms';
import { Food } from '@/features/food/Food';
import { People } from '@/features/person/People';
import { Emergency } from '@/features/emergency/Emergency';
import { Settings } from '@/features/settings/Settings';
import { Backup } from '@/features/backup/Backup';
import { Audit } from '@/features/audit/Audit';
import { More } from '@/features/settings/More';
import { Splash } from '@/ui/Splash';

export function App() {
  const ready = useApp((s) => s.ready);
  const error = useApp((s) => s.error);
  const bootstrap = useApp((s) => s.bootstrap);
  const refresh = useApp((s) => s.refresh);
  const mode = useApp((s) => s.settings.activeMode);
  const onboardingDone = useApp((s) => s.settings.activePersonId);

  useAppearance();
  useForegroundRefresh(() => void refresh());

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <Splash />;

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <p className="text-lg font-bold">تعذّر تشغيل التطبيق</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!onboardingDone) {
    return (
      <ErrorBoundary>
        <Onboarding />
      </ErrorBoundary>
    );
  }

  // Mother Mode: a single locked screen. No router, no navigation (§4).
  if (mode === 'mother') {
    return (
      <ErrorBoundary>
        <MotherShell />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <CaregiverShell>
        <RoutedContent />
      </CaregiverShell>
    </ErrorBoundary>
  );
}

function RoutedContent() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="/today" element={<Today />} />
      <Route path="/medications" element={<Medications />} />
      <Route path="/medications/:medId" element={<MedicationDetail />} />
      <Route path="/inventory" element={<Inventory />} />
      <Route path="/calendar" element={<CalendarView />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/labs" element={<Labs />} />
      <Route path="/symptoms" element={<Symptoms />} />
      <Route path="/food" element={<Food />} />
      <Route path="/people" element={<People />} />
      <Route path="/emergency" element={<Emergency />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/backup" element={<Backup />} />
      <Route path="/audit" element={<Audit />} />
      <Route path="/more" element={<More />} />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

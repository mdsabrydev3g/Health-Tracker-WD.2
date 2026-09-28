/**
 * Arabic-first i18n and number formatting.
 * `ar` is the only required locale; the numeral style is user-toggleable (§14).
 */

import type { AppSettings } from '../core/db/schema';

export type NumeralStyle = AppSettings['numeralStyle'];

const EASTERN_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Convert Western digits in a string to Eastern Arabic-Indic digits. */
export function toEasternDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => EASTERN_DIGITS[Number(d)] ?? d);
}

export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String(EASTERN_DIGITS.indexOf(d)));
}

/** Format a number per the user's numeral preference. */
export function formatNumber(n: number, style: NumeralStyle = 'western', maxFraction = 2): string {
  const s = new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFraction }).format(n);
  return style === 'eastern' ? toEasternDigits(s) : s;
}

export function formatPercent(percent: number | null, style: NumeralStyle = 'western'): string {
  if (percent === null) return '—';
  return `${formatNumber(percent, style, 1)}٪`;
}

/* ------------------------------------------------------------------ */
/* Static UI strings (Arabic)                                          */
/* ------------------------------------------------------------------ */

export const AR = {
  appName: 'Health Tracker',
  tagline: 'رفيق الجرعات والصحة للعائلة',

  /* Navigation — caregiver */
  nav: {
    today: 'اليوم',
    medications: 'الأدوية',
    inventory: 'المخزون',
    reports: 'التقارير',
    calendar: 'التقويم',
    labs: 'الملفات الطبية',
    symptoms: 'الأعراض',
    food: 'الطعام',
    people: 'الأشخاص',
    emergency: 'الطوارئ',
    settings: 'الإعدادات',
    backup: 'النسخ الاحتياطي',
    audit: 'سجل التغييرات',
    more: 'المزيد',
  },

  /* Mother Mode */
  mother: {
    nextDose: 'الجرعة القادمة',
    doseTime: 'حان موعد جرعة',
    tookIt: 'أخذت الدواء',
    postpone: 'تأجيل',
    todayProgress: 'جرعات اليوم',
    takenCount: 'تم أخذها',
    remainingCount: 'المتبقية',
    noMoreDoses: 'لا توجد جرعات متبقية اليوم',
    wellDone: 'بارك الله فيك، تم تسجيل الجرعة',
    exitPrompt: 'أدخل رقم السري للخروج',
  },

  /* Dose statuses */
  status: {
    upcoming: 'لم يحن بعد',
    due: 'حان الموعد',
    taken: 'تم أخذها',
    missed: 'فائتة',
    skipped: 'تم تخطيها',
    snoozed: 'مؤجلة',
    cancelled: 'ملغاة',
  },

  /* Actions */
  actions: {
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة',
    confirm: 'تأكيد',
    back: 'رجوع',
    close: 'إغلاق',
    retry: 'إعادة المحاولة',
    skip: 'تخطي',
    snooze: 'تأجيل',
    refill: 'إعادة تعبئة',
    export: 'تصدير',
    import: 'استيراد',
    restore: 'استعادة',
    backupNow: 'نسخ احتياطي الآن',
    reviewBeforeSave: 'راجع البيانات قبل الحفظ',
  },

  /* Inventory */
  inventory: {
    balance: 'الرصيد',
    daysRemaining: 'يكفي لمدة',
    depletionDate: 'ينتهي في',
    lowStock: 'المخزون منخفض',
    expiringSoon: 'قريب الانتهاء',
    expiryBeforeDepletion: 'العلبة ستنتهي صلاحيتها قبل أن ينتهي الدواء',
    expired: 'منتهي الصلاحية',
    consumedToday: 'المستهلك اليوم',
    days: 'يوم',
  },

  /* Alerts */
  alerts: {
    lowStockTitle: 'تحذير: مخزون منخفض',
    expiryTitle: 'تحذير: صلاحية قريبة الانتهاء',
    alarmHealthTitle: 'تنبيه: مشكلة في التذكيرات',
    missedDose: 'جرعة فائتة',
    noAlerts: 'لا توجد تنبيهات',
  },

  /* Reports */
  reports: {
    adherence: 'الالتزام',
    adherenceRate: 'نسبة الالتزام',
    streak: 'السلسلة الحالية',
    bestStreak: 'أطول سلسلة',
    taken: 'تم أخذها',
    missed: 'فائتة',
    skipped: 'متخطاة',
    costs: 'التكاليف',
    costPerMonth: 'التكلفة الشهرية',
    costPerYear: 'التكلفة السنوية',
    last7Days: 'آخر ٧ أيام',
    last30Days: 'آخر ٣٠ يوماً',
    period: 'الفترة',
  },

  /* Settings */
  settings: {
    language: 'اللغة',
    numerals: 'شكل الأرقام',
    westernNumerals: 'أرقام عربية (0123)',
    easternNumerals: 'أرقام هندية (٠١٢٣)',
    theme: 'المظهر',
    light: 'فاتح',
    dark: 'داكن',
    system: 'حسب النظام',
    largeText: 'خط كبير',
    speakAloud: 'القراءة بصوت عالٍ',
    appLock: 'قفل التطبيق',
    autoLock: 'القفل التلقائي',
    minutes: 'دقيقة',
    gracePeriod: 'مهلة التأخير قبل اعتبار الجرعة فائتة',
    lowStockThreshold: 'حد التنبيه للمخزون المنخفض',
    timezone: 'المنطقة الزمنية',
    devices: 'الأجهزة',
    alarmHealth: 'حالة التذكيرات',
    mode: 'الوضع',
    caregiverMode: 'وضع مقدم الرعاية',
    motherMode: 'وضع الوالدة',
  },

  /* Onboarding */
  onboarding: {
    welcome: 'أهلاً بك في Health Tracker',
    thisDeviceFor: 'هذا الجهاز يخص:',
    enterCaregiverPin: 'أدخل الرقم السري لمقدم الرعاية',
    notificationsExplain:
      'يحتاج التطبيق إلى إذن الإشعارات ليذكّرك بمواعيد الجرعات في وقتها بالضبط. بدون هذا الإذن لن تصلك التذكيرات.',
    exactAlarmExplain:
      'يحتاج التطبيق إلى إذن «المنبّهات الدقيقة» حتى لا يتأخر التذكير عند نوم الهاتف.',
    batteryExplain:
      'يحتاج التطبيق إلى استثناء من تحسين البطارية حتى لا يوقفه الهاتف ويفوت التذكير.',
  },

  /* Modes */
  modes: {
    caregiver: 'مقدم الرعاية',
    mother: 'الوالدة',
  },
} as const;

/** Arabic food-rule labels used on dose cards (§5 foodRule). */
export const FOOD_RULE_LABELS: Record<string, string> = {
  with: 'مع الطعام',
  before: 'قبل الطعام',
  after: 'بعد الطعام',
  emptyStomach: 'على معدة فارغة',
  avoid: 'تجنّب أنواعاً معينة من الطعام',
  custom: 'حسب تعليمات الطبيب',
};

export const FOOD_RULE_OPTIONS = Object.entries(FOOD_RULE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Dose form labels. */
export const FORM_LABELS: Record<string, string> = {
  tablet: 'أقراص',
  capsule: 'كبسولات',
  syrup: 'شراب',
  injection: 'حقن',
  drops: 'قطرات',
  inhaler: 'بخاخ',
  patch: 'لاصقة',
  other: 'أخرى',
};

export const FORM_OPTIONS = Object.entries(FORM_LABELS).map(([value, label]) => ({ value, label }));

export const SCHEDULE_KIND_LABELS: Record<string, string> = {
  daily: 'يومياً',
  everyNDays: 'كل عدة أيام',
  weekdays: 'أيام محددة',
  prn: 'عند الحاجة',
  taper: 'تقليل تدريجي',
};

export const WEEKDAY_LABELS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const STATUS_AR: Record<string, string> = {
  active: 'نشط',
  paused: 'متوقف مؤقتاً',
  finished: 'منتهي',
  discontinued: 'موقوف',
};

export const TEST_INTERVAL_LABELS: Record<string, string> = {
  monthly: 'شهرياً',
  '3m': 'كل ٣ أشهر',
  '6m': 'كل ٦ أشهر',
  yearly: 'سنوياً',
  custom: 'مخصص',
};

/**
 * First-run seed — a realistic family so the app is usable immediately.
 *
 * The mother is an elderly cardiac patient on ~9 medications; the caregiver
 * is her child. This mirrors the real scenario in §0 so the caregiver can
 * see the whole app working before entering real data.
 */

import type {
  Medication,
  Person,
  Schedule,
  InventoryEvent,
  DoseEvent,
} from '@/core/db/schema';
import { newId } from '@/core/db/schema';
import type { Repository } from '@/core/db/repository';

interface MedSeed {
  nameAr: string;
  nameEn: string;
  ingredients: string[];
  strength: { value: number; unit: string };
  form: Medication['form'];
  times: string[];
  quantity: number;
  foodRule: Medication['foodRule'];
  price: number;
  packSize: number;
  stock: number;
  doctor: string;
  condition: string;
  kind?: Schedule['kind'];
  intervalN?: number;
  weekdays?: number[];
  prnMaxPerDay?: number;
}

const MEDS: MedSeed[] = [
  {
    nameAr: 'أسبيرين ٨١',
    nameEn: 'Aspirin 81',
    ingredients: ['Acetylsalicylic acid'],
    strength: { value: 81, unit: 'mg' },
    form: 'tablet',
    times: ['08:00'],
    quantity: 1,
    foodRule: { mode: 'after', text: 'بعد الإفطار' },
    price: 30,
    packSize: 30,
    stock: 30,
    doctor: 'د. أحمد سالم',
    condition: 'سيولة الدم',
  },
  {
    nameAr: 'كلوبيدوجريل ٧٥',
    nameEn: 'Clopidogrel 75',
    ingredients: ['Clopidogrel'],
    strength: { value: 75, unit: 'mg' },
    form: 'tablet',
    times: ['08:00'],
    quantity: 1,
    foodRule: { mode: 'with' },
    price: 120,
    packSize: 30,
    stock: 28,
    doctor: 'د. أحمد سالم',
    condition: 'بعد دعامة القلب',
  },
  {
    nameAr: 'أتورفاستاتين ٢٠',
    nameEn: 'Atorvastatin 20',
    ingredients: ['Atorvastatin'],
    strength: { value: 20, unit: 'mg' },
    form: 'tablet',
    times: ['21:00'],
    quantity: 1,
    foodRule: { mode: 'after' },
    price: 95,
    packSize: 30,
    stock: 30,
    doctor: 'د. أحمد سالم',
    condition: 'الكوليسترول',
  },
  {
    nameAr: 'ميتوبرولول ٥٠',
    nameEn: 'Metoprolol 50',
    ingredients: ['Metoprolol'],
    strength: { value: 50, unit: 'mg' },
    form: 'tablet',
    times: ['08:00', '20:00'],
    quantity: 1,
    foodRule: { mode: 'with' },
    price: 70,
    packSize: 30,
    stock: 46,
    doctor: 'د. أحمد سالم',
    condition: 'ضغط الدم ونبضات القلب',
  },
  {
    nameAr: 'ليزينوبريل ١٠',
    nameEn: 'Lisinopril 10',
    ingredients: ['Lisinopril'],
    strength: { value: 10, unit: 'mg' },
    form: 'tablet',
    times: ['08:00'],
    quantity: 1,
    foodRule: { mode: 'emptyStomach' },
    price: 60,
    packSize: 30,
    stock: 24,
    doctor: 'د. أحمد سالم',
    condition: 'ضغط الدم',
  },
  {
    nameAr: 'فوروسيميد ٤٠',
    nameEn: 'Furosemide 40',
    ingredients: ['Furosemide'],
    strength: { value: 40, unit: 'mg' },
    form: 'tablet',
    times: ['08:00'],
    quantity: 1,
    foodRule: { mode: 'before' },
    price: 25,
    packSize: 30,
    stock: 9,
    doctor: 'د. أحمد سالم',
    condition: 'احتباس السوائل',
  },
  {
    nameAr: 'أوميبرازول ٢٠',
    nameEn: 'Omeprazole 20',
    ingredients: ['Omeprazole'],
    strength: { value: 20, unit: 'mg' },
    form: 'capsule',
    times: ['07:30'],
    quantity: 1,
    foodRule: { mode: 'emptyStomach', text: 'قبل الإفطار بنصف ساعة' },
    price: 85,
    packSize: 30,
    stock: 22,
    doctor: 'د. أحمد سالم',
    condition: 'حماية المعدة',
  },
  {
    nameAr: 'باراسيتامول ٥٠٠',
    nameEn: 'Paracetamol 500',
    ingredients: ['Paracetamol'],
    strength: { value: 500, unit: 'mg' },
    form: 'tablet',
    times: ['22:00'],
    quantity: 1,
    foodRule: { mode: 'after' },
    price: 20,
    packSize: 20,
    stock: 18,
    doctor: 'د. أحمد سالم',
    condition: 'عند الحاجة للألم',
    kind: 'prn',
    prnMaxPerDay: 3,
  },
  {
    nameAr: 'فيتامين د ٥٠٠٠٠',
    nameEn: 'Vitamin D3 50000',
    ingredients: ['Cholecalciferol'],
    strength: { value: 50000, unit: 'IU' },
    form: 'capsule',
    times: ['13:00'],
    quantity: 1,
    foodRule: { mode: 'with' },
    price: 140,
    packSize: 4,
    stock: 4,
    doctor: 'د. أحمد سالم',
    condition: 'نقص فيتامين د',
    kind: 'weekdays',
    weekdays: [6], // Saturdays
  },
];

export async function createSeed(repo: Repository, deviceId: string): Promise<Person> {
  const now = new Date().toISOString();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const personId = newId('per');
  const person: Person = {
    id: personId,
    nameAr: 'الوالدة',
    dob: '1948-04-12',
    gender: 'female',
    bloodType: 'O+',
    allergies: ['البنسلين'],
    notes: 'مريضة قلب — تتابع مع د. أحمد سالم في مستشفى القلب.',
    emergencyContact: {
      name: 'الابن — محمد',
      phone: '+201000000000',
      relation: 'الابن',
    },
    colorTag: '#0f766e',
    isMinor: false,
    timezone: 'Africa/Cairo',
    largeTextDefault: true,
    updatedAt: now,
    updatedBy: deviceId,
    rev: 1,
    deleted: false,
  };
  await repo.putPerson(person);

  const medications: Medication[] = [];
  const schedules: Schedule[] = [];
  const inventoryEvents: InventoryEvent[] = [];
  const doseEvents: DoseEvent[] = [];

  for (const seed of MEDS) {
    const medId = newId('med');
    const med: Medication = {
      id: medId,
      personId,
      nameAr: seed.nameAr,
      nameEn: seed.nameEn,
      activeIngredients: seed.ingredients,
      strength: seed.strength,
      form: seed.form,
      package: {
        kind: 'strips',
        strips: Math.max(1, Math.ceil(seed.packSize / 10)),
        pillsPerStrip: 10,
        pillCount: seed.packSize,
      },
      manufacturer: 'شركة أدوية',
      notes: '',
      rx: {
        isPrescription: seed.kind !== 'prn',
        isControlled: false,
        renewalDate: new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10),
      },
      packExpiry: new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10),
      startDate: today,
      foodRule: seed.foodRule,
      cost: {
        packagePrice: seed.price,
        currency: 'EGP',
        purchasedAt: today,
        packageSize: seed.packSize,
      },
      doctor: seed.doctor,
      condition: seed.condition,
      status: 'active',
      balanceCache: seed.stock,
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    };
    medications.push(med);
    await repo.putMedication(med);

    // Opening stock as an explicit event — never a bare balance (§5).
    const inv: InventoryEvent = {
      id: newId('inv'),
      personId,
      medId,
      type: 'initial',
      qty: seed.stock,
      reason: 'الرصيد الافتتاحي',
      prevBalance: 0,
      newBalance: seed.stock,
      atUtc: now,
      deviceId,
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    };
    inventoryEvents.push(inv);
    await repo.putInventoryEvent(inv);

    const schedule: Schedule = {
      id: newId('sch'),
      medId,
      personId,
      kind: seed.kind ?? 'daily',
      times: seed.times,
      quantityPerDose: seed.quantity,
      dosesPerDay: (seed.kind ?? 'daily') === 'prn' ? 0 : seed.times.length,
      anchorDate: today,
      weekdays: seed.weekdays,
      intervalN: seed.intervalN,
      prnMaxPerDay: seed.prnMaxPerDay,
      activeFrom: today,
      activeTo: null,
      updatedAt: now,
      updatedBy: deviceId,
      rev: 1,
      deleted: false,
    };
    schedules.push(schedule);
    await repo.putSchedule(schedule);
  }

  await repo.putDoseEvents(doseEvents);

  return person;
}

/** The caregiver's own profile, created on demand so the People screen isn't empty. */
export function caregiverProfile(deviceId: string): Person {
  const now = new Date().toISOString();
  return {
    id: newId('per'),
    nameAr: 'أنا (مقدم الرعاية)',
    timezone: 'Africa/Cairo',
    allergies: [],
    colorTag: '#0369a1',
    isMinor: false,
    updatedAt: now,
    updatedBy: deviceId,
    rev: 1,
    deleted: false,
  };
}

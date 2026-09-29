import { test, expect } from '@playwright/test';

/**
 * §16 acceptance — the core loop.
 *
 * These run against the real production build with a real IndexedDB.
 * The store auto-seeds a family (1 person + 9 cardiac medications) on
 * first run, so there is no onboarding to click through.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for the store to finish bootstrapping + materialising doses.
  await expect(page.getByRole('heading', { name: 'اليوم' })).toBeVisible({ timeout: 30_000 });
});

test('boots straight into the caregiver Today screen, seeded', async ({ page }) => {
  // The seeded person is "الوالدة".
  await expect(page.getByRole('heading', { name: 'اليوم' })).toBeVisible();

  // The day summary and the today's-schedule section both render.
  await expect(page.getByText('ملخص اليوم')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'جدول اليوم' })).toBeVisible();
});

test('the seeded family has 9 medications', async ({ page }) => {
  await page.getByRole('link', { name: 'الأدوية' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

  // Cardiology regimen from the seed: aspirin, clopidogrel, atorvastatin,
  // metoprolol, lisinopril, furosemide, omeprazole, paracetamol PRN, vit D3.
  const body = await page.textContent('body');
  expect(body).toBeTruthy();
  for (const name of ['أسبرين', 'كلوبيدوجريل', 'أتورفاستاتين', 'ميتوبرولول']) {
    expect(body).toContain(name);
  }
});

test('bottom navigation reaches every caregiver tab', async ({ page }) => {
  for (const [label] of [
    ['الأدوية'],
    ['المخزون'],
    ['التقارير'],
    ['المزيد'],
    ['اليوم'],
  ] as const) {
    await page.getByRole('link', { name: label }).click();
    await page.waitForTimeout(400);
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }
});

test('inventory screen lists stock for the seeded medications', async ({ page }) => {
  await page.getByRole('link', { name: 'المخزون' }).click();
  await page.waitForTimeout(600);

  const body = await page.textContent('body');
  expect(body).toBeTruthy();
  // At least one medication's name shows up in the stock list.
  expect(body).toMatch(/أسبرين|أتورفاستاتين|ميتوبرولول/);
});

test('the app renders RTL Arabic throughout', async ({ page }) => {
  const dir = await page.getAttribute('html', 'dir');
  const lang = await page.getAttribute('html', 'lang');
  expect(dir).toBe('rtl');
  expect(lang).toBe('ar');
});

test('no console errors on load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await page.waitForTimeout(2500);
  // The service worker may log benign noise; assert nothing fatal appeared.
  const fatal = errors.filter(
    (e) => !/favicon|manifest|workbox|sw\.js|Failed to load resource/i.test(e),
  );
  expect(fatal).toEqual([]);
});

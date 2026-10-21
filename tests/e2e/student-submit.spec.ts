import { test, expect } from '@playwright/test';

const complaintSuffix = () => `E2E-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const TITLE_INPUT = 'input[placeholder="Brief title of your complaint"]';
const DESCRIPTION_INPUT = 'textarea[placeholder="Describe your complaint in detail. Include dates, names, and specific incidents."]';

test.describe('student submits a verified complaint (E2E)', () => {
  test('multi-step form creates a complaint and shows the number', async ({ page }) => {
    const suffix = complaintSuffix();

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('student@example.com');
    await page.getByLabel(/password/i).first().fill('Password@123');
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/student\/dashboard/, { timeout: 15000 });

    await page.goto('/student/complaints/new');

    // Step 1: submission mode (verified default) → continue
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 2: details
    await page.locator(TITLE_INPUT).fill(`E2E portal wifi outage ${suffix}`);
    await page.locator(DESCRIPTION_INPUT).fill(
      `During E2E automation run ${suffix}: the campus wifi login portal rejects my valid password repeatedly and blocks course registration. Please investigate the login service and provide a temporary alternative for the affected students.`
    );
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 3: review → submit
    await page.getByRole('button', { name: /submit complaint/i }).click();

    // Step 4: confirmation with the issued complaint number
    await expect(page.getByText(/complaint submitted/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/^GRP-\d{4}/).first()).toBeVisible({ timeout: 10000 });
  });

  test('newly submitted complaint appears in the department admin queue', async ({ page }) => {
    const suffix = complaintSuffix();
    const title = `E2E admin queue visibility ${suffix}`;

    // Student submits with an explicitly selected category + department.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('student@example.com');
    await page.getByLabel(/password/i).first().fill('Password@123');
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/student\/dashboard/, { timeout: 15000 });

    await page.goto('/student/complaints/new');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.locator(TITLE_INPUT).fill(title);
    await page.locator(DESCRIPTION_INPUT).fill(
      `During E2E automation run ${suffix}: this complaint explicitly selects Academic Assessment and Academic Affairs so the department queue must show it immediately after submission.`
    );
    const selects = page.locator('select');
    await selects.nth(1).selectOption({ label: 'Academic Assessment' });
    await selects.nth(2).selectOption({ label: 'Academic Affairs' });
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByRole('button', { name: /submit complaint/i }).click();
    await expect(page.getByText(/complaint submitted/i).first()).toBeVisible({ timeout: 20000 });

    // Switch to the Academic Affairs department administrator.
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('department.admin@example.com');
    await page.getByLabel(/password/i).first().fill('Password@123');
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/admin\/dept\/dashboard/, { timeout: 15000 });

    await page.goto('/admin/dept/complaints');
    await expect(page.getByText(title)).toBeVisible({ timeout: 20000 });
  });

  test('my complaints listing shows the created complaint', async ({ page }) => {
    const suffix = complaintSuffix();

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('student@example.com');
    await page.getByLabel(/password/i).first().fill('Password@123');
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/student\/dashboard/, { timeout: 15000 });

    await page.goto('/student/complaints/new');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.locator(TITLE_INPUT).fill(`E2E library printer broken ${suffix}`);
    await page.locator(DESCRIPTION_INPUT).fill(
      `During E2E automation run ${suffix}: the library printer on floor 2 jams for everyone and prints blank pages, students lose print quota without sheets printed. Please fix the toner path hardware or replace the unit.`
    );
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByRole('button', { name: /submit complaint/i }).click();

    await expect(page.getByText(/complaint submitted/i).first()).toBeVisible({ timeout: 20000 });

    await page.goto('/student/complaints');
    await expect(page.getByText(new RegExp(suffix))).toBeVisible({ timeout: 15000 });
  });
});

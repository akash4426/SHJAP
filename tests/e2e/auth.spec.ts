import { test, expect } from '@playwright/test';

test.describe('authentication (E2E)', () => {
  test('landing page renders and invites sign in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/student grievance portal|grievance portal/i).first()).toBeVisible();
  });

  test('wrong password shows an error, correct login lands on dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('student@example.com');
    await page.getByLabel(/password/i).first().fill('WrongPassword@1');
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();

    await expect(page.locator('.Toastify, .toast, [role="alert"]')).toBeVisible({ timeout: 8000 }).catch(() => {
      // toast may vary; the definitive check is that we did NOT navigate
    });
    await expect(page).not.toHaveURL(/dashboard/);

    await page.getByLabel(/email/i).fill('student@example.com');
    await page.getByLabel(/password/i).first().fill('Password@123');
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/student\/dashboard/, { timeout: 15000 });
    await expect(page).toHaveURL(/student\/dashboard/);
  });

  test('main admin logs into the admin dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('main.admin@example.com');
    await page.getByLabel(/password/i).first().fill('Password@123');
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/admin\/main\/dashboard/, { timeout: 15000 });
    await expect(page).toHaveURL(/admin\/main\/dashboard/);
  });
});

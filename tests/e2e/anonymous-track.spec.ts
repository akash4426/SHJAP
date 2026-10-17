import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:3100';
const TRACK_INPUT = 'input[placeholder^="e.g. TRK-"]';

test.describe('anonymous complaint tracking (E2E)', () => {
  test('create anonymous complaint via public API and track it in the public UI', async ({ browser }) => {
    const request = await browser.newContext().then((c) => c.request);
    const res = await request.post(`${API}/api/anonymous/complaints`, {
      data: {
        title: 'E2E anonymous noise complaint',
        description:
          'The dormitory next door has construction noise before 6 am every day during the ongoing term. It interrupts morning study hours for the entire wing and the timetable of classes nearby. We request this be moved after 8 am.',
        submissionMode: 'ANONYMOUS',
      },
    });
    expect(res.ok()).toBeTruthy();
    const { data } = await res.json();
    expect(data.trackingId).toMatch(/^TRK-/);
    expect(data.trackingId.length).toBeGreaterThan(4);

    // Track it in the public UI — no login, no identity required
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/track');
    await page.locator(TRACK_INPUT).fill(data.trackingId);
    await page.getByRole('button', { name: 'Track' }).click();

    await expect(page.getByText(/noise complaint/i).first()).toBeVisible({ timeout: 15000 });
  });
});

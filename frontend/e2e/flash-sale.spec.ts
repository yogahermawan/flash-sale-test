import { expect, test, type APIRequestContext } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:3100';
const internalKey = 'e2e-internal-key';

async function resetSale(request: APIRequestContext, patch: Record<string, unknown> = {}) {
  const now = Date.now();
  const response = await request.post(`${apiUrl}/api/internal/sales/reset`, {
    headers: { 'x-internal-api-key': internalKey },
    data: {
      initialStock: 3,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
      productName: 'Limited Edition Bookipi Headphones',
      ...patch,
    },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('flash sale development page', () => {
  test.beforeEach(async ({ request }) => { await resetSale(request); });

  test('loads an active sale and confirms a purchase', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Limited Edition Bookipi Headphones' })).toBeVisible();
    await page.getByLabel('Your user ID').fill('playwright@example.com');
    await page.getByRole('button', { name: 'Buy now' }).click();
    await expect(page.getByRole('heading', { name: 'You’re in.' })).toBeVisible();
    await expect(page.locator('code')).toHaveText(/^[0-9a-f-]{36}$/);
  });

  test('restores an existing order through the development-page lookup', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Your user ID').fill('lookup@example.com');
    await page.getByRole('button', { name: 'Buy now' }).click();
    const orderId = await page.locator('code').textContent();
    await page.reload();
    await page.getByLabel('Your user ID').fill('lookup@example.com');
    await page.getByRole('button', { name: 'Already purchased? Check order' }).click();
    await expect(page.getByRole('heading', { name: 'Already secured.' })).toBeVisible();
    await expect(page.locator('code')).toHaveText(orderId ?? '');
  });

  test('shows sold out state without allowing a purchase', async ({ page, request }) => {
    await resetSale(request, { initialStock: 0 });
    await page.goto('/');
    await expect(page.getByText('Sold out', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sold out' })).toBeDisabled();
  });

  test('shows ended state without allowing a purchase', async ({ page, request }) => {
    const now = Date.now();
    await resetSale(request, { startsAt: new Date(now - 120_000).toISOString(), endsAt: new Date(now - 60_000).toISOString() });
    await page.goto('/');
    await expect(page.getByText('Drop closed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sale ended' })).toBeDisabled();
  });
});

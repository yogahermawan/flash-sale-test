import { expect, test, type APIRequestContext } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:3100';
const internalKey = 'e2e-internal-key';

async function resetSale(
  request: APIRequestContext,
  patch: Record<string, unknown> = {},
) {
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
  test.beforeEach(async ({ request }) => {
    await resetSale(request);
  });

  test('loads an active sale and confirms a purchase', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Limited Edition Bookipi Headphones' }),
    ).toBeVisible();
    await page.getByLabel('Your user ID').fill('playwright@example.com');
    const admitted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/purchases') &&
        response.request().method() === 'POST',
    );
    const connected = page.waitForEvent('websocket', (socket) =>
      socket.url().includes('/api/purchases/'),
    );
    await page.getByRole('button', { name: 'Buy now' }).click();
    expect((await admitted).status()).toBe(202);
    expect((await connected).url()).toContain('/events?');
    await expect(
      page.getByRole('heading', { name: 'You’re in.' }),
    ).toBeVisible();
    await expect(page.locator('code')).toHaveText(/^[0-9a-f-]{36}$/);
  });

  test('updates stock in another browser and restores current stock after reconnect', async ({
    page,
    browser,
    request,
  }) => {
    await resetSale(request, { initialStock: 1 });
    const observerContext = await browser.newContext();
    const observer = await observerContext.newPage();
    try {
      await page.goto('/');
      await observer.goto('http://127.0.0.1:5174/');
      await expect(
        observer.getByLabel('Available stock').locator('strong'),
      ).toHaveText('1');
      await page.getByLabel('Your user ID').fill('live-stock@example.com');
      await page.getByRole('button', { name: 'Buy now' }).click();
      await expect(
        observer.getByLabel('Available stock').locator('strong'),
      ).toHaveText('0');
      await expect(
        observer.getByRole('button', { name: 'Sold out' }),
      ).toBeDisabled();
      await observerContext.setOffline(true);
      await resetSale(request, { initialStock: 4 });
      await observerContext.setOffline(false);
      await expect(
        observer.getByLabel('Available stock').locator('strong'),
      ).toHaveText('4');
    } finally {
      await observerContext.close();
    }
  });

  test('restores an existing order through the development-page lookup', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Your user ID').fill('lookup@example.com');
    await page.getByRole('button', { name: 'Buy now' }).click();
    const orderId = await page.locator('code').textContent();
    await page.reload();
    await page.getByLabel('Your user ID').fill('lookup@example.com');
    await page
      .getByRole('button', { name: 'Already purchased? Check order' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Already secured.' }),
    ).toBeVisible();
    await expect(page.locator('code')).toHaveText(orderId ?? '');
  });

  test('shows sold out state without allowing a purchase', async ({
    page,
    request,
  }) => {
    await resetSale(request, { initialStock: 0 });
    await page.goto('/');
    await expect(
      page.getByText('Sold out', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sold out' })).toBeDisabled();
  });

  test('shows ended state without allowing a purchase', async ({
    page,
    request,
  }) => {
    const now = Date.now();
    await resetSale(request, {
      startsAt: new Date(now - 120_000).toISOString(),
      endsAt: new Date(now - 60_000).toISOString(),
    });
    await page.goto('/');
    await expect(page.getByText('Drop closed', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sale ended' }),
    ).toBeDisabled();
  });
  test('uses server eligibility when the device clock is one day ahead', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 86_400_000;
    });
    await page.goto('/');
    await expect(page.getByText('Live now', { exact: true })).toBeVisible();
    await page.getByLabel('Your user ID').fill('clock-skew@example.com');
    await page.getByRole('button', { name: 'Buy now' }).click();
    await expect(
      page.getByRole('heading', { name: 'You’re in.' }),
    ).toBeVisible();
  });
});

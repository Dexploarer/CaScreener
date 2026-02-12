import { test, expect } from "@playwright/test";

const SAMPLE_ADDRESS = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";

test.describe("Helius page", () => {
  test("loads and shows form with address input and Create dashboard button", async ({ page }) => {
    await page.goto("/helius");
    await expect(page.getByRole("heading", { name: /Helius Wallet Analytics/i })).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\./)).toBeVisible();
    await expect(page.getByRole("button", { name: /Create dashboard/i })).toBeVisible();
  });

  test("shareable URL pre-fills address from query", async ({ page }) => {
    await page.goto(`/helius?address=${SAMPLE_ADDRESS}`);
    await expect(page.getByPlaceholder(/e\.g\./)).toHaveValue(SAMPLE_ADDRESS);
  });

  test("submit address shows either dashboard or error", async ({ page }) => {
    await page.goto("/helius");
    await page.getByPlaceholder(/e\.g\./).fill(SAMPLE_ADDRESS);
    await page.getByRole("button", { name: /Create dashboard/i }).click();

    // Wait for either dashboard content or error/retry (up to 15s)
    const dashboardOrError = page.locator("text=SOL Balance").first().or(page.locator("text=Wallet").first()).or(page.getByRole("button", { name: /Retry/i })).or(page.getByText(/HELIUS_API_KEY|Too many requests|Helius request failed|Request failed/));
    await dashboardOrError.first().waitFor({ state: "visible", timeout: 15000 });

    const hasResult = await page.getByText("SOL Balance").first().isVisible().catch(() => false)
      || await page.getByText("Wallet").first().isVisible().catch(() => false)
      || await page.getByRole("button", { name: /Retry/i }).isVisible().catch(() => false)
      || await page.getByText(/HELIUS_API_KEY|Too many requests|Request failed/).first().isVisible().catch(() => false);
    expect(hasResult).toBeTruthy();
  });

  test("Generate UGI dashboard section has model dropdown and button", async ({ page }) => {
    await page.goto("/helius");
    await expect(page.getByRole("heading", { name: /Generate UGI dashboard/i })).toBeVisible();
    await expect(page.getByLabel(/AI provider for UGI/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate UGI dashboard/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate UGI dashboard/i })).toBeDisabled(); // no address yet
  });

  test("with address filled, Generate UGI dashboard button is enabled", async ({ page }) => {
    await page.goto("/helius");
    await page.getByPlaceholder(/e\.g\./).fill(SAMPLE_ADDRESS);
    await expect(page.getByRole("button", { name: /Generate UGI dashboard/i })).toBeEnabled();
  });
});

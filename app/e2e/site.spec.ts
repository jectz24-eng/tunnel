import { expect, test } from "@playwright/test";

const PAGES = ["/", "/mine", "/protocol", "/stats", "/leaderboard", "/tokenomics", "/docs", "/dashboard", "/rounds/0"];

test.describe("every page", () => {
  for (const path of PAGES) {
    test(`${path} renders without errors or horizontal overflow`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(path);
      await expect(page.locator("header")).toBeVisible();
      await expect(page.locator("main")).not.toBeEmpty();
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
});

test("homepage hero, CTAs and illustrative label", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mine through");
  await expect(page.getByRole("link", { name: "Start Mining" })).toHaveAttribute("href", "/mine");
  await expect(page.getByRole("link", { name: "Explore Protocol" })).toHaveAttribute("href", "/protocol");
  await expect(page.getByText("ILLUSTRATIVE SIMULATION")).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("never shows fabricated protocol numbers when the program is not deployed", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByText(/not initialized on/);
  if (await banner.isVisible().catch(() => false)) {
    // Every protocol stat must be an em dash, not a zero.
    const stats = page.locator("text=Protocol state").locator("xpath=ancestor::div[contains(@class,'panel')]");
    await expect(stats).not.toContainText(/\b0\.00\b/);
  }
});

test("mine page: deposit is gated behind wallet connection and confirmation", async ({ page }) => {
  await page.goto("/mine");
  const cta = page.getByRole("button", { name: /Connect wallet to mine/ });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page.getByRole("dialog", { name: "Connect a Solana wallet" })).toBeVisible();
  await expect(page.getByText(/never asks for your seed phrase/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("docs include every required section", async ({ page }) => {
  await page.goto("/docs");
  for (const id of ["introduction", "science", "mining", "barriers", "commitments", "sol-rewards", "token-rewards", "rounds", "randomness", "contracts", "risks", "fees", "wallet-security", "tokenomics", "admin", "audit", "faq"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.getByText(/does not use\s+quantum hardware/i).first()).toBeVisible();
});

test("tokenomics shows the 400M as pending, not allocated", async ({ page }) => {
  await page.goto("/tokenomics");
  await expect(page.getByText(/Pending owner approval of final tokenomics/)).toBeVisible();
});

test("APIs respond with explicit availability flags", async ({ request }) => {
  for (const p of ["/api/stats", "/api/activity", "/api/rounds", "/api/leaderboard"]) {
    const r = await request.get(p);
    expect(r.ok()).toBe(true);
    expect(typeof (await r.json()).available).toBe("boolean");
  }
  expect((await request.get("/api/wallet/not-an-address")).status()).toBe(400);
  expect((await request.post("/api/auth/verify", { data: { address: "x" } })).status()).toBe(400);
});

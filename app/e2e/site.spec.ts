import { expect, test } from "@playwright/test";

const PAGES = ["/", "/accelerator", "/how-it-works", "/laboratory", "/leaderboard", "/tokenomics", "/history", "/history/cycle/0", "/admin"];

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

test("navigation has every section plus wallet and mining CTAs", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    const menu = page.getByRole("button", { name: "Menu" });
    // Retry until hydrated: a click before React attaches its handler does nothing.
    await expect(async () => {
      if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  }
  const nav = page.getByRole("navigation", { name: isMobile ? "Mobile" : "Primary" });
  for (const label of ["Accelerator", "How it works", "Laboratory", "Leaderboard", "Tokenomics", "History"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`${label}$`) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
});

test("hero: headline, CTAs and the visual-simulation label", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("MINE THROUGH");
  await expect(page.getByRole("link", { name: /Enter the accelerator/i }).first()).toHaveAttribute("href", "/accelerator");
  await expect(page.getByRole("link", { name: /Explore the protocol/i })).toHaveAttribute("href", "#protocol");
  await expect(page.getByText("VISUAL SIMULATION · NOT LIVE DATA")).toBeVisible();
  await expect(page.getByText("TUNNEL / QUANTUM EXPERIMENT 001").first()).toBeVisible();
});

test("accelerator: deploying is gated behind a wallet, and costs are stated", async ({ page }) => {
  await page.goto("/accelerator");
  await expect(page.getByText(/Free to mine/).first()).toBeVisible();
  const cta = page.getByRole("button", { name: /Connect wallet to deploy/ });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page.getByRole("dialog", { name: "Connect a Solana wallet" })).toBeVisible();
  await expect(page.getByText(/never asks for your seed phrase/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("accelerator: probabilities update from the configuration", async ({ page }) => {
  await page.goto("/accelerator");
  const prob = page.locator("dt", { hasText: "Tunneling probability" }).locator("xpath=following-sibling::dd[1]");
  await page.getByRole("radio", { name: /LOW/ }).click();
  await page.getByRole("radio", { name: /E5/ }).click();
  const low = await prob.innerText();
  await page.getByRole("radio", { name: /HIGH/ }).click();
  await page.getByRole("radio", { name: /E1/ }).click();
  const high = await prob.innerText();
  expect(parseFloat(low)).toBeGreaterThan(parseFloat(high));
});

test("laboratory: sliders drive the transmission readout", async ({ page }) => {
  await page.goto("/laboratory");
  const readout = page.locator("dt", { hasText: "Transmission T" }).locator("xpath=following-sibling::dd[1]");
  const before = await readout.innerText();
  await page.locator("#lab-a").fill("3");
  await expect(readout).not.toHaveText(before);
});

test("tokenomics labels unconfigured allocations as placeholders and lists risks", async ({ page }) => {
  await page.goto("/tokenomics");
  await expect(page.getByText(/PLACEHOLDER/).first()).toBeVisible();
  await expect(page.locator("#risks")).toContainText(/no guaranteed price/i);
  for (const id of ["the-token", "the-emissions", "the-energy", "the-physics", "the-randomness", "the-treasury", "risks"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
});

test("APIs respond with explicit availability flags and validate input", async ({ request }) => {
  for (const p of ["/api/stats", "/api/activity", "/api/cycles", "/api/experiments", "/api/leaderboard", "/api/lab"]) {
    const r = await request.get(p);
    expect(r.ok()).toBe(true);
    expect(typeof (await r.json()).available).toBe("boolean");
  }
  expect((await request.get("/api/wallet/not-an-address")).status()).toBe(400);
  expect((await request.get("/api/cycles/abc")).status()).toBe(400);
  expect((await request.post("/api/auth/verify", { data: { address: "x" } })).status()).toBe(400);
  expect((await request.get("/api/admin")).status()).toBe(401);
  expect([401, 409]).toContain((await request.post("/api/gatekeeper", { data: {} })).status());
});

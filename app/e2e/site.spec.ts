import { expect, test } from "@playwright/test";

const PAGES = ["/", "/accelerator", "/how-it-works", "/laboratory", "/leaderboard", "/tokenomics", "/history", "/history/bet/1", "/admin"];

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

test("navigation has every section plus wallet and play CTAs", async ({ page, isMobile }) => {
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

test("accelerator: 18+ gate, then play is gated behind a wallet", async ({ page }) => {
  await page.goto("/accelerator");
  await page.getByRole("button", { name: /I am 18\+/ }).click();
  const cta = page.getByRole("button", { name: /Connect wallet to play/ });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page.getByRole("dialog", { name: "Connect a Solana wallet" })).toBeVisible();
  await expect(page.getByText(/never asks for your seed phrase/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("practice: odds and totals follow the configuration, and a shot resolves", async ({ page }) => {
  await page.goto("/laboratory");
  const chance = page.locator("dt", { hasText: "Win chance" }).locator("xpath=following-sibling::dd[1]");
  await page.getByRole("radio", { name: /LOW/ }).click();
  await expect(chance).toHaveText("50%");
  await page.getByRole("radio", { name: /HIGH/ }).click();
  await expect(chance).toHaveText("5%");
  await page.getByRole("radio", { name: /E1/ }).click();
  await page.locator("#count").fill("4");
  const total = page.locator("dt", { hasText: "Total bet" }).locator("xpath=following-sibling::dd[1]");
  await expect(total).toHaveText("40");
  await page.getByRole("button", { name: /^Fire 4 particles/ }).click();
  await expect(page.getByText(/tunneled\s+\d\/4/i).first()).toBeVisible({ timeout: 30_000 });
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
  for (const id of ["the-token", "the-vault", "the-shots", "the-fairness", "the-practice", "the-limits", "risks"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
});

test("APIs respond with explicit availability flags and validate input", async ({ request }) => {
  for (const p of ["/api/casino", "/api/casino/bets", "/api/casino/leaderboard", "/api/state", "/api/stats", "/api/activity", "/api/cycles", "/api/experiments", "/api/leaderboard", "/api/lab"]) {
    const r = await request.get(p);
    expect(r.ok()).toBe(true);
    expect(typeof (await r.json()).available).toBe("boolean");
  }
  expect((await request.get("/api/wallet/not-an-address")).status()).toBe(400);
  expect((await request.get("/api/cycles/abc")).status()).toBe(400);
  expect((await request.post("/api/auth/verify", { data: { address: "x" } })).status()).toBe(400);
  expect((await request.get("/api/admin")).status()).toBe(401);
  expect((await request.post("/api/admin", { data: { action: "pause" } })).status()).toBe(401);
  expect((await request.get("/api/me?wallet=nope")).status()).toBe(400);
  // Signed endpoints reject anything that is not a valid, signed TUNNEL message.
  expect((await request.post("/api/deploy", { data: {} })).status()).toBe(400);
  expect((await request.post("/api/deploy", { data: { message: "TUNNEL — deploy particles", signature: "x" } })).status()).toBe(400);
  expect((await request.post("/api/claim", { data: { message: "hello", signature: "x" } })).status()).toBe(400);
  // Betting needs a signed-in wallet session; withdrawals need a valid signed message.
  expect((await request.post("/api/casino/bet", { data: { volatility: 0, amount: "1000000", count: 1 } })).status()).toBe(401);
  expect((await request.get("/api/casino/me")).status()).toBe(401);
  expect((await request.post("/api/casino/withdraw", { data: { message: "x", signature: "y" } })).status()).toBe(400);
});

test("the open cycle never exposes its secret seed", async ({ request }) => {
  const body = await (await request.get("/api/state")).json();
  test.skip(!body.available, "database not available");
  for (const c of body.data.recent) {
    if (c.status === "open" || c.status === "closed") expect(c.serverSeed).toBeNull();
    else expect(typeof c.serverSeed).toBe("string");
    expect(c.seedCommitment).toMatch(/^[0-9a-f]{64}$/);
  }
});

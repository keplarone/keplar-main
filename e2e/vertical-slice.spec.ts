import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function expectAccessible(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${context}: ${v.id} (${v.nodes.length}) ${v.help}`)).toEqual([]);
}

async function signUp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectAccessible(page, "sign-in");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  await page.getByLabel("Password").fill("a long and memorable passphrase");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "What do you want accomplished?" })).toBeVisible();
}

test("a goal becomes a plan, runs after approval, is verified and produces a receipt", async ({ page }) => {
  const csp: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) csp.push(m.text());
  });
  await signUp(page);
  await expectAccessible(page, "composer");
  await shot(page, "01-composer");

  await page.getByLabel("Your goal").fill("Write a launch plan for a weekend pottery workshop series");
  await page.getByRole("button", { name: /Plan it/ }).click();

  await expect(page.getByRole("heading", { name: "Your approval" })).toBeVisible();
  await expect(page.getByText("Nothing has run yet.")).toBeVisible();
  await expect(page.getByText("Needs your approval").first()).toBeVisible();
  await expectAccessible(page, "approval");
  await shot(page, "02-plan-awaiting-approval");

  await page.getByRole("button", { name: "Approve and run" }).click();
  // The worker is a separate process; the page only polls.
  await expect(page.getByRole("main").getByText("Completed and verified").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Outcome receipt" })).toBeVisible();
  await expect(page.getByText("Receipt digest checked in your browser")).toBeVisible();
  await expect(page.getByText(/1 of 1 step verified/)).toBeVisible();
  await page.getByText(/checks passed/).first().click();
  await expect(page.getByText(/matches its recorded SHA-256 digest/)).toBeVisible();
  await expectAccessible(page, "receipt");
  await shot(page, "03-completed-receipt");

  await page.getByRole("button", { name: /brief\.md/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "brief.md" })).toBeVisible();
  await expect(dialog.getByText("Digest checked in your browser")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Objective" })).toBeVisible();
  await expectAccessible(page, "artifact dialog");
  await shot(page, "04-artifact");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // History lists the execution, and credits reflect the actual charge (5 − 0.3).
  await expect(page.getByRole("navigation", { name: "Goal history" }).getByText("Write a launch plan")).toBeVisible();
  await expect(page.getByText(/4\.7\s*of 5 credits/)).toBeVisible();

  // The credit meter opens usage, built from the ledger and verified steps.
  await page.getByRole("link", { name: /4\.7\s*of 5 credits/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "0.3 credits used this period" })).toBeFocused();
  const capabilities = page.getByRole("region", { name: "Where credits went" });
  await expect(capabilities.getByRole("row", { name: /Write a document\s+1\s+0\.3/ })).toBeVisible();
  await expect(page.getByText(/No AI model was called this period/)).toBeVisible();
  const ledger = page.getByRole("region", { name: "Credit ledger" });
  await expect(ledger.getByRole("row", { name: /Charged · Write a launch plan/ })).toBeVisible();
  await expect(ledger.getByRole("row", { name: /Monthly grant/ })).toBeVisible();
  await expectAccessible(page, "usage");
  await shot(page, "07-usage");
  await ledger.getByRole("link", { name: /Write a launch plan/ }).first().click();
  await expect(page.getByRole("heading", { name: "Outcome receipt" })).toBeVisible();
  expect(csp).toEqual([]);
});

test("capability gaps are stated up front and left for the user in the receipt", async ({ page }) => {
  await signUp(page);
  await page.getByLabel("Your goal").fill("Book a table for six at a quiet restaurant near the office on Friday");
  await page.getByRole("button", { name: /Plan it/ }).click();
  await expect(page.getByRole("heading", { name: "Some of this Keplar can't do yet" })).toBeVisible();
  await expect(page.getByText(/Booking or reserving services/).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve and run" }).click();
  await expect(page.getByRole("main").getByText("Partly completed").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Left for you" })).toBeVisible();
  await expect(page.getByText(/Book it directly with the provider/).last()).toBeVisible();
  await expectAccessible(page, "gap receipt");
  await shot(page, "05-capability-gap");
});

test("works at phone width without horizontal scrolling, in dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await signUp(page);
  await page.getByLabel("Your goal").fill("Make a checklist for moving into a new apartment next month");
  await page.getByRole("button", { name: /Plan it/ }).click();
  await expect(page.getByRole("button", { name: "Approve and run" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page, "mobile dark approval");
  await shot(page, "06-mobile-dark-approval");
  await page.getByRole("button", { name: "Approve and run" }).click();
  await expect(page.getByRole("main").getByText("Completed and verified").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Show history" }).click();
  await expect(page.getByRole("navigation", { name: "Goal history" }).getByText("Make a checklist")).toBeVisible();
  await expectAccessible(page, "mobile dark history");

  await page.getByRole("link", { name: "Usage and credits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /credits used this period/ })).toBeVisible();
  const usageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(usageOverflow).toBeLessThanOrEqual(0);
  await expectAccessible(page, "mobile dark usage");
  await shot(page, "08-mobile-dark-usage");
});

test("keyboard users can skip to content and submit with Ctrl+Enter", async ({ page }) => {
  await signUp(page);
  // The composer autofocuses its input. The skip link is the first focusable element before it.
  for (let i = 0; i < 12; i++) {
    if (await page.getByRole("link", { name: "Skip to content" }).evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Shift+Tab");
  }
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.getByLabel("Your goal").fill("Write a one-page memo about our volunteer onboarding process");
  await page.getByLabel("Your goal").press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Your approval" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("signed-out visitors cannot read executions", async ({ page, request }) => {
  const res = await request.get("/api/v1/executions");
  expect(res.status()).toBe(401);
  await page.goto("/e/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

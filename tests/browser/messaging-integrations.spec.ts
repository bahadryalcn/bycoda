import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "temp/verification/2026-11-07-integrations-messaging";
const fixture = "/tests/browser/messaging-integrations.html";
const themes = ["light", "dark"] as const;
const widths = [1280, 800] as const;

async function capture(page: Page, name: string, fullPage = true) {
  // Park the pointer so hover fills do not read as surface colors.
  await page.mouse.move(0, 0);
  // No surface may scroll the window sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} overflows horizontally`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${captures}/${name}.png`, fullPage, animations: "disabled" });
}

async function openSettings(page: Page, tab: string, theme: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${fixture}?view=settings&tab=${tab}&theme=${theme}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("tab", { name: "Email" })).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(captures, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const theme of themes) {
  for (const width of widths) {
    const suffix = `${theme}-${width}`;

    test(`integrations email accounts and form (${suffix})`, async ({ page }) => {
      await openSettings(page, "email", theme, width);
      const panel = page.getByRole("tabpanel", { name: "Email" });
      await expect(panel.getByText("work@example.com · Outlook")).toBeVisible();
      await expect(panel.getByText("me@example.org · Gmail")).toBeVisible();
      await capture(page, `a-email-list-${suffix}`);

      await panel.getByRole("button", { name: "Add account" }).click();
      await expect(panel.getByRole("button", { name: /Provider: Gmail/ })).toBeVisible();
      await panel.getByLabel("Email address").fill("new.person@example.com");
      await expect(panel.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
      await expect(panel.getByText("Can't sign in with Google?")).toBeVisible();
      await capture(page, `b-email-form-${suffix}`);
      await panel.getByRole("button", { name: "Advanced" }).click();
      await expect(panel.getByLabel("IMAP server")).toHaveValue("imap.gmail.com");
      await capture(page, `b-email-form-servers-${suffix}`);
    });

    test(`integrations slack (${suffix})`, async ({ page }) => {
      await openSettings(page, "slack", theme, width);
      const panel = page.getByRole("tabpanel", { name: "Slack" });
      await expect(panel.getByText("Acme", { exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "Add workspace" }).click();
      await expect(panel.getByRole("button", { name: "Sign in with Slack" })).toBeVisible();
      await panel.getByRole("button", { name: "Advanced" }).click();
      await panel.getByRole("switch", { name: "Use a bot token instead" }).click();
      await panel.getByRole("button", { name: "How to get a bot token" }).click();
      await expect(panel.getByText("channels:read", { exact: false })).toBeVisible();
      await capture(page, `c-slack-${suffix}`);
    });

    test(`integrations offer only email and Slack (${suffix})`, async ({ page }) => {
      await openSettings(page, "email", theme, width);
      await expect(page.getByRole("tab", { name: "Slack" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Discord" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Microsoft Teams" })).toHaveCount(0);
    });

    test(`messages list and thread (${suffix})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${fixture}?view=messages&theme=${theme}`, { waitUntil: "domcontentloaded" });
      const list = page.getByRole("list", { name: "Conversations" });
      await expect(list.getByRole("button", { name: /Q4 roadmap review/ })).toBeVisible();
      await expect(page.getByText(/Could not refresh Archive/)).toBeVisible();
      if (width === 800) await capture(page, `g-messages-list-${suffix}`, false);
      await list.getByRole("button", { name: /Q4 roadmap review/ }).click();
      const thread = page.getByRole("region", { name: "Q4 roadmap review — action items" });
      // Direct items only; attachment chips are nested list items.
      await expect(
        thread.getByRole("list", { name: "Messages" }).locator(":scope > li"),
      ).toHaveCount(5);
      await expect(page.getByRole("textbox", { name: "Reply" })).toHaveValue(/timeline works/);
      await capture(
        page,
        width === 800 ? `g-messages-detail-${suffix}` : `f-messages-${suffix}`,
        false,
      );
    });
  }
}

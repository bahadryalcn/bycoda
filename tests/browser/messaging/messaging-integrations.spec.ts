import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "temp/verification/2026-11-07-integrations-messaging";
const fixture = "/tests/browser/messaging/messaging-integrations.html";
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
  await expect(page.getByRole("button", { name: /^Services: (Email|Slack)$/ })).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(captures, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Fixture messages are dated relative to now (22 h to 4 min ago). Pin the clock to mid
  // afternoon so they always split into "Yesterday" and "Today", whatever time CI runs;
  // timers keep running.
  await page.clock.setFixedTime(new Date(2026, 10, 16, 15, 0, 0));
});

for (const theme of themes) {
  for (const width of widths) {
    const suffix = `${theme}-${width}`;

    test(`integrations email accounts and form (${suffix})`, async ({ page }) => {
      await openSettings(page, "email", theme, width);
      const panel = page.getByRole("region", { name: "Connection" });
      await expect(panel.getByText("work@example.com · Outlook")).toBeVisible();
      await expect(panel.getByText("me@example.org · Gmail")).toBeVisible();
      await capture(page, `a-email-list-${suffix}`);

      await panel.getByRole("button", { name: "Add account" }).click();
      await expect(panel.getByRole("button", { name: /Provider: Gmail/ })).toBeVisible();
      await panel.getByLabel("Email address").fill("new.person@example.com");
      await expect(panel.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
      await expect(
        panel.getByRole("switch", { name: "Use an app password instead" }),
      ).toBeVisible();
      await capture(page, `b-email-form-${suffix}`);
      await expect(panel.getByLabel("IMAP server")).toHaveValue("imap.gmail.com");
      await capture(page, `b-email-form-servers-${suffix}`);
    });

    test(`integrations slack (${suffix})`, async ({ page }) => {
      await openSettings(page, "slack", theme, width);
      const panel = page.getByRole("region", { name: "Connection" });
      await expect(panel.getByText("Acme", { exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "Add workspace" }).click();
      await expect(panel.getByRole("button", { name: "Sign in with Slack" })).toBeVisible();
      await panel.getByRole("switch", { name: "Use a bot token instead" }).click();
      await expect(panel.getByText("channels:read", { exact: false })).toBeVisible();
      await capture(page, `c-slack-${suffix}`);
    });

    test(`integrations offer only email and Slack (${suffix})`, async ({ page }) => {
      await openSettings(page, "email", theme, width);
      await page.getByRole("button", { name: /^Services:/ }).click();
      await expect(page.getByRole("option", { name: "Email", exact: true })).toBeVisible();
      await expect(page.getByRole("option", { name: "Slack", exact: true })).toBeVisible();
      await expect(page.getByRole("option", { name: "Discord" })).toHaveCount(0);
      await expect(page.getByRole("option", { name: "Microsoft Teams" })).toHaveCount(0);
    });

    test(`messages list and thread (${suffix})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${fixture}?view=messages&theme=${theme}`, { waitUntil: "domcontentloaded" });
      const list = page.getByRole("list", { name: "Conversations" });
      await expect(list.getByRole("button", { name: /Q4 roadmap review/ })).toBeVisible();
      await expect(page.getByText(/Could not refresh Archive/)).toBeVisible();
      if (width === 800) await capture(page, `g-messages-list-${suffix}`, false);
      await list.getByRole("button", { name: /Q4 roadmap review/ }).click();
      const thread = page.getByRole("region", { name: "Q4 roadmap review — action items" });
      // Direct items only (attachment chips are nested list items): five messages plus the
      // day separators ("Yesterday", "Today") the shared timeline renders as list items.
      const items = thread.getByRole("list", { name: "Messages" }).locator(":scope > li");
      await expect(items.filter({ has: page.locator('div[dir="auto"]') })).toHaveCount(5);
      await expect(items).toHaveCount(7);
      await expect(page.getByRole("textbox", { name: "Reply" })).toHaveValue(/timeline works/);
      const bubbles = thread.locator('li > div[dir="auto"]');
      await expect(bubbles).toHaveCount(5);
      // Both directions wear the shared transcript bubble skin; ownership is alignment.
      for (const index of [0, 1]) {
        const appearance = await bubbles.nth(index).evaluate((element) => {
          const actual = getComputedStyle(element);
          const probe = document.createElement("div");
          probe.style.background = "var(--ui-message-bubble)";
          probe.style.borderRadius = "var(--ui-radius-popup)";
          element.append(probe);
          const expected = getComputedStyle(probe);
          const result = {
            actual: [
              actual.backgroundColor,
              actual.borderEndStartRadius,
              actual.borderEndEndRadius,
            ],
            expected: [
              expected.backgroundColor,
              expected.borderEndStartRadius,
              expected.borderEndEndRadius,
            ],
          };
          probe.remove();
          return result;
        });
        const message = bubbles.nth(index).locator("xpath=..");
        if (index === 1) await expect(message).toHaveAttribute("data-own", "true");
        else await expect(message).not.toHaveAttribute("data-own", /.*/);
        expect(appearance.actual).toEqual(appearance.expected);
      }
      await page.screenshot({
        path: testInfo.outputPath("message-bubbles.png"),
        animations: "disabled",
      });
      await capture(
        page,
        width === 800 ? `g-messages-detail-${suffix}` : `f-messages-${suffix}`,
        false,
      );
    });
  }
}

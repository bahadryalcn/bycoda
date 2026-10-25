import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

type Fixture = {
  calls: string[];
  hold: (name: string) => void;
  finish: (name: string, message?: string) => void;
};
const fixture = async (page: Page, method: "hold" | "finish", name: string, error?: string) =>
  page.evaluate(
    ({ method, name, error }) =>
      (window as unknown as { operationalFixture: Fixture }).operationalFixture[method](
        name,
        error,
      ),
    { method, name, error },
  );
const evidence = "temp/verification/2026-10-25-apple-ui/operational-tools";

test("device controls show pending only at the initiating action and recover from capture errors", async ({
  page,
}) => {
  await page.goto("/tests/browser/operational-tools.html");
  await expect(page.getByRole("img", { name: "Current device screen" })).toBeVisible();
  await page.getByRole("switch", { name: "Live view", exact: true }).click();
  await fixture(page, "hold", "add");
  const add = page.getByRole("button", { name: "Add device to conversation", exact: true });
  await add.click();
  await expect(add).toHaveAttribute("aria-busy", "true");
  await expect(add).toBeFocused();
  await expect(page.locator("button[aria-busy=true]")).toHaveCount(1);
  await expect(page.getByText("Working on the host…", { exact: true })).toHaveCount(0);
  await fixture(page, "finish", "add");
  await expect(add).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status")).toContainText("Device added to draft.");
  await fixture(page, "hold", "capture");
  const capture = page.getByRole("button", { name: "Capture", exact: true });
  await capture.click();
  await expect(capture).toHaveAttribute("aria-busy", "true");
  await fixture(page, "finish", "capture", "Device screenshot exceeds 4 MiB");
  await expect(page.getByRole("alert")).toContainText("Device screenshot exceeds 4 MiB");
  await expect(page.getByText("Could not load devices", { exact: true })).toHaveCount(0);
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("server details, logs and startup retain local pending feedback and clear failed startup state", async ({
  page,
}) => {
  await page.goto("/tests/browser/operational-tools.html?tool=servers");
  const details = page.getByRole("button", { name: "Process details", exact: true });
  await expect(details).toBeVisible();
  await fixture(page, "hold", "devServers.details");
  await details.click();
  await expect(details).toHaveAttribute("aria-busy", "true");
  await expect(details).toBeFocused();
  await expect(page.getByRole("button", { name: "Open in preview", exact: true })).toBeEnabled();
  await fixture(page, "finish", "devServers.details");
  await expect(details).not.toHaveAttribute("aria-busy", "true");
  await fixture(page, "hold", "devServers.logs");
  const logs = page.getByRole("button", { name: "Show logs", exact: true });
  await logs.click();
  await expect(logs).toHaveAttribute("aria-busy", "true");
  await fixture(page, "finish", "devServers.logs");
  await expect(page.getByLabel("Server logs")).toContainText("Ready on port 3000");
  await page.getByRole("button", { name: "Start server", exact: true }).click();
  await page.getByLabel("Server name", { exact: true }).fill("Second server");
  await page.getByLabel("Server command", { exact: true }).fill("pnpm dev");
  await fixture(page, "hold", "devServers.start");
  const start = page.getByRole("button", { name: "Start command", exact: true });
  await start.click();
  await expect(start).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Starting", { exact: true })).toHaveCount(0);
  await fixture(page, "finish", "devServers.start", "Fixture host is unavailable");
  await expect(start).not.toHaveAttribute("aria-busy", "true");
  await expect(start).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("Fixture host is unavailable");
  await expect(page.getByLabel("Server name", { exact: true })).toHaveValue("Second server");
});

test("device help remains keyboard accessible and preserves input drafts", async ({ page }) => {
  await page.goto("/tests/browser/operational-tools.html");
  await page.getByRole("switch", { name: "Allow device control" }).click();
  await page.getByLabel("App name or bundle ID", { exact: true }).fill("com.example.app");
  const help = page.getByRole("button", { name: "Help", exact: true });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/Android text input supports printable ASCII/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await expect(page.getByLabel("App name or bundle ID", { exact: true })).toHaveValue(
    "com.example.app",
  );
  await fixture(page, "hold", "press");
  await page.getByRole("img", { name: "Current device screen" }).click();
  await expect(page.getByRole("progressbar", { name: "Working on the host…" })).toBeVisible();
  await fixture(page, "finish", "press");
  await expect(page.getByRole("progressbar", { name: "Working on the host…" })).toHaveCount(0);
});

test("long translated controls fit a narrow panel at increased text scale", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/tests/browser/operational-tools.html?lang=de&theme=light");
  await page.getByRole("switch", { name: "Gerätesteuerung erlauben" }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "125%";
  });
  await expect(page.locator(".device-panel-manual")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Schnappschuss der Barrierefreiheit" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/devices-de-390-large-text.png`, fullPage: true });
});

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1280]) {
    test(`operational tools fit ${theme} ${width}px with all actions reachable`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mkdir(evidence, { recursive: true });
      for (const tool of ["devices", "servers"]) {
        await page.goto(`/tests/browser/operational-tools.html?tool=${tool}&theme=${theme}`);
        if (tool === "devices") {
          await expect(page.getByRole("img")).toBeVisible();
          await page.getByRole("switch", { name: "Allow device control" }).click();
          await expect(page.getByRole("button", { name: "Open app", exact: true })).toBeVisible();
        } else {
          await expect(
            page.getByRole("button", { name: "Process details", exact: true }),
          ).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `${evidence}/${tool}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
      expect(errors).toEqual([]);
    });
  }
}

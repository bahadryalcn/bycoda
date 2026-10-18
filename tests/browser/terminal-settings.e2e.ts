import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const width of [390, 1440]) {
  test(`Turkish terminal settings and shell search: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/settings.html?section=terminal&terminal=1&theme=dark&lang=tr");
    const terminal = page.locator(".terminal-settings");
    await expect(
      terminal.getByRole("heading", {
        name: "Senkronize oturumlar ve uzak sunucular",
        exact: true,
      }),
    ).toBeVisible();
    await terminal.locator("#setting-terminal-default-profile button").click();
    await page.getByRole("dialog").getByRole("combobox").fill("Git");
    await page.getByRole("option", { name: /Git Bash/ }).click();
    await expect(terminal.locator("#setting-terminal-default-profile button")).toContainText(
      "Git Bash",
    );
    await page.locator("[data-settings-scroller]").evaluate((node) => {
      node.scrollTop = 0;
    });
    mkdirSync("temp/verification/2026-10-18-terminal-settings", { recursive: true });
    await page.screenshot({
      path: `temp/verification/2026-10-18-terminal-settings/tr-dark-${width}.png`,
    });
    await expect
      .poll(() => terminal.evaluate((root) => root.scrollWidth <= root.clientWidth + 1))
      .toBe(true);
  });
}

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`terminal settings: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `/tests/browser/settings.html?section=terminal&terminal=1&theme=${theme}&lang=en`,
      );
      const terminal = page.locator(".terminal-settings");
      const local = terminal.getByRole("button", { name: /^Default terminal profile:/ });
      const sync = terminal.getByRole("button", {
        name: /^Default shell on this computer \(local sync\):/,
      });
      const remote = terminal.getByRole("button", {
        name: /^Default shell on remote server Development server with a long descriptive name:/,
      });
      for (const control of [local, sync, remote]) await expect(control).toBeVisible();
      await expect(terminal.locator("details, summary")).toHaveCount(0);
      await local.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("option", { name: /Git Bash/ }).click();
      await expect(local).toContainText("Git Bash");
      await expect(sync).toContainText("Automatic");
      await sync.click();
      await page.getByRole("option", { name: /Command Prompt/ }).click();
      await remote.click();
      await page.getByRole("option", { name: /WSL/ }).click();
      await page.reload();
      await expect(local).toContainText("Git Bash");
      await expect(sync).toContainText("Command Prompt");
      await expect(remote).toContainText("WSL");
      await remote.click();
      await page.getByRole("option", { name: /Automatic/ }).click();
      await expect(remote).toContainText("Automatic");
      const installed = terminal.getByRole("region", {
        name: "This computer · Available shells",
        exact: true,
      });
      const bash = installed.locator(".settings-row").filter({ hasText: "Git Bash" });
      await expect(bash.getByText("Default", { exact: true })).toBeVisible();
      await installed
        .locator(".settings-row")
        .filter({ hasText: "Command Prompt" })
        .getByRole("button", { name: "Set as default" })
        .click();
      await expect(local).toContainText("Command Prompt");
      await terminal.getByRole("button", { name: "Look again", exact: true }).click();
      await expect(local).toBeEnabled();
      expect(await page.evaluate(() => Number(sessionStorage.getItem("fixture-shell-scans")))).toBe(
        3,
      );
      expect(
        await terminal.evaluate((root) =>
          [
            ...root.querySelectorAll(
              ".settings-row, .settings-group-heading, .settings-row-control",
            ),
          ]
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => node.className),
        ),
      ).toEqual([]);

      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      mkdirSync("temp/verification/2026-10-18-terminal-settings", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-18-terminal-settings/${theme}-${width}.png`,
      });
      expect(errors).toEqual([]);
    });
  }

test("terminal shell discovery recovery and empty or missing profiles", async ({ page }) => {
  await page.goto("/tests/browser/settings.html?section=terminal&terminal=discovery-error&lang=en");
  const terminal = page.locator(".terminal-settings");
  await expect(terminal.getByRole("alert")).toContainText("Could not discover shells");
  await terminal.getByRole("button", { name: "Look again", exact: true }).click();
  await expect(terminal.getByRole("alert")).toHaveCount(0);
  await page.goto("/tests/browser/settings.html?section=terminal&terminal=missing&lang=en");
  await expect(
    terminal.getByText(
      "The shell you picked is no longer installed, so the system default is used.",
    ),
  ).toBeVisible();
  await page.goto("/tests/browser/settings.html?section=terminal&terminal=empty&lang=en");
  await expect(
    terminal.getByText("Connect a machine in Connections to configure its default shell here."),
  ).toBeVisible();

  await expect(terminal.getByText("No shells found", { exact: true })).toBeVisible();
});

test("host discovery retries and save errors preserve the previous shell", async ({ page }) => {
  await page.goto("/tests/browser/settings.html?section=terminal&terminal=host-error&lang=en");
  const hosts = page.locator("#setting-host-shells");
  await expect(hosts.getByRole("alert")).toContainText("Fixture host unavailable");
  await hosts.getByRole("button", { name: "Retry", exact: true }).click();
  const remote = hosts.getByRole("button", {
    name: /^Default shell on remote server Development server with a long descriptive name:/,
  });
  await expect(remote).toBeVisible();
  await page.goto("/tests/browser/settings.html?section=terminal&terminal=save-error&lang=en");
  await remote.click();
  await page.getByRole("option", { name: /Git Bash/ }).click();
  await expect(hosts.getByRole("alert")).toContainText("Fixture shell save failed");
  await expect(remote).toContainText("Automatic");
  await expect(remote).toBeEnabled();
});

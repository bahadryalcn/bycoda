import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`external MCP lifecycle ${theme} ${width}`, async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/external-mcp.html?theme=${theme}`);
      await expect(page.getByText("Previously revoked")).toBeVisible();
      const create = page.getByRole("button", { name: "Create token", exact: true });
      await create.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("textbox", { name: "Token name" })).toBeFocused();
      await dialog
        .getByRole("textbox", { name: "Token name" })
        .fill("A long client access token name to check narrow layout containment");
      await dialog.getByRole("spinbutton").fill("367");
      await dialog.getByRole("button", { name: "Create token", exact: true }).click();
      await expect(page.locator("body")).not.toHaveAttribute("data-creates");
      await dialog.getByRole("spinbutton").fill("366");
      // Submit twice synchronously, before React commits its loading render.
      await dialog.locator("form").evaluate((form) => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await expect(page.locator("body")).toHaveAttribute("data-creates", "1");
      const token = dialog.getByRole("textbox", { name: "Token", exact: true });
      await expect(token).toHaveValue("synthetic-secret-do-not-render");
      await dialog.getByRole("button", { name: "Copy token", exact: true }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "synthetic-secret-do-not-render",
      );
      const grant = JSON.parse((await page.locator("body").getAttribute("data-grant"))!);
      expect(grant.projectId).toBe("project");
      expect(grant.scopes).toEqual({ conversation: ["read"] });
      expect(grant.expiresAt - Date.now()).toBeGreaterThan(365 * 86400_000);
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(create).toBeFocused();
      expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
        "synthetic-secret",
      );
      expect(page.url()).not.toContain("synthetic-secret");
      await page.getByRole("button", { name: "MCP connection examples" }).click();
      await expect(page.getByRole("dialog")).toContainText("http://127.0.0.1:47321/mcp");
      await page.getByRole("button", { name: "Copy Codex example" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
        'bearer_token_env_var = "BYCODA_MCP_TOKEN"',
      );
      await page.getByRole("button", { name: "Copy Claude Code example" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
        "Bearer ${BYCODA_MCP_TOKEN}",
      );
      await page.keyboard.press("Escape");
      const revoke = page.getByRole("button", { name: "Revoke token" });
      await revoke.click();
      await expect(page.locator("body")).toHaveAttribute("data-confirmations", "1");
      await expect(page.locator("body")).not.toHaveAttribute("data-revokes");
      await page.evaluate(() => {
        document.body.dataset.confirm = "yes";
      });
      await revoke.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await expect(page.locator("body")).toHaveAttribute("data-revokes", "1");
      await expect(revoke).toHaveCount(0);
      await expect(page.getByText("Revoked", { exact: false })).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      mkdirSync("temp/verification/2026-10-16-external-mcp", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-16-external-mcp/${theme}-${width}.png`,
      });
    });
  }

test("RPC errors cannot reveal secrets and the form can recover", async ({ page }) => {
  await page.goto("/tests/browser/external-mcp.html");
  await page.getByRole("button", { name: "Create token", exact: true }).click();
  await page.getByRole("textbox", { name: "Token name" }).fill("Client");
  await page.evaluate(() => {
    document.body.dataset.fail = "create";
  });
  await page.getByRole("dialog").getByRole("button", { name: "Create token" }).click();
  await expect(page.getByRole("alert")).toContainText("Token creation failed");
  await expect(page.locator("body")).not.toContainText("synthetic-secret");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Create token" }),
  ).not.toHaveAttribute("aria-busy", "true");
});

test("scope choices, Turkish copy and keyboard selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/browser/external-mcp.html?lang=tr&theme=dark");
  await expect(page.getByRole("heading", { name: "Dış MCP erişimi" })).toBeVisible();
  await page.getByRole("button", { name: "Token oluştur", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Token adı" }).fill("Claude ve Codex");
  const choose = async (group: string, option: string) => {
    await dialog.getByRole("button", { name: new RegExp(`^${group}:`) }).focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await choose("conversation", "Erişim yok");
  await dialog.getByRole("button", { name: "Token oluştur", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("en az bir yetki");
  await expect(page.locator("body")).not.toHaveAttribute("data-creates");
  await choose("conversation", "Okuma ve yazma");
  await choose("runtime-logs", "Okuma");
  await choose("social", "Yazma");
  // Let the shared select's outgoing label finish before visual capture.
  await expect(
    dialog.getByRole("button", { name: "social: Yazma", exact: true }),
  ).not.toContainText("Erişim yok");
  mkdirSync("temp/verification/2026-10-16-external-mcp", { recursive: true });
  await page.screenshot({ path: "temp/verification/2026-10-16-external-mcp/tr-dark-form.png" });
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await dialog.getByRole("button", { name: "Token oluştur", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Token", exact: true })).toBeVisible();
  const grant = JSON.parse((await page.locator("body").getAttribute("data-grant"))!);
  expect(grant.scopes).toEqual({
    conversation: ["read", "write"],
    "runtime-logs": ["read"],
    social: ["write"],
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "MCP bağlantı örnekleri" }).click();
  await expect(page.getByRole("dialog")).toContainText("BYCODA_MCP_TOKEN");
  await expect
    .poll(() =>
      page.getByRole("dialog").evaluate((node) => {
        for (let element: Element | null = node; element; element = element.parentElement) {
          if (Number(getComputedStyle(element).opacity) < 1) return false;
        }
        return true;
      }),
    )
    .toBe(true);
  await page.screenshot({ path: "temp/verification/2026-10-16-external-mcp/tr-dark-help.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

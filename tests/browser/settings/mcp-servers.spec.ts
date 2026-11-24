import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = "temp/verification/mcp-redesign";
const profileOut = "temp/verification/mcp-account-profile";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`MCP account identity ${theme} ${width}`, async ({ page }) => {
      mkdirSync(profileOut, { recursive: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/settings/mcp-servers.html?theme=${theme}`);
      await page.getByRole("button", { name: "Open linear" }).click();
      const detail = page.getByRole("dialog", { name: "linear" });
      const profile = detail.getByText("workspace-owner@example.test", { exact: true });
      await expect(profile).toBeVisible();
      await expect(
        detail.getByRole("button", { name: "Sign in again", exact: true }),
      ).toBeVisible();
      await expect(
        detail.getByText("Account information unavailable", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `${profileOut}/${theme}-${width}.png` });
      await detail.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(profile).toHaveCount(0);
      await expect(detail.getByText("Not signed in", { exact: true })).toBeVisible();
    });

test("MCP without a profile keeps the signed-in state", async ({ page }) => {
  await page.goto("/tests/browser/settings/mcp-servers.html?noProfile");
  await page.getByRole("button", { name: "Open linear" }).click();
  const detail = page.getByRole("dialog", { name: "linear" });
  await expect(detail.getByText("Signed in", { exact: true })).toBeVisible();
  await expect(detail.getByText("Account information unavailable", { exact: true })).toHaveCount(2);
});

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`MCP servers ${theme} ${width}`, async ({ page }) => {
      mkdirSync(out, { recursive: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/settings/mcp-servers.html?theme=${theme}`);
      const list = page.getByRole("region", { name: "MCP servers" });
      // One row per server name: blender and firebase come from two providers but list once.
      await expect(list.getByRole("button", { name: "Open blender" })).toHaveCount(1);
      await expect(list.getByRole("button", { name: "Open firebase" })).toHaveCount(1);
      // Plugin-only servers from the Host inventory are listed too.
      await expect(list.getByRole("button", { name: "Open stripe" })).toBeVisible();
      await expect(list.getByRole("button", { name: "Open notion" })).toBeVisible();
      await page.screenshot({ path: `${out}/list-${theme}-${width}.png`, fullPage: true });

      await list.getByRole("button", { name: "Open firebase" }).click();
      const sheet = page.getByRole("dialog", { name: "firebase" });
      await expect(
        sheet.getByRole("switch", { name: /Start firebase with every session/ }),
      ).toBeChecked();
      const editors = sheet.getByRole("textbox");
      // Provider JSON loads only when its disclosure opens; one editor per provider entry.
      await expect(editors).toHaveCount(0);
      const disclosures = sheet.getByText("Edit provider JSON", { exact: true });
      await expect(disclosures).toHaveCount(2);
      for (const disclosure of await disclosures.all()) await disclosure.click();
      await expect(editors).toHaveCount(2);
      await editors
        .first()
        .fill('{\n  "command": "npx",\n  "args": ["-y", "firebase-tools", "mcp"]\n}');
      await sheet.getByRole("button", { name: "Save" }).first().click();
      await expect(sheet.getByRole("button", { name: "Save" }).first()).toBeDisabled();
      await page.screenshot({ path: `${out}/detail-${theme}-${width}.png` });

      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      const notion = list.getByRole("button", { name: "Open notion" });
      const row = notion.locator("..");
      await notion.hover();
      await row.getByRole("button", { name: "Sign in" }).click();
      await page.mouse.move(1, 1);
      const listCancel = row.getByRole("button", { name: "Cancel" });
      await expect(listCancel).toBeVisible();
      await page.screenshot({ path: `${out}/cancel-list-${theme}-${width}.png` });
      await listCancel.click();
      await expect(row.getByRole("button", { name: "Sign in" })).toBeEnabled();

      await notion.click();
      const notionSheet = page.getByRole("dialog", { name: "notion" });
      const signIn = notionSheet.getByRole("button", { name: "Sign in", exact: true });
      await signIn.click();
      const detailCancel = notionSheet.getByRole("button", { name: "Cancel", exact: true });
      await expect(detailCancel).toBeVisible();
      await page.screenshot({ path: `${out}/cancel-detail-${theme}-${width}.png` });
      await detailCancel.click();
      await expect(signIn).toBeEnabled();
    });

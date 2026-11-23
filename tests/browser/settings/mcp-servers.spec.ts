import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = "temp/verification/mcp-redesign";

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

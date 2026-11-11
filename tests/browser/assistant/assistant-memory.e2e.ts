import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Production Memory controls, synthetic Host storage; no native or provider proof.
const output = "temp/verification/2026-11-04-assistant-memory";
const original = "Let me finish speaking before you reply.";
const added = "Keep recovery evidence beside every delivered task.";
const edited = "Keep recovery evidence beside every delivered task. Preserve cancellation state.";
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(output, `${name}.png`), animations: "disabled" });
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
function row(page: Page, text: string) {
  return page.locator("article").filter({ has: page.getByText(text, { exact: true }) });
}
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`memory owner journey ${theme} ${width}`, async ({ page }) => {
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&real-controls`);
      await page.getByRole("tab", { name: "Memory", exact: true }).click();
      await expect(page.getByText(original, { exact: true })).toBeVisible();
      await capture(page, `memory-${theme}-${width}`);
      const add = page.getByRole("button", { name: "Add memory", exact: true });
      await add.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Add memory", exact: true });
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      const memoryText = dialog.getByRole("textbox", { name: "Memory", exact: true });
      await expect(memoryText).toHaveAttribute("maxlength", "4000");
      await memoryText.fill("Uzun hafıza metni. ".repeat(250).slice(0, 4000));
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      await capture(page, `memory-long-draft-${theme}-${width}`);
      await dialog.getByRole("textbox", { name: "Memory", exact: true }).fill(added);
      await choose(page, "Scope", "Coding sessions only");
      await dialog
        .getByRole("textbox", { name: "Forbidden words", exact: true })
        .fill("secret, token");
      await capture(page, `memory-add-${theme}-${width}`);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(row(page, added)).toContainText("Coding sessions only");
      await row(page, added).getByRole("button", { name: "Edit", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit memory", exact: true });
      await expect(
        editor.getByRole("textbox", { name: "Forbidden words", exact: true }),
      ).toHaveValue("secret, token");
      await editor.getByRole("textbox", { name: "Memory", exact: true }).fill(edited);
      await choose(page, "Kind", "Learned");
      await choose(page, "Scope", "Everywhere");
      await capture(page, `memory-edit-${theme}-${width}`);
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(row(page, edited)).toContainText("Everywhere");
      const toggle = row(page, edited).getByRole("switch", { name: "Enable memory", exact: true });
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).not.toBeChecked();
      await capture(page, `memory-disabled-${theme}-${width}`);
      const search = page.getByRole("searchbox", { name: "Search this section", exact: true });
      await search.fill("recovery evidence");
      await expect(row(page, edited)).toBeVisible();
      await expect(page.getByText(original, { exact: true })).toHaveCount(0);
      await search.fill("no saved memory matches this query");
      await expect(page.getByText(edited, { exact: true })).toHaveCount(0);
      await expect(page.getByText("No results", { exact: true })).toBeVisible();
      await expect(page.getByText("Rules 1/40", { exact: true })).toBeVisible();
      await capture(page, `memory-search-empty-${theme}-${width}`);
      await search.fill("");
      await row(page, edited).getByRole("button", { name: "Delete memory", exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: "Delete memory?", exact: true });
      await expect(confirmation).toContainText(edited);
      await capture(page, `memory-delete-${theme}-${width}`);
      await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(row(page, edited)).toHaveCount(0);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(row(page, edited)).toBeVisible();
      await expect(
        row(page, edited).getByRole("switch", { name: "Enable memory", exact: true }),
      ).not.toBeChecked();
      await capture(page, `memory-restored-${theme}-${width}`);
    });

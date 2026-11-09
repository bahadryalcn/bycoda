import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [390, 1280]) {
    test(`settings search geometry ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=general&theme=${theme}&lang=tr`);
      const search = page.locator(".settings-search");
      await search.getByRole("button").first().click();
      const input = search.getByRole("combobox");
      await expect
        .poll(async () => (await input.locator("..").boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(160);
      await input.fill("zzzz-no-setting-matches");
      const empty = page.locator("p").filter({ hasText: /^Eşleşen ayar bulunamadı$/ });
      await expect(empty).toBeVisible();
      expect((await empty.boundingBox())!.width).toBeGreaterThan(120);
      expect((await empty.boundingBox())!.height).toBeLessThan(60);
      await input.press("Escape");
      await expect(empty).toHaveCount(0);
      await expect(search.getByRole("button").first()).toBeFocused();
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [390, 1280])
    for (const lang of ["en", "tr"]) {
      test(`settings ownership ${theme} ${width} ${lang}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(
          `/tests/browser/settings.html?section=appearance&theme=${theme}&lang=${lang}`,
        );
        const messages = JSON.parse(readFileSync(`src/shared/i18n/locales/${lang}.json`, "utf8"));
        const names = Object.fromEntries(
          Object.entries({
            "chat-width": "Chat width",
            "code-word-wrap": "Word wrap",
            "git-generation-default": "Commit and pull request generation",
            "mask-emails": "Mask account emails",
          }).map(([id, label]) => [id, messages[label] ?? label]),
        );
        const search = page.locator(".settings-search");
        const jump = async (id: string, section: string) => {
          await search.getByRole("button").first().click();
          const input = search.getByRole("combobox");
          await input.fill(names[id]);
          await expect(page.getByRole("option").first()).toContainText(names[id]);
          await input.press("Enter");
          await expect(page.locator(`[role=tab][id$="-${section}"]`)).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await expect(page.locator(`#setting-${id}`)).toBeVisible();
        };
        await jump("chat-width", "chat");
        await expect(page.locator("#setting-git-generation-default")).toHaveCount(0);
        await expect(page.locator("#setting-code-word-wrap")).toBeVisible();
        await expect(page.locator("#setting-streaming-text-mode")).toBeVisible();
        const wrap = page.locator("#setting-code-word-wrap [role=switch]");
        await wrap.focus();
        const checked = await wrap.isChecked();
        await page.keyboard.press("Space");
        await expect(wrap).toBeChecked({ checked: !checked });
        await page.reload();
        await jump("code-word-wrap", "chat");
        await expect(wrap).toBeChecked({ checked: !checked });
        await jump("git-generation-default", "worktrees");
        await expect(page.locator("#setting-diff-view")).toBeVisible();
        await expect(page.locator("#setting-project-worktrees")).toBeVisible();
        await jump("mask-emails", "groupLock");
        await expect(page.locator("#setting-file-access")).toBeVisible();
        const panel = page.locator("[role=tabpanel]");
        expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`privacy-${theme}-${width}-${lang}.png`),
        });
      });
    }

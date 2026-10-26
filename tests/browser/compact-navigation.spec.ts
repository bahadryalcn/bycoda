import { expect, test } from "@playwright/test";

test("compact navigation stays labeled and contained and opens grouped flyouts and shared search", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    throw error;
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        invoke: async (command: string) => {
          if (command === "git_diff_index")
            return { repository: true, branch: "main", files: [], additions: 0, deletions: 0 };
          if (command === "git_branches") return { current: "main", detached: false, branches: [] };
          if (command === "git_worktrees") return { defaultRoot: "/fixture", worktrees: [] };
          if (command === "git_status") return { files: [], branch: "main" };
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:window|is_visible" || command === "plugin:window|is_focused")
            return true;
          return [];
        },
      },
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/compact-navigation.html", { waitUntil: "domcontentloaded" });
  const rail = page.locator("[data-compact-project-rail]");
  await expect(rail).toBeVisible({ timeout: 90_000 });
  const projects = rail.getByRole("button", { name: "Projects and groups", exact: true });
  const tools = rail.getByRole("button", { name: "Tools", exact: true });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(projects).toBeInViewport();
      await expect(tools).toBeInViewport();
      expect(await projects.textContent()).toMatch(/Groups/);
      expect(await tools.textContent()).toMatch(/Tools/);
      const projectCaption = rail
        .locator('button[aria-label^="Switch project"]')
        .locator("../..")
        .locator(":scope > span");
      const captionBounds = await projectCaption.boundingBox();
      const groupsBounds = await projects.boundingBox();
      expect(captionBounds).not.toBeNull();
      expect(groupsBounds).not.toBeNull();
      expect(captionBounds!.y + captionBounds!.height).toBeLessThanOrEqual(groupsBounds!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`navigation-${theme}-${width}.png`) });
      await projects.click();
      await expect(page.getByText("Product team", { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`projects-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(projects).toBeFocused();
      await tools.click();
      await expect(page.getByRole("button", { name: "Notes", exact: true }).last()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`tools-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(tools).toBeFocused();
    }
  }
  await rail.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("radio", { name: "All", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Search conversations", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Conversations", exact: true })).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Chat search filters", exact: true }),
  ).toContainText("This project");
  await page.screenshot({ path: testInfo.outputPath("shared-conversation-search.png") });
  expect(errors).toEqual([]);
});

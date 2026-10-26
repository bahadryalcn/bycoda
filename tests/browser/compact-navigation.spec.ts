import { expect, test } from "@playwright/test";

test("compact navigation keeps workspace tabs in place and groups project and app navigation", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        invoke: async (command: string, args?: { method?: string }) => {
          if (command === "git_diff_index")
            return { repository: true, branch: "main", files: [], additions: 0, deletions: 0 };
          if (command === "git_branches") return { current: "main", detached: false, branches: [] };
          if (command === "git_worktrees") return { defaultRoot: "/fixture", worktrees: [] };
          if (command === "git_status") return { files: [], branch: "main" };
          if (command === "remote_machines")
            return [
              {
                id: "fixture-host",
                name: "This computer (local sync)",
                localHost: true,
                endpoint: "http://127.0.0.1:9999",
                environmentId: "fixture-environment",
              },
            ];
          if (command === "remote_request") {
            if (args?.method === "environment.describe") return { capabilities: ["crews.v1"] };
            if (args?.method === "projects.list")
              return ["bycoda", "mobile", "service"].map((name) => ({
                id: name,
                name,
                cwd: `/fixture/${name}`,
              }));
            if (args?.method === "crews.list") return { definitions: [], agents: [], runs: [] };
            if (args?.method === "models.list") return { models: {}, errors: {} };
            return [];
          }
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
  const tabs = page.locator('aside [role="tablist"][aria-label="Workspace"]');
  await expect(rail.getByRole("tab")).toHaveCount(0);
  await expect(projects).toHaveCount(1);
  await expect(rail.locator('button[aria-label^="Switch project"]')).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Sessions", exact: true })).toBeVisible();
  await expect(tabs.locator("[data-workspace-working-count]")).toHaveText("6");

  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(projects).toBeInViewport();
      await expect(tools).toBeInViewport();
      expect(await projects.textContent()).toContain("Projects");
      for (const label of ["Sessions", "Explorer", "Changes"]) {
        const tab = tabs.getByRole("tab", { name: label, exact: true });
        await expect(tab).toBeVisible();
        if (width === 1000) {
          await expect(tab.locator(".workspace-tab-content")).toBeVisible();
          const labelBounds = await tab
            .locator(".workspace-tab-content > span")
            .first()
            .evaluate((element) => ({
              available: element.clientWidth,
              content: element.scrollWidth,
            }));
          expect(
            labelBounds.content,
            `${label} caption must remain readable beside its badge`,
          ).toBeLessThanOrEqual(labelBounds.available);
        } else await expect(tab.locator(".workspace-tab-icon")).toBeVisible();
      }
      const initialTabs = await tabs.boundingBox();
      await tabs.getByRole("tab", { name: "Explorer", exact: true }).click();
      await expect(tabs.getByRole("tab", { name: "Explorer", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(await tabs.boundingBox()).toEqual(initialTabs);
      await tabs.getByRole("tab", { name: "Sessions", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`navigation-${theme}-${width}.png`) });
      await projects.click();
      const popup = page.locator("[data-project-navigation-flyout]");
      await expect(popup.getByText("Product team", { exact: true }).first()).toBeVisible();
      await expect(
        popup.getByRole("navigation", { name: "Workspace tools", exact: true }),
      ).toHaveCount(0);
      await expect(popup.getByText("View on GitHub", { exact: true })).toHaveCount(0);
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`projects-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(projects).toBeFocused();
      await tools.click();
      await expect(
        page
          .locator("[data-compact-tools-flyout]")
          .getByRole("button", { name: "Notes", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`tools-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(tools).toBeFocused();
    }
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  await rail.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByLabel("Selected action")).toHaveText("Inbox");
  await rail.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(tabs).toBeVisible();

  await page.getByRole("button", { name: "Hide session list", exact: true }).click();
  await expect(tabs).toHaveCount(0);
  const workspace = rail.getByRole("button", { name: "Workspace", exact: true });
  await expect(workspace).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-closed-light-1000.png") });
  await workspace.click();
  await expect(tabs).toBeVisible();
  await expect(rail.getByRole("tab")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("workspace-temporary-light-1000.png") });
  await workspace.click();
  await expect(tabs).toHaveCount(0);
  await workspace.click();
  await expect(tabs).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tabs).toHaveCount(0);
  await page.getByRole("button", { name: "Pin session list", exact: true }).click();
  await expect(tabs).toBeVisible();

  await rail.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("radio", { name: "All", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search conversations", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Conversations", exact: true })).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Chat search filters", exact: true }),
  ).toContainText("This project");
  await page.screenshot({ path: testInfo.outputPath("shared-conversation-search.png") });
  expect(errors).toEqual([]);
});

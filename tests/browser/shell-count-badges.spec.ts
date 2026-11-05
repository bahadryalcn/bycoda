import { expect, test, type Locator } from "@playwright/test";

async function compactAccentCounter(counter: Locator) {
  await expect(counter).toBeVisible();
  const presentation = await counter.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-tone-accent-fg)";
    element.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      height: element.getBoundingClientRect().height,
      color: style.color,
      accent,
      lineHeight: style.lineHeight,
      fontSize: style.fontSize,
      border: style.borderTopWidth,
      background: style.backgroundColor,
      overflow: element.scrollWidth > element.clientWidth,
    };
  });
  expect(presentation.height).toBeGreaterThanOrEqual(16);
  expect(presentation.height).toBeLessThanOrEqual(18);
  expect(presentation.color).toBe(presentation.accent);
  expect(parseFloat(presentation.lineHeight)).toBeLessThanOrEqual(18);
  expect(presentation.border).toBe("0px");
  expect(presentation.background).toBe("rgba(0, 0, 0, 0)");
  expect(presentation.overflow).toBe(false);
}

test("shell counts stay compact and follow custom accents in both rail presentations", async ({
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
        unregisterCallback: () => {},
        invoke: async (command: string, args?: { method?: string }) => {
          if (command === "git_diff_index")
            return { repository: true, branch: "main", files: [], additions: 0, deletions: 0 };
          if (command === "git_branches") return { current: "main", detached: false, branches: [] };
          if (command === "git_worktrees") return { defaultRoot: "/fixture", worktrees: [] };
          if (command === "git_status") return { files: [], branch: "main" };
          if (command === "remote_machines") return [];
          if (command === "remote_request" && args?.method === "models.list")
            return { models: {}, errors: {} };
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:window|is_visible" || command === "plugin:window|is_focused")
            return true;
          return [];
        },
      },
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const expanded of [false, true]) {
    for (const count of [1, 8, 128]) {
      await page.goto(
        `/tests/browser/compact-navigation.html?badgeCount=${count}${expanded ? "&expandedRail" : ""}`,
      );
      const working = page.locator("[data-workspace-working-count]");
      // The expanded rail shows the plain section count; label-less rails keep the corner badge.
      const recovery = page.locator(expanded ? ".recovery-rail-number" : ".recovery-rail-count");
      await expect(working).toHaveText(String(Math.min(count, 9)));
      const workingCount = Math.min(count, 9);
      await expect(working).toHaveAttribute(
        "aria-label",
        `${workingCount} working ${workingCount === 1 ? "session" : "sessions"}`,
      );
      await expect(working.locator('[data-size="xs"][aria-hidden="true"]')).toBeVisible();
      await expect(recovery).toHaveText(count > 99 ? "99+" : String(count));
      for (const light of [false, true]) {
        await page.evaluate((light) => {
          document.documentElement.classList.toggle("theme-light", light);
          document.documentElement.style.setProperty(
            "--user-accent-color",
            light ? "#8a268e" : "#e6a43c",
          );
        }, light);
        for (const width of [1280, 800]) {
          await page.setViewportSize({ width, height: 900 });
          await compactAccentCounter(working);
          if (!expanded) await compactAccentCounter(recovery);
          const owner = page.getByRole("button", {
            name: `Recovered sessions (${count})`,
            exact: true,
          });
          await expect(owner).toBeVisible();
          await owner.focus();
          await page.keyboard.press("Enter");
          await expect(page.getByLabel("Selected action", { exact: true })).toHaveText(
            "Recovered sessions",
          );
          const icon = (await owner.locator("svg").boundingBox())!;
          const number = (await recovery.boundingBox())!;
          if (expanded) {
            expect(number.x).toBeGreaterThan(icon.x + icon.width);
            await expect(owner.locator(".recovery-rail-label")).toBeVisible();
          } else {
            expect(number.y).toBeLessThan(icon.y);
            expect(number.y + number.height).toBeLessThan(icon.y + icon.height);
          }
          const neutral = page.getByTestId("neutral-count");
          expect((await neutral.boundingBox())!.height).toBeLessThanOrEqual(18);
          expect(await neutral.evaluate((element) => getComputedStyle(element).color)).toBe(
            await working.evaluate((element) => getComputedStyle(element).color),
          );
          expect(
            await page
              .getByTestId("info-label")
              .evaluate((element) => getComputedStyle(element).color),
          ).not.toBe(await working.evaluate((element) => getComputedStyle(element).color));
          if (count === 8) {
            await page.screenshot({
              path: `temp/verification/2026-10-27-badges/${testInfo.project.name}/${expanded ? "expanded" : "compact"}-${light ? "light" : "dark"}-${width}.png`,
            });
          }
        }
      }
    }
  }
  expect(errors).toEqual([]);
});

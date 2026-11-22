import { expect, test, type Locator } from "@playwright/test";

async function compactAccentCounter(counter: Locator) {
  await expect(counter).toBeVisible();
  const presentation = await counter.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-tone-accent-fg)";
    probe.style.lineHeight = "var(--ui-leading-caption)";
    element.append(probe);
    const accent = getComputedStyle(probe).color;
    const captionLeading = parseFloat(getComputedStyle(probe).lineHeight);
    probe.remove();
    return {
      captionLeading,
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
  // Counters carry no minimum box of their own: they take the surrounding text's line
  // (DESIGN.md "Badges and status tones"), so they never exceed the caption leading
  // and never shrink below their own glyphs.
  expect(presentation.height).toBeGreaterThanOrEqual(parseFloat(presentation.fontSize));
  expect(presentation.height).toBeLessThanOrEqual(presentation.captionLeading);
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
        `/tests/browser/app-shell/compact-navigation.html?badgeCount=${count}${expanded ? "&expandedRail" : ""}`,
      );
      const working = page.locator("[data-workspace-working-count]");
      await expect(working).toHaveText(String(Math.min(count, 9)));
      const workingCount = Math.min(count, 9);
      // The badge is decorative; a screen-reader-only live region carries the meaning.
      await expect(working).toHaveAttribute("aria-hidden", "true");
      await expect(page.getByText(/^\d+ working sessions?$/)).toHaveText(
        `${workingCount} working ${workingCount === 1 ? "session" : "sessions"}`,
      );
      await expect(working.locator('[data-size="xs"][aria-hidden="true"]')).toBeVisible();
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
          const owner = page.getByRole("button", {
            name: `Recovered sessions (${count})`,
            exact: true,
          });
          await expect(owner).toBeVisible();
          const recoveryCount = owner.locator('[data-variant="count"]');
          await expect(recoveryCount).toHaveText(count > 99 ? "99+" : String(count));
          await compactAccentCounter(recoveryCount);
          await owner.focus();
          await page.keyboard.press("Enter");
          await expect(page.getByLabel("Selected action", { exact: true })).toHaveText(
            "Recovered sessions",
          );
          const settings = owner
            .locator("..")
            .getByRole("button", { name: "Settings", exact: true });
          const icon = (await owner.boundingBox())!;
          const badge = (await recoveryCount.boundingBox())!;
          expect(badge.y).toBeLessThan(icon.y);
          expect(badge.x + badge.width).toBeLessThanOrEqual(icon.x + icon.width);
          const settingsBox = (await settings.boundingBox())!;
          if (expanded) {
            expect(icon.x + icon.width).toBeLessThanOrEqual(settingsBox.x);
            expect(icon.y).toBe(settingsBox.y);
          } else {
            expect(icon.y + icon.height).toBeLessThanOrEqual(settingsBox.y);
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
              path: `temp/verification/recovery-footer-icon/${testInfo.project.name}/${expanded ? "expanded" : "compact"}-${light ? "light" : "dark"}-${width}.png`,
            });
          }
        }
      }
    }
  }
  expect(errors).toEqual([]);
});

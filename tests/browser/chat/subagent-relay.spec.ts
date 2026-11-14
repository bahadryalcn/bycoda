import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`delegated retention after completion ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?retention&theme=${theme}`);
      const history = page.locator("[data-composer-subagents-trigger]");
      await expect(history).toHaveAccessibleName("Session subagents: 10 running of 10");
      await history.click();
      await page.getByRole("menuitem", { name: /^Physics table 2,/ }).click();
      const panel = page.getByRole("dialog");
      await expect(panel).toContainText("Low initial entropy");
      // Finish while reading a child, then observe longer than one discovery interval.
      await page.evaluate(() => {
        const finish = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent === "Finish discussion",
        );
        finish?.click();
      });
      await expect(history).toHaveAccessibleName("Session subagents: 10");
      await expect(panel).toContainText("Done");
      await page.waitForTimeout(5_500);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Low initial entropy");
      await expect(
        page.getByTestId("retained-cards").getByRole("button", { name: /Open Physics table/ }),
      ).toHaveCount(10);
      await page.screenshot({
        path: `temp/verification/subagent-retention/sheet-${theme}-${width}.png`,
      });
      await panel.getByRole("button", { name: "Close agent panel", exact: true }).click();
      await history.click();
      await expect(page.getByRole("menuitem")).toHaveCount(10);
      await page.screenshot({
        path: `temp/verification/subagent-retention/history-${theme}-${width}.png`,
      });
      await page.getByRole("menuitem", { name: /^Physics table 2,/ }).click();
      await expect(panel).toContainText("Low initial entropy");
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`command scroll keyboard focus ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/chat/subagent-relay.html?theme=${theme}`);
      await page.getByRole("button", { name: "Open command" }).click();
      const dialog = page.getByRole("dialog");
      const command = dialog.getByRole("region", { name: "Command" }).locator("pre[tabindex='0']");
      const output = dialog.getByRole("region", { name: "Output" }).locator("[tabindex='0']");
      await expect(command).toContainText("echo focused-command");
      await expect(output).toContainText("command output fixture");
      const fill = await command.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.background = "var(--ui-card-surface)";
        node.appendChild(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { actual: getComputedStyle(node).backgroundColor, expected };
      });
      expect(fill.actual).toBe(fill.expected);
      await page.keyboard.press("Tab");
      for (const node of [command, output]) {
        await node.focus();
        const outline = await node.evaluate((element) => {
          const s = getComputedStyle(element);
          const probe = document.createElement("span");
          probe.style.outline = "2px solid var(--ui-focus-ring-color)";
          element.appendChild(probe);
          const expected = getComputedStyle(probe).outlineColor;
          probe.remove();
          return {
            width: s.outlineWidth,
            offset: s.outlineOffset,
            color: s.outlineColor,
            expected,
          };
        });
        expect(outline).toEqual({
          width: "2px",
          offset: "-2px",
          color: outline.expected,
          expected: outline.expected,
        });
      }
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/command-focus-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`subagent caller visual ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?status-colors&theme=${theme}`);
      const dock = page.getByRole("region", { name: "Turn activity", exact: true });
      await dock.locator("button[data-dock-toggle]").click();
      await expect(dock.locator("[data-dock-agent]")).toHaveCount(5);
      await page.screenshot({
        path: `temp/verification/sessions-callers/activity-dock-${theme}-${width}.png`,
      });
      await page.goto(`/tests/browser/chat/subagent-relay.html?layout&theme=${theme}`);
      await page.getByRole("button", { name: "Open reviewer", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/sessions-callers/subagent-${theme}-${width}.png`,
      });
    });

for (const theme of ["dark", "light"]) {
  for (const width of [800, 1280]) {
    test(`compact activity identities and state icons at ${width}px ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?status-colors&theme=${theme}`);
      const dock = page.getByRole("region", { name: "Turn activity", exact: true });
      await dock.locator("button[data-dock-toggle]").click();
      const rows = dock.locator("[data-dock-agent]");
      await expect(rows).toHaveCount(5);
      for (const state of ["running", "done", "failed", "stopped", "interrupted"]) {
        const row = dock.locator(`[data-dock-agent="status-${state}"]`);
        await expect(row).toHaveAttribute(
          "aria-label",
          new RegExp(
            state === "stopped" ? "Stopped by you" : state[0].toUpperCase() + state.slice(1),
          ),
        );
        await expect(row).toHaveAttribute("data-dock-agent-state", state);
        await expect(row.locator(":scope > span").first()).toBeVisible();
      }
      const running = dock.locator('[data-dock-agent="status-running"]');
      const geometry = await running.evaluate((node) => {
        // The title leads; the model line (marks, model, account) sits beneath it.
        const model = node.querySelector(".activity-dock-agent-identity > span:last-child")!;
        const metrics = node.querySelector(".activity-dock-agent-metrics")!;
        const title = node.querySelector(".whitespace-pre-wrap")!;
        const arrow = node.lastElementChild!;
        return {
          modelBelowTitle:
            model.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1,
          metricsAfterTitle:
            metrics.getBoundingClientRect().left >= title.getBoundingClientRect().right,
          metricsBeforeArrow:
            metrics.getBoundingClientRect().right <= arrow.getBoundingClientRect().left,
          fits: node.scrollWidth <= node.clientWidth,
        };
      });
      expect(geometry).toEqual({
        modelBelowTitle: true,
        metricsAfterTitle: true,
        metricsBeforeArrow: true,
        fits: true,
      });
      await expect(running.locator(".activity-dock-agent-identity > span").last()).toContainText(
        /gpt-6.1-sol/i,
      );
      await expect(running.locator(".activity-dock-agent-metrics")).toContainText(
        "3 steps, 1 failed",
      );
      await running.focus();
      await expect(running).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await dock.screenshot({ path: info.outputPath(`compact-dock-${theme}-${width}.png`) });
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const width of [320, 542]) {
    test(`long trail and resized composer stay within ${width}px ${theme} panel`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 500 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/chat/subagent-relay.html?layout");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Open reviewer", exact: true }).click();
      const panel = page.getByRole("dialog");
      const nested = panel.getByRole("button", {
        name: "Open Root subagent in its own panel",
        exact: true,
      });
      await nested.scrollIntoViewIfNeeded();
      const row = await nested.boundingBox();
      const mascot = await nested.locator("svg").first().boundingBox();
      expect(mascot!.x - row!.x).toBeLessThan(20);
      await panel.getByRole("textbox").evaluate((input) => {
        input.style.height = "900px";
      });
      const send = panel.getByRole("button", { name: "Relay via main agent" });
      await send.scrollIntoViewIfNeeded();
      const bounds = await panel.boundingBox();
      const sendBounds = await send.boundingBox();
      expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
      const geometry = await panel.evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      await page.screenshot({ path: testInfo.outputPath("layout.png") });
      await panel.getByRole("button", { name: "Close agent panel" }).click();
      await expect(panel).toHaveCount(0);
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`relay at ${width}px in ${theme} theme`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/chat/subagent-relay.html");
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
        theme,
      );
      await page.getByRole("button", { name: "Open reviewer", exact: true }).click();
      const panel = page.getByRole("dialog");
      const input = panel.getByRole("textbox");
      await input.fill("Can you explain your findings?");
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open reviewer", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Open explorer", exact: true }).click();
      await expect(panel.getByRole("textbox")).toHaveValue("");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Open reviewer", exact: true }).click();
      await expect(input).toHaveValue("Can you explain your findings?");
      await input.press("Control+Enter");
      await expect(page.getByTestId("submission-count")).toHaveText("1");
      await expect(page.getByTestId("last-submission")).toContainText('"callId":"spawn-1"');
      await expect(input).toHaveValue("");
      await expect(panel.getByRole("status")).toContainText("Delivery is not yet confirmed");
      await expect(panel.getByRole("button", { name: "Relay via main agent" })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const send = await panel.getByRole("button", { name: "Relay via main agent" }).boundingBox();
      expect(send!.x).toBeGreaterThanOrEqual(0);
      expect(send!.x + send!.width).toBeLessThanOrEqual(width);
      if (width === 390 || width === 1440)
        await page.screenshot({ path: testInfo.outputPath("sheet.png") });
      await panel.getByRole("button", { name: "Open main conversation" }).click();
      await expect(panel).toHaveCount(0);
    });
  }
}

test("blocked shortcut and rejected submission preserve drafts", async ({ page }) => {
  for (const mode of ["blocked", "reject"]) {
    await page.goto(`/tests/browser/chat/subagent-relay.html?${mode}`);
    await page.getByRole("button", { name: "Open reviewer", exact: true }).click();
    const input = page.getByRole("dialog").getByRole("textbox");
    await input.fill("Keep this message");
    await input.press("Control+Enter");
    await expect(input).toHaveValue("Keep this message");
    await expect(page.getByTestId("submission-count")).toHaveText("0");
    if (mode === "reject")
      await expect(page.getByRole("dialog").getByRole("status")).toContainText("not accepted");
  }
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`shared subagent label interaction ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?inline-status&theme=${theme}`);
      const label = page
        .locator('[data-action-content="always"][data-interaction-tone="neutral"]')
        .first();
      const before = await label.evaluate((node) => getComputedStyle(node).color);
      await label.hover();
      const actual = await label.evaluate((node) => {
        const p = document.createElement("span");
        p.style.color = "var(--ui-tone-neutral-fg)";
        node.appendChild(p);
        const expected = getComputedStyle(p).color;
        p.remove();
        return { actual: getComputedStyle(node).color, expected };
      });
      expect(actual.actual).toBe(actual.expected);
      await page.screenshot({
        path: `temp/verification/session-last-interactions/subagent-${theme}-${width}.png`,
      });
      await page.mouse.move(0, 0);
      await expect(label).toHaveCSS("color", before);
    });

import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`delegated retention after completion ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?retention&theme=${theme}`);
      const history = page.locator("[data-composer-subagents-trigger]");
      await expect(history).toHaveAttribute("aria-label", "Session subagents: 10 running of 10");
      await expect(
        page
          .getByRole("region", { name: "Turn activity" })
          .getByText("10 background agents running", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByTestId("retained-cards").getByText("Running", { exact: true }),
      ).toHaveCount(10);
      await expect(
        page.getByTestId("retained-cards").getByText("Interrupted", { exact: true }),
      ).toHaveCount(0);
      // The dock lists the same runs, so the composer control steps aside while it shows.
      await expect(history).toBeHidden();
      const dock = page.getByRole("region", { name: "Turn activity" });
      await dock.locator("button[data-dock-toggle]").click();
      await expect(dock.locator("[data-dock-agent]")).toHaveCount(10);
      await page.screenshot({
        path: `temp/verification/agent-communication/background-running-${theme}-${width}.png`,
      });
      await dock.getByRole("button", { name: /^Open Physics table 2,/ }).click();
      const panel = page.getByRole("dialog");
      await expect(panel).toContainText("Low initial entropy");
      const { actual, canvas } = await panel.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--ui-chat-pane-canvas)";
        element.appendChild(probe);
        const canvas = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { actual: getComputedStyle(element).backgroundColor, canvas };
      });
      expect(actual).toBe(canvas);
      await expect(panel.locator(".popover-backdrop")).toHaveCount(0);
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
      const menu = page.getByRole("menu", { name: "Session subagents" });
      await expect(menu.locator("..").locator(":scope > .popover-frosted")).toHaveCount(1);
      const firstRow = menu.getByRole("menuitem").first();
      const spacing = await firstRow.evaluate((row) => {
        const style = getComputedStyle(row);
        return {
          inset: parseFloat(style.paddingBlockStart),
          gap:
            row.nextElementSibling!.getBoundingClientRect().top -
            row.getBoundingClientRect().bottom,
        };
      });
      expect(spacing.inset).toBeGreaterThanOrEqual(6);
      expect(spacing.gap).toBeGreaterThanOrEqual(4);
      await expect(firstRow).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
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
        probe.style.background = "var(--ui-surface-muted)";
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
  for (const width of [390, 800, 1280])
    test(`subagent caller visual ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?status-colors&theme=${theme}`);
      const dock = page.getByRole("region", {
        name: "Turn activity",
        exact: true,
      });
      const toggle = dock.locator("button[data-dock-toggle]");
      // The visible summary is provider marks and counts; the title lives in the accessible name.
      await expect(toggle).not.toContainText("Background work");
      await expect(toggle).toHaveAccessibleName(/(^|\. )Background work, /);
      await expect(toggle.locator("[data-dock-providers] > *").first()).toBeVisible();
      for (const label of ["1 running", "1 done", "1 failed", "1 stopped", "1 interrupted"]) {
        await expect(toggle.locator("[data-tone]", { hasText: label })).toBeVisible();
      }
      expect(
        await toggle.evaluate((button) => {
          const trigger = button.getBoundingClientRect();
          return [...button.querySelectorAll("[data-tone]")].every((badge) => {
            const box = badge.getBoundingClientRect();
            return (
              box.left >= trigger.left &&
              box.right <= trigger.right &&
              box.top >= trigger.top &&
              box.bottom <= trigger.bottom
            );
          });
        }),
      ).toBe(true);
      await expect(dock.locator("[data-dock-stop-all]")).toHaveCount(0);
      await dock.screenshot({
        animations: "disabled",
        path: `temp/verification/activity-dock/summary-${theme}-${width}.png`,
      });
      await toggle.click();
      await expect(dock.locator("[data-dock-agent]")).toHaveCount(5);
      await expect(dock.getByRole("button", { name: "Stop all", exact: true })).toBeVisible();
      await page.mouse.move(0, 0);
      await dock.screenshot({
        animations: "disabled",
        path: `temp/verification/activity-dock/details-${theme}-${width}.png`,
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
      const dock = page.getByRole("region", {
        name: "Turn activity",
        exact: true,
      });
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
        // The provider mark leads; the state reads as icon and word among the metrics.
        const lead = row.locator("[data-dock-agent-lead]");
        await expect(lead).toBeVisible();
        const geometry = await lead.evaluate((node) => {
          const icon = node.firstElementChild!.getBoundingClientRect();
          const title = node
            .parentElement!.querySelector("[data-dock-agent-title]")!
            .getBoundingClientRect();
          return {
            size: icon.width,
            beforeTitle: icon.right <= title.left,
            alignedWithTitle: Math.abs(icon.top - title.top) <= 4,
          };
        });
        expect(geometry).toEqual({ size: 16, beforeTitle: true, alignedWithTitle: true });
        // The state word appears once, from the status mark or from a detail that names it.
        const word = state === "stopped" ? "stopped by you" : state;
        const metrics = (
          await row.locator(".activity-dock-agent-metrics").innerText()
        ).toLowerCase();
        expect(metrics.split(word).length - 1).toBe(1);
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
      await dock.screenshot({
        path: info.outputPath(`compact-dock-${theme}-${width}.png`),
      });
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
  for (const width of [800, 1280]) {
    test(`expand and resize a child conversation at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?theme=${theme}`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Open reviewer", exact: true }).click();
      const panel = page.getByRole("dialog");
      const input = panel.getByRole("textbox");
      await input.fill("Draft stays with this child.");
      const size = () => panel.evaluate((element) => element.getBoundingClientRect().width);
      const compact = await size();
      const sash = panel.getByRole("separator", { name: "Resize panel" });
      await sash.focus();
      await sash.press("ArrowLeft");
      await expect.poll(size).toBeGreaterThan(compact);
      const resized = await size();
      await panel.getByRole("button", { name: "Expand", exact: true }).click();
      await expect.poll(size).toBeGreaterThan(resized);
      await expect(input).toHaveValue("Draft stays with this child.");
      await page.screenshot({
        path: `temp/verification/subagent-message-flow/expanded-${theme}-${width}.png`,
      });
      await panel.getByRole("button", { name: "Restore", exact: true }).click();
      await expect.poll(size).toBe(resized);
      await expect(input).toHaveValue("Draft stays with this child.");
      await page.screenshot({
        path: `temp/verification/subagent-message-flow/compact-${theme}-${width}.png`,
      });
    });
  }
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
      await expect(panel.getByRole("button", { name: "Open main conversation" })).toHaveCount(0);
      await panel.getByRole("button", { name: "Close agent panel", exact: true }).click();
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
      // The row is one step trigger: chrome ink at rest, body ink on hover (shared Disclosure step).
      const label = page.locator('summary[aria-label$="\'s work"]').first();
      const before = await label.evaluate((node) => getComputedStyle(node).color);
      await label.hover();
      const actual = await label.evaluate((node) => {
        const p = document.createElement("span");
        p.style.color = "var(--transcript-ink-chrome-active, var(--foreground))";
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

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`subagent audit display ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?audit&theme=${theme}`);
      // Queue: results waiting for the main agent are not owner messages; the activity dock
      // shows those runs, so the queue lists nothing while it drains normally.
      await expect(page.getByText(/subagent results? waiting/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Remove queued message" })).toHaveCount(0);
      // Claude Code's built-in advisor: details start closed and toggle on click.
      const advisor = page.locator("[data-advisor-row]");
      await expect(advisor).toContainText("Advisor · Fable 5.2");
      await expect(advisor).toContainText("Done");
      await expect(advisor.locator("summary img")).toBeVisible();
      await expect(advisor.locator("details")).not.toHaveAttribute("open");
      await advisor.screenshot({
        path: `temp/verification/advisor/completed-collapsed-${theme}-${width}.png`,
      });
      await expect(
        advisor.getByText("Re-run the failed migration check", { exact: false }),
      ).toBeHidden();
      await advisor.locator("summary").click();
      await expect(
        advisor.getByText("Re-run the failed migration check", { exact: false }),
      ).toBeVisible();
      await advisor.locator("summary").click();
      await expect(
        advisor.getByText("Re-run the failed migration check", { exact: false }),
      ).toBeHidden();
      await advisor.locator("summary").click();
      // Transcript: a completion folds into its card; a notice without a card stays a disclosure.
      const benchmark = page.locator('summary[aria-label$="Benchmark review\'s work"]');
      await expect(async () => {
        if ((await benchmark.getAttribute("aria-expanded")) !== "true") await benchmark.click();
        await expect(page.getByText("Result received by the main agent")).toHaveCount(1, {
          timeout: 500,
        });
      }).toPass();
      const orphan = page.getByText("Result from Archived explorer");
      await expect(orphan).toBeVisible();
      await orphan.click();
      await expect(page.getByText("No card remains for this run.")).toBeVisible();
      await expect(page.getByText("Subagent completion:")).toHaveCount(0);
      // Failed child: error text and Retry.
      await expect(
        page.getByText("Provider rejected the request: context length exceeded."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(1);
      // Round badge on the running second round.
      await expect(page.getByText("Round 2").first()).toBeVisible();
      // The call that failed before any child existed is a failed card without Retry.
      await expect(
        page.getByText("Model grok:grok-4.6 is unavailable for subagents."),
      ).toBeVisible();
      // The dock counts the carded children and lists no row of its own.
      await expect(
        page.getByRole("region", { name: "Turn activity" }).getByText(/background agent/),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/subagent-audit/audit-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`advisor working with visible advice ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/chat/subagent-relay.html?audit&advisor-pending&theme=${theme}`,
      );
      const advisor = page.locator("[data-advisor-row]");
      await expect(advisor.locator("summary img")).toBeVisible();
      await expect(advisor.locator("summary")).toContainText("Thinking…");
      await expect(advisor.locator('[class*="sweepClip"]')).toHaveCount(1);
      await expect(advisor.locator("details")).not.toHaveAttribute("open");
      await advisor.screenshot({
        path: `temp/verification/advisor/working-collapsed-${theme}-${width}.png`,
      });
      await expect(
        advisor.getByText("Re-run the failed migration check", { exact: false }),
      ).toBeHidden();
      await advisor.locator("summary").click();
      await expect(
        advisor.getByText("Re-run the failed migration check", { exact: false }),
      ).toBeVisible();
      await advisor.screenshot({ path: `temp/verification/advisor/working-${theme}-${width}.png` });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(
        advisor.getByText("Re-run the failed migration check", { exact: false }),
      ).toBeVisible();
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`a subagent's own subagents ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?nested&theme=${theme}`);
      const dock = page.getByRole("region", { name: "Turn activity" });
      await dock.locator("button[data-dock-toggle]").click();
      // Only the direct child is a dock row; its own runs are counted and their wait shows.
      await expect(dock.locator("[data-dock-agent]")).toHaveCount(1);
      const row = dock.getByRole("button", { name: /^Open Release audit,/ });
      await expect(row).toContainText("Subagents: 2");
      await expect(row).toContainText("Needs input");
      await page.screenshot({
        path: `temp/verification/nested-subagents/dock-${theme}-${width}.png`,
      });
      await row.click();
      const panel = page.getByRole("dialog");
      const list = panel.locator("[data-nested-subagents]");
      await expect(list.locator("[data-nested-subagent]")).toHaveCount(2);
      await expect(list.getByRole("button", { name: /^Open Migration dry run,/ })).toContainText(
        "Needs input",
      );
      // The finished one survives the idle detach through its parent.
      await expect(list.getByRole("button", { name: /^Open Changelog check,/ })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/nested-subagents/sheet-${theme}-${width}.png`,
      });
      await list.getByRole("button", { name: /^Open Migration dry run,/ }).click();
      await expect(panel).toContainText("Migration dry run: working through it.");
      await expect(panel.locator("[data-nested-subagents]")).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/nested-subagents/grandchild-${theme}-${width}.png`,
      });
      await panel.getByRole("button", { name: "Back", exact: true }).click();
      await expect(panel).toContainText("Release audit: working through it.");
      await expect(panel.locator("[data-nested-subagent]")).toHaveCount(2);
      await list.getByRole("button", { name: /^Open Changelog check,/ }).click();
      await expect(panel).toHaveAccessibleName("Subagent: Changelog check");
      await expect(panel.getByText("37", { exact: true })).toBeVisible();
      await expect(
        panel.getByRole("textbox", { name: "Message for Changelog check" }),
      ).toBeVisible();
      await panel.getByRole("button", { name: "Expand", exact: true }).click();
      await page.screenshot({
        path: `temp/verification/subagent-message-flow/nested-expanded-${theme}-${width}.png`,
      });
      await panel.getByRole("button", { name: "Back", exact: true }).click();
      await expect(panel).toHaveAccessibleName("Subagent: Release audit");
    });
for (const theme of ["light", "dark"] as const) {
  for (const width of [800, 1280]) {
    test(`Workflow subagent phases and transcripts ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?workflow&theme=${theme}`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: /Background work.*Show list/ }).click();
      await expect(page.getByText("Workflow · Research", { exact: true })).toBeVisible();
      await expect(page.getByText("Workflow · Review", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/subagent-visibility/workflow-running-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Finish fixture workflow" }).click();
      await page.getByRole("button", { name: "Session subagents: 2", exact: true }).click();
      await expect(page.getByText("Workflow · Research", { exact: true })).toBeVisible();
      await expect(page.getByText("Workflow · Review", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/subagent-visibility/workflow-history-${theme}-${width}.png`,
      });
      await page.getByRole("menuitem", { name: /Research agent.*Done/ }).click();
      const panel = page.getByRole("dialog");
      await expect(panel.getByText("Research transcript fixture")).toBeVisible();
      await expect(panel.getByRole("button", { name: /Stop|Relay/ })).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/subagent-visibility/workflow-transcript-${theme}-${width}.png`,
      });
    });
  }
}

for (const theme of ["light", "dark"])
  for (const width of [320, 800, 1280])
    test(`delegated conversation timeline ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/subagent-relay.html?timeline&theme=${theme}`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const panel = page.getByRole("dialog");
      // Latest round open with the reply. Pending and failed inputs have no receiving round.
      const latest = panel.locator("[data-timeline-input='t-m3']");
      await expect(latest).toContainText("Message");
      await expect(latest).toContainText("Queue");
      await expect(latest).toContainText("Submitted");
      const failed = panel.locator("[data-timeline-input='t-failed']");
      await expect(failed).toContainText("Failed");
      await expect(failed).toContainText("Host restarted before dispatch");
      const queued = panel.locator("[data-timeline-input^='t-q']");
      await expect(queued).toHaveCount(3);
      for (const [index, name] of ["Queue A", "Queue B", "Queue C"].entries()) {
        await expect(queued.nth(index)).toContainText(name);
        await expect(queued.nth(index)).toContainText("Queued");
        await expect(
          queued.nth(index).locator("xpath=ancestor::*[@data-timeline-round]"),
        ).toHaveCount(0);
      }
      await expect(panel).toContainText("sıradaki deneme mesajını aldım.");
      // Earlier rounds on demand, in order, with the sent text verbatim.
      const second = panel.locator("details[data-timeline-round='2']");
      await expect(second).toHaveCount(1);
      await second.locator("summary").click();
      const sent = panel.locator("[data-timeline-input='t-m2']");
      await expect(sent).toContainText("You");
      await expect(sent).toContainText("Auto · Queue");
      await expect(sent).toContainText("Accepted");
      await expect(sent).toContainText("**not bold**");
      await expect(sent.locator("strong")).toHaveCount(0);
      await expect(panel).toContainText("Answer to the");
      // Long unbroken text wraps inside the panel; nothing scrolls sideways.
      const geometry = await panel.evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
        trail: (() => {
          const trail = el.querySelector<HTMLElement>("[data-subagent-trail]");
          return trail ? trail.scrollWidth - trail.clientWidth : 0;
        })(),
      }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      expect(geometry.trail).toBeLessThanOrEqual(1);
      // Opened state survives a re-render of the same run.
      await expect(second).toHaveAttribute("open", "");
      await page.screenshot({
        path: `temp/verification/subagent-message-flow/timeline-${theme}-${width}.png`,
      });
      await queued.last().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/subagent-message-flow/queue-${theme}-${width}.png`,
      });
    });

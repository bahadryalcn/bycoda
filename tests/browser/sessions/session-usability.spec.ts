import { expect, test } from "@playwright/test";

for (const kind of ["projectless", "project"])
  for (const light of [true, false])
    for (const width of [800, 1280])
      test(`session machine picker ${kind} ${light ? "light" : "dark"} ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(
          `/tests/browser/sessions/session-usability.html?machineFixture=${kind}${light ? "&light" : ""}`,
        );
        const picker = page.getByRole("button", { name: /^Run on:/ });
        await expect(picker).toContainText("This computer");
        await picker.click();
        await expect(page.getByRole("menuitemradio", { name: /Office Mac/ })).toBeVisible();
        await expect(page.getByRole("menuitemradio", { name: /Build PC.*Offline/ })).toBeDisabled();
        if (width === 1280) await expect(page.locator(".crew-scene")).toBeVisible();
        const choices = page.getByRole("menu", { name: "Run on" });
        await expect
          .poll(async () => {
            const trigger = (await picker.boundingBox())!;
            const list = (await choices.boundingBox())!;
            return Math.min(
              Math.abs(list.y - trigger.y - trigger.height),
              Math.abs(trigger.y - list.y - list.height),
            );
          })
          .toBeLessThan(18);
        await page.screenshot({
          path: `temp/verification/session-machine-selection/${kind}-${light ? "light" : "dark"}-${width}.png`,
        });
        await page.getByRole("menuitemradio", { name: /Office Mac/ }).click();
        await expect
          .poll(() => page.evaluate(() => window.sessionUsability.events.machine))
          .toBe("office");
        const editor = page.locator("[data-composer-box] textarea");
        await expect(editor).toHaveValue("Keep this integrated draft");
        await expect(editor).toBeFocused();
        await picker.evaluate((trigger: HTMLButtonElement) => trigger.click());
        await expect(choices).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(choices).toHaveCount(0);
        await expect(editor).toBeFocused();
      });

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`earlier history scroll ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?historyFixture${light ? "&light" : ""}`,
      );
      const transcript = page.locator(".agent-transcript");
      const firstRecent = transcript.locator('[data-transcript-turn="history-12"]');
      const firstOld = transcript.locator('[data-transcript-turn="history-0"]');
      const loading = transcript.getByText("Loading earlier messages…");
      const rail = page.getByRole("toolbar", { name: "Prompts", exact: true });
      const marker = rail.locator('[data-prompt-bar="history-12"]');
      const folder = "temp/verification/prompt-outline-prepend";
      const name = `${light ? "light" : "dark"}-${width}`;
      await expect(transcript.getByText("Response 16", { exact: true })).toBeVisible();
      // The tail paints first. Until the first local turn is mounted, scrolling
      // reveals more local turns before it can request the stored history page.
      await expect(firstRecent).toBeAttached();
      await expect(firstOld).toHaveCount(0);
      expect(await page.evaluate(() => window.sessionUsability.events.historyPages)).toBe(0);
      await transcript.hover();
      await page.mouse.wheel(0, -2400);
      await expect(loading).toBeVisible();
      await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
      const before = (await firstRecent.boundingBox())!.y;
      const markerBefore = width === 1280 ? (await marker.boundingBox())!.y : null;
      await page.screenshot({ path: `${folder}/loading-${name}.png` });
      await page.evaluate(() => window.sessionUsability.finishHistoryPage());
      await expect(firstOld).toHaveCount(1);
      await expect(loading).toHaveCount(0);
      expect(await page.evaluate(() => window.sessionUsability.events.historyPages)).toBe(1);
      await expect
        .poll(async () => Math.abs((await firstRecent.boundingBox())!.y - before))
        .toBeLessThan(2);
      await page.screenshot({ path: `${folder}/loaded-${name}.png` });
      if (markerBefore !== null) {
        await expect(marker).toHaveAttribute("aria-current", "true");
        await expect
          .poll(async () => Math.abs((await marker.boundingBox())!.y - markerBefore))
          .toBeLessThan(2);
        await transcript.hover();
        await page.mouse.wheel(0, -2400);
        await expect(rail.locator('[data-prompt-bar="history-0"]')).toHaveAttribute(
          "aria-current",
          "true",
        );
        await page.screenshot({ path: `${folder}/earlier-${name}.png` });
      } else await expect(rail).toBeHidden();
    });

for (const light of [true, false])
  test(`earlier history loads after a slow animated wheel scroll ${light ? "light" : "dark"} 1280`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(
      `/tests/browser/sessions/session-usability.html?historyFixture${light ? "&light" : ""}`,
    );
    const transcript = page.locator(".agent-transcript");
    await expect(transcript.getByText("Response 16", { exact: true })).toBeVisible();
    await expect(transcript.locator('[data-transcript-turn="history-12"]')).toBeAttached();
    expect(await page.evaluate(() => window.sessionUsability.events.historyPages)).toBe(0);
    await transcript.hover();
    // One upward wheel event starts the motion, then the engine animates it: WebKit on CI took
    // over a second, so the top was only reached after the wheel's input window. The wheel is
    // dispatched in the page so no second, engine-owned wheel animation competes with this one.
    const animatedFrom = await transcript.evaluate(
      (element) =>
        new Promise<number>((resolve) => {
          element.dispatchEvent(
            new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }),
          );
          // From the end (about 760px) the 320px load threshold is crossed after about 1.7s,
          // well past the 1s input window; the CI screencast was still near the end at 1s.
          const from = element.scrollTop;
          const started = performance.now();
          const step = () => {
            const progress = Math.min(1, (performance.now() - started) / 3000);
            element.scrollTop = Math.round(from * (1 - progress));
            if (progress < 1) requestAnimationFrame(step);
            else resolve(from);
          };
          requestAnimationFrame(step);
        }),
    );
    // The motion starts from the end, far above the load threshold.
    expect(animatedFrom).toBeGreaterThan(600);
    await expect(transcript.getByText("Loading earlier messages…")).toBeVisible();
    expect(await page.evaluate(() => window.sessionUsability.events.historyPages)).toBe(1);
    await page.evaluate(() => window.sessionUsability.finishHistoryPage());
    await expect(transcript.locator('[data-transcript-turn="history-0"]')).toHaveCount(1);
  });

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`session review caller visual ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?reviewFixture${light ? "&light" : ""}`,
      );
      await page.addStyleTag({
        content:
          ".agent-transcript { background-image: radial-gradient(ellipse at 70% 25%, var(--ui-tone-info-subtle), transparent 75%); }",
      });
      await expect(page.locator("[data-session-review]")).toContainText("1 file changed");
      const review = page.getByRole("button", { name: "Review", exact: true });
      const undo = page.getByRole("button", { name: "Undo", exact: true });
      await expect(undo).toBeDisabled();
      await expect(undo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const undoSurface = page.locator("[data-session-review-actions] [data-ui-focus-group] > div");
      const file = page.locator(".agent-markdown code").filter({ hasText: "src/example.ts" });
      await expect(file).toBeVisible();
      for (const [name, control] of Object.entries({ review, undoSurface, file })) {
        const alpha = await control.evaluate((element) => {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d")!;
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3];
        });
        expect(alpha, name).toBeGreaterThan(0);
        expect(alpha, name).toBeLessThan(255);
      }
      await page.screenshot({
        path: `temp/verification/sessions-callers/session-review-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const directory of ["scratch-missing", "scratch-present"]) {
  test(`settled projectless session skips checkpoint review with ${directory}`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/sessions/session-usability.html?reviewFixture=${directory}`);
    await expect(page.getByText("The report is ready for review.", { exact: false })).toBeVisible();
    await expect(page.locator("[data-session-review-shell]")).toHaveCount(0);
    await expect(page.getByText("Could not load the changes.", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/\.bycoda-host\/scratch\/session-/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.sessionUsability.events.checkpointReads)).toBe(0);
  });
}

test("worktree checkpoint review recovers automatically while recording", async ({ page }) => {
  await page.goto("/tests/browser/sessions/session-usability.html?reviewFixture=worktree-busy");
  await expect(page.locator("[data-session-review]")).toContainText("1 file changed");
  expect(await page.evaluate(() => window.sessionUsability.events.checkpointReads)).toBe(2);
  expect(await page.evaluate(() => window.sessionUsability.events.checkpointDirectories)).toEqual([
    "/fixture-worktree",
    "/fixture-worktree",
  ]);
});

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`model accounts caller visual ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?accountFixture${light ? "&light" : ""}`,
      );
      await page.getByRole("button", { name: /Claude Code Claude Sonnet research model/ }).click();
      await expect(page.getByText("Work", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/sessions-callers/model-accounts-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`sessions caller visual ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?attachmentToken${light ? "&light" : ""}`,
      );
      await expect(
        page.getByText("The report is ready for review.", { exact: false }),
      ).toBeVisible();
      const folder = "temp/verification/sessions-callers";
      const theme = light ? "light" : "dark";
      await page.screenshot({ path: `${folder}/pane-${theme}-${width}.png` });
      await page.getByText("The report is ready for review.", { exact: false }).hover();
      await expect(page.getByRole("button", { name: /Second opinion/ })).toBeVisible();
      await page.screenshot({ path: `${folder}/second-opinion-${theme}-${width}.png` });
      await page.getByText("workspace-report.csv", { exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({ path: `${folder}/attachment-preview-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: /Find in conversation/ }).click();
      await expect(page.getByRole("textbox", { name: "Find in conversation" })).toBeVisible();
      await page.screenshot({ path: `${folder}/find-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      const composer = page.getByRole("textbox", { name: "Message", exact: true });
      await composer.fill("@report");
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.screenshot({ path: `${folder}/file-mention-${theme}-${width}.png` });
      await composer.fill("Keep this integrated draft");
      await page.evaluate(() => window.sessionUsability.mode("unknown"));
      await expect(page.getByText(/delivery/i).first()).toBeVisible();
      await page.screenshot({ path: `${folder}/delivery-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Edit queued message", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Edit queued message" })).toBeVisible();
      await page.screenshot({ path: `${folder}/queue-edit-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.sessionUsability.mode("tools"));
      await expect(page.getByText("pnpm test", { exact: false }).first()).toBeVisible();
      await page.screenshot({ path: `${folder}/activity-${theme}-${width}.png` });
    });

for (const light of [false, true]) {
  test(`composer action menu stays compact and keeps keyboard selection stable in ${light ? "light" : "dark"}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/sessions/session-usability.html${light ? "?light" : ""}`);
    const input = page.getByRole("textbox");
    const addTrigger = page.getByRole("button", {
      name: "Add files or skills",
      exact: true,
    });
    const addMenu = page.getByRole("menu", {
      name: "Add files or skills",
      exact: true,
    });
    const trigger = page.getByRole("button", { name: "Mode", exact: true });
    const menu = page.getByRole("menu", { name: "Mode", exact: true });
    const geometryOf = (target: typeof menu) =>
      target.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return {
          inside:
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            bounds.top >= 0 &&
            bounds.bottom <= innerHeight,
          rows: [...node.querySelectorAll("button")].map((row) => {
            const icon = row.children[0].getBoundingClientRect();
            const copy = row.children[1].getBoundingClientRect();
            return {
              aligned: icon.right <= copy.left,
              fits: row.scrollWidth <= row.clientWidth + 1,
            };
          }),
        };
      });
    for (const width of [390, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await addTrigger.focus();
      await addTrigger.press("ArrowDown");
      await expect(
        addMenu.getByRole("menuitem", { name: "Upload file", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(addMenu.getByRole("menuitem", { name: "Skills", exact: true })).toBeFocused();
      const addGeometry = await geometryOf(addMenu);
      expect(addGeometry.inside).toBe(true);
      expect(addGeometry.rows).toHaveLength(2);
      expect(addGeometry.rows.every((row) => row.aligned && row.fits)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(addMenu).toHaveCount(0);
      await expect(addTrigger).toBeFocused();

      await trigger.focus();
      await trigger.press("ArrowDown");
      const plan = menu.getByRole("menuitemcheckbox", {
        name: "Plan mode",
        exact: true,
      });
      await expect(plan).toBeFocused();
      const initialHeight = (await plan.boundingBox())!.height;
      await plan.press("Enter");
      await expect(menu).toHaveCount(0);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("Keep this integrated draft");
      await trigger.click();
      await expect(plan).toHaveAttribute("aria-checked", "true");
      expect(Math.abs((await plan.boundingBox())!.height - initialHeight)).toBeLessThan(1);
      const geometry = await geometryOf(menu);
      expect(geometry.inside).toBe(true);
      expect(geometry.rows).toHaveLength(4);
      expect(geometry.rows.every((row) => row.aligned && row.fits)).toBe(true);
      await page.screenshot({
        path: info.outputPath(`composer-menu-${width}.png`),
      });
      await plan.click();
      await trigger.click();
      await expect(plan).toHaveAttribute("aria-checked", "false");
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(input).toHaveValue("Keep this integrated draft");
    }
    expect(await page.evaluate(() => window.sessionUsability.events.sends)).toBe(0);
  });

  test(`translated composer menu keeps long descriptions readable in ${light ? "light" : "dark"}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(
      `/tests/browser/sessions/session-usability.html?lang=tr${light ? "&light" : ""}`,
    );
    const trigger = page.getByRole("button", { name: "Mod", exact: true });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Mod", exact: true });
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "Plan modu", exact: true }),
    ).toBeFocused();
    const fits = await menu.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight &&
        [...node.querySelectorAll("button[aria-description]")].every((row) => {
          const description = row.children[1].lastElementChild!;
          return (
            description.scrollWidth <= description.clientWidth + 1 &&
            description.scrollHeight <= description.clientHeight + 1
          );
        })
      );
    });
    expect(fits).toBe(true);
    await page.screenshot({
      path: info.outputPath("composer-menu-tr-390.png"),
    });
    await menu.getByRole("menuitemcheckbox", { name: "Plan modu", exact: true }).click();
    await expect(page.getByRole("textbox")).toHaveValue("Keep this integrated draft");
    await expect(page.getByRole("textbox")).toBeFocused();
  });

  test(`integrated session keeps writing and recovery available in ${light ? "light" : "dark"}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/sessions/session-usability.html${light ? "?light" : ""}`);
    const input = page.getByRole("textbox");
    await expect(input).toHaveValue("Keep this integrated draft");
    await expect(page.locator(".agent-transcript")).toContainText("The report is ready for review");
    await expect(page.getByText("draft-context.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("workspace-report.csv", { exact: true })).toBeVisible();
    await expect(page.locator(".context-meter-summary")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Claude Code Claude Sonnet research model with a deliberately long descriptive name Default account",
        exact: true,
      }),
    ).toBeVisible();
    for (const width of [320, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      const send = page.getByRole("button", { name: "Send", exact: true });
      await expect(send).toBeInViewport();
      await expect(page.locator(".context-meter-summary")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`integrated-idle-${width}.png`),
      });
    }
    await input.fill("Keep this changed draft");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(input).toHaveValue("Keep this changed draft");
    expect(await page.evaluate(() => window.sessionUsability.events.sends)).toBe(1);
    await page.evaluate(() => window.sessionUsability.mode("working"));
    await page.setViewportSize({ width: 320, height: 800 });
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeInViewport();
    await page.screenshot({
      path: info.outputPath("integrated-working-320.png"),
    });
    await stop.press("Enter");
    expect(await page.evaluate(() => window.sessionUsability.events.stops)).toBe(1);
    await expect(input).toHaveValue("Keep this changed draft");
    await page.evaluate(() => window.sessionUsability.remount());
    await expect(input).toHaveValue("Keep this changed draft");
    await expect(page.getByText("draft-context.txt", { exact: true })).toBeVisible();
    await page.evaluate(() => window.sessionUsability.mode("approval"));
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    // The dock copy hides once the transcript card is observed on screen: one decision, one place.
    await expect(allow).toHaveCount(1);
    await expect(allow).toBeVisible();
    await page.screenshot({
      path: info.outputPath("integrated-approval-320.png"),
    });
    await allow.press("Enter");
    expect(await page.evaluate(() => window.sessionUsability.events.approvals)).toBe(1);
    await page.evaluate(() => window.sessionUsability.mode("unknown"));
    await expect(page.locator("[data-delivery-progress]")).toHaveAttribute(
      "data-delivery-progress",
      "unknown",
    );
    // An unconfirmed row is settled by the owner's explicit choice on that row, never by a blind
    // header Resume: Resume is absent, and "Send again" is the only way to resend it.
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
    await expect(input).toHaveValue("Keep this changed draft");
    // The unconfirmed message stays visible in its queue row, which carries the settling control (the pane banner steps aside).
    const retained = "Retained follow-up with unknown delivery";
    const queueRows = page.locator("[data-message-queue-rows]");
    await expect(queueRows.getByRole("button", { name: "Send again", exact: true })).toHaveCount(1);
    const queuedMessage = queueRows.getByText(retained, { exact: true });
    await expect(queuedMessage).toHaveCount(1);
    await expect(queuedMessage).toBeVisible();
    await expect(
      queueRows.getByRole("button", { name: "Remove queued message", exact: true }),
    ).toHaveCount(1);
    // The row's own delivery control is where the owner settles it; nothing was resent meanwhile.
    await expect(
      page
        .locator("[data-delivery-progress]")
        .getByRole("button", { name: "Send again", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.sessionUsability.events.queueAttempts)).toBe(0);
    await page.screenshot({
      path: info.outputPath("integrated-unknown-320.png"),
    });
    expect(errors).toEqual([]);
  });
}

for (const mode of ["folders", "imports"] as const)
  for (const light of [true, false])
    for (const width of [800, 1280])
      test(`control dialogs geometry ${mode} ${light ? "light" : "dark"} ${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `/tests/browser/sessions/session-usability.html?controlDialogs=${mode}${light ? "&light" : ""}`,
        );
        const control =
          mode === "folders"
            ? page.locator("[data-checkbox-row]").filter({ hasText: "extra" })
            : page.getByRole("switch", { name: /Show automation runs/ });
        if (mode === "imports") {
          await page.getByRole("searchbox", { name: "Filter sessions" }).focus();
          await page.getByRole("button", { name: "Conversation filters" }).click();
        }
        await expect(control).toBeVisible();
        const geometry = await control.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            left: style.paddingLeft,
            right: style.paddingRight,
            top: style.paddingTop,
            bottom: style.paddingBottom,
          };
        });
        expect(geometry).toEqual({ left: "8px", right: "8px", top: "6px", bottom: "6px" });
        await page.screenshot({
          path: `temp/verification/feature-controls/${mode}-${light ? "light" : "dark"}-${width}.png`,
        });
      });

test("focused dialog tooltip does not block adjacent filters", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/tests/browser/sessions/session-usability.html?controlDialogs=imports&light");
  await expect(page.getByRole("tooltip").filter({ hasText: "Close" })).toBeVisible();
  await page.getByRole("button", { name: "Conversation filters" }).click({ timeout: 3000 });
  await expect(page.getByRole("switch", { name: /Show automation runs/ })).toBeVisible();
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`import failure surface ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?controlDialogs=imports${theme === "light" ? "&light" : ""}`,
      );
      await page.getByRole("button", { name: "Import 1" }).click();
      await expect(page.getByText("Fixture transcript unavailable")).toBeVisible();
      await expect(page.getByText("Conversations that could not be imported: 1")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/import-failure-${theme}-${width}.png`,
      });
    });

test("import folder separators follow present and missing composition", async ({ page }) => {
  for (const mode of ["present", "mixed"]) {
    await page.goto(
      `/tests/browser/sessions/session-usability.html?controlDialogs=imports&folderComposition=${mode}&light`,
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /project.*1/ })).toBeVisible();
    if (mode === "mixed") await dialog.getByRole("button", { name: /Missing folders/ }).click();
    const sections = dialog.locator('section[data-surface-edge="bottom"]');
    await expect(sections).toHaveCount(mode === "mixed" ? 4 : 2);
    const borders = await sections.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).borderBottomWidth),
    );
    expect(borders).toEqual(mode === "mixed" ? ["1px", "1px", "1px", "0px"] : ["1px", "0px"]);
  }
});

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`rewound history divider ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?rewindFixture${light ? "&light" : ""}`,
      );
      const history = page.locator("[data-rewind-history]");
      await expect(history).toBeVisible();
      await history.getByText("Rewound history (1)").click();
      await expect(history.getByText("Earlier fixture message")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/rewind-${light ? "light" : "dark"}-${width}.png`,
      });
    });

test("provider sign in logo actual surface geometry", async ({ page }) => {
  await page.goto("/tests/browser/sessions/session-usability.html?providerSignIn&light");
  const well = page.getByRole("status").locator('[data-surface-ring="pane"]');
  await expect(well).toBeVisible();
  const geometry = await well.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      radius: style.borderRadius,
      shadow: style.boxShadow,
      card: style.getPropertyValue("--ui-radius-card"),
      panel: style.getPropertyValue("--ui-radius-panel"),
    };
  });
  console.log("PROVIDER_SURFACE", JSON.stringify(geometry));
});

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`provider well geometry ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?providerSignIn${light ? "&light" : ""}`,
      );
      const well = page.getByRole("status").locator('[data-surface-ring="pane"]');
      await expect(well).toHaveCSS("border-radius", "16px");
      expect(await well.evaluate((node) => getComputedStyle(node).boxShadow)).toContain("inset");
      await page.screenshot({
        path: `temp/verification/feature-controls/provider-well-${light ? "light" : "dark"}-${width}.png`,
      });
    });
for (const light of [true, false])
  for (const width of [800, 1280])
    test(`import more and expanded resume ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?controlDialogs=imports&manyImports${light ? "&light" : ""}`,
      );
      const more = page.getByRole("button", { name: "Show 1 more" });
      await expect(more).toBeVisible();
      await expect(more.locator("..")).toHaveCSS("padding-left", "36px");
      await more.screenshot({ path: info.outputPath(`import-more-${light}-${width}.png`) });
      await more.click();
      await expect(more).toHaveCount(0);
      await page.goto(
        `/tests/browser/sessions/session-usability.html?resumeFixture${light ? "&light" : ""}`,
      );
      const row = page.locator("[data-resume-turn]");
      await row.locator("summary").click();
      const text = row.getByText("Continue the retained draft.");
      await expect(text).toBeVisible();
      await expect(text).toHaveCSS("padding-inline-start", "28px");
      await row.screenshot({ path: info.outputPath(`resume-${light}-${width}.png`) });
    });
for (const light of [true, false])
  for (const width of [800, 1280])
    test(`project background and mascot ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const suffix = light ? "&light" : "";
      await page.goto(
        `/tests/browser/sessions/session-usability.html?projectVisual=background${suffix}`,
      );
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const preview = dialog.locator("img.object-cover");
      await expect(preview).toHaveCSS("opacity", "0.2");
      await expect
        .poll(() => preview.evaluate((node: HTMLImageElement) => node.naturalWidth))
        .toBeGreaterThan(0);
      await dialog.screenshot({
        path: info.outputPath(`project-background-${light}-${width}.png`),
      });
      await page.goto(`/tests/browser/sessions/session-usability.html?projectVisual=rail${suffix}`);
      const swatch = page
        .getByRole("button", { name: "Expanded contents" })
        .locator("[data-surface-variant=user-color]");
      await expect(swatch).toHaveCSS("background-color", "rgb(18, 52, 86)");
      await swatch.screenshot({ path: info.outputPath(`project-swatch-${light}-${width}.png`) });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?projectVisual=mascot${suffix}`,
      );
      await page.getByRole("button", { name: "Codex usage details" }).click();
      const mascot = page.locator('[data-reset-mascot-mood="happy"] svg');
      await expect(mascot).toBeVisible();
      await mascot.screenshot({ path: info.outputPath(`project-mascot-${light}-${width}.png`) });
      const usage = page.getByRole("dialog", { name: "Codex usage details" });
      const heading = usage.getByRole("heading", { name: "Codex usage", exact: true });
      const refresh = usage.getByRole("button", { name: "Refresh usage" });
      await expect(refresh).toBeVisible();
      await usage.screenshot({ path: info.outputPath(`codex-usage-${light}-${width}.png`) });
      const headingBox = (await heading.boundingBox())!;
      const refreshBox = (await refresh.boundingBox())!;
      expect(refreshBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
      expect(
        Math.abs(refreshBox.y + refreshBox.height / 2 - headingBox.y - headingBox.height / 2),
      ).toBeLessThanOrEqual(1);
    });
for (const light of [true, false])
  for (const width of [800, 1280])
    test(`provider account usage caller ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-usability.html?accountUsageFixture${light ? "&light" : ""}`,
      );
      await expect(page.getByLabel("Loading…").first()).toBeVisible();
      await expect(page.getByText("5h", { exact: false }).first()).toBeVisible();
      await page.screenshot({ path: info.outputPath(`provider-usage-${light}-${width}.png`) });
    });
for (const width of [800, 1280]) {
  test(`social discussion keeps its real composer mounted at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/browser/sessions/session-usability.html?socialDiscussion");
    await page.getByRole("button", { name: "AI chat", exact: true }).click();
    const composer = page.locator("[data-composer-box] textarea");
    await expect(composer).toBeVisible();
    await composer.fill("Keep this social draft");
    // The app's idle-detach timer runs after 250 ms; the real pane must survive it.
    await page.waitForTimeout(350);
    await expect(composer).toHaveValue("Keep this social draft");
    await page
      .getByRole("button", { name: width === 800 ? "Close" : "Close panel", exact: true })
      .click();
    await page.getByRole("button", { name: "AI chat", exact: true }).click();
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue("Keep this social draft");
    expect(errors).toEqual([]);
  });
}

test("a referenced draft with one very long wrapped line keeps its caret in view and its undo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto("/tests/browser/sessions/session-usability.html?machineFixture=project");
  const field = page.locator("[data-composer-box] textarea");
  const editor = page.locator("[data-composer-box] .cm-editor");
  const link = "https://example.com/fixture ";
  await field.fill(link);
  await expect(editor).toHaveCount(1);
  // Cross the long-line limit inside the editor, then undo and redo the insertion.
  const rest = "a b ".repeat(16384).slice(0, 65536 - link.length);
  const draft = link + rest;
  await page.locator("[data-composer-box] .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(rest);
  await expect(editor).toHaveCount(0);
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(draft);
  // The caret line counts as in view when at least half of it is: its glyphs sit centred in the
  // line box, so the scroll offset beside the padding depends on the font (about 1px on Windows,
  // 3px with the Linux fallback font), never on the layout under test.
  const atBottom = () =>
    field.evaluate(
      (input) =>
        input.scrollHeight - input.scrollTop - input.clientHeight <=
        parseFloat(getComputedStyle(input).paddingBottom) +
          parseFloat(getComputedStyle(input).lineHeight) / 2,
    );
  await expect.poll(atBottom).toBe(true);
  await page.keyboard.press("Control+z");
  await expect(field).toHaveValue(link);
  await page.keyboard.press("Control+Shift+z");
  await expect(field).toHaveValue(draft);
  await field.focus();
  await page.keyboard.press("Control+Home");
  await expect
    .poll(() =>
      field.evaluate(
        (input: HTMLTextAreaElement) =>
          input.selectionEnd === 0 &&
          input.scrollTop <=
            parseFloat(getComputedStyle(input).paddingTop) +
              parseFloat(getComputedStyle(input).lineHeight) / 2,
      ),
    )
    .toBe(true);
  await page.keyboard.press("Control+End");
  await expect.poll(atBottom).toBe(true);
  expect(await field.evaluate((input: HTMLTextAreaElement) => input.selectionEnd)).toBe(
    draft.length,
  );
  await page.keyboard.type("xy");
  await expect(field).toHaveValue(draft + "xy");
  await expect.poll(atBottom).toBe(true);
  await expect(editor).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

for (const light of [false, true]) {
  test(`composer action menu stays compact and keeps keyboard selection stable in ${light ? "light" : "dark"}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/session-usability.html${light ? "?light" : ""}`);
    const input = page.getByRole("textbox");
    const trigger = page.getByRole("button", { name: "Add files or choose a mode", exact: true });
    const menu = page.getByRole("menu", { name: "Add files or choose a mode", exact: true });
    for (const width of [390, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await trigger.focus();
      await trigger.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: "Upload file", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: "Skills", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      const plan = menu.getByRole("menuitemcheckbox", { name: "Plan mode", exact: true });
      await expect(plan).toBeFocused();
      const initialHeight = (await plan.boundingBox())!.height;
      await plan.press("Enter");
      await expect(menu).toHaveCount(0);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("Keep this integrated draft");
      await trigger.click();
      await expect(plan).toHaveAttribute("aria-checked", "true");
      expect(Math.abs((await plan.boundingBox())!.height - initialHeight)).toBeLessThan(1);
      const geometry = await menu.evaluate((node) => {
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
      expect(geometry.inside).toBe(true);
      expect(geometry.rows).toHaveLength(6);
      expect(geometry.rows.every((row) => row.aligned && row.fits)).toBe(true);
      await page.screenshot({ path: info.outputPath(`composer-menu-${width}.png`) });
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
    await page.goto(`/tests/browser/session-usability.html?lang=tr${light ? "&light" : ""}`);
    const trigger = page.getByRole("button", {
      name: "Dosya ekleyin veya bir mod seçin",
      exact: true,
    });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Dosya ekleyin veya bir mod seçin", exact: true });
    await expect(menu.getByRole("menuitem", { name: "Dosya yükle", exact: true })).toBeFocused();
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
    await page.screenshot({ path: info.outputPath("composer-menu-tr-390.png") });
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
    await page.goto(`/tests/browser/session-usability.html${light ? "?light" : ""}`);
    const input = page.getByRole("textbox");
    await expect(input).toHaveValue("Keep this integrated draft");
    await expect(page.locator(".agent-transcript")).toContainText("The report is ready for review");
    await expect(page.getByText("draft-context.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("workspace-report.csv", { exact: true })).toBeVisible();
    await expect(page.locator(".context-meter-summary")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Claude Code Claude Sonnet research model with a deliberately long descriptive name",
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
      await page.screenshot({ path: info.outputPath(`integrated-idle-${width}.png`) });
    }
    await input.fill("Keep this changed draft");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(input).toHaveValue("Keep this changed draft");
    expect(await page.evaluate(() => window.sessionUsability.events.sends)).toBe(1);
    await page.evaluate(() => window.sessionUsability.mode("working"));
    await page.setViewportSize({ width: 320, height: 800 });
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeInViewport();
    await page.screenshot({ path: info.outputPath("integrated-working-320.png") });
    await stop.press("Enter");
    expect(await page.evaluate(() => window.sessionUsability.events.stops)).toBe(1);
    await expect(input).toHaveValue("Keep this changed draft");
    await page.evaluate(() => window.sessionUsability.remount());
    await expect(input).toHaveValue("Keep this changed draft");
    await expect(page.getByText("draft-context.txt", { exact: true })).toBeVisible();
    await page.evaluate(() => window.sessionUsability.mode("approval"));
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    await expect(allow).toBeVisible();
    await page.screenshot({ path: info.outputPath("integrated-approval-320.png") });
    await allow.press("Enter");
    expect(await page.evaluate(() => window.sessionUsability.events.approvals)).toBe(1);
    await page.evaluate(() => window.sessionUsability.mode("unknown"));
    await expect(page.locator("[data-delivery-progress]")).toHaveAttribute(
      "data-delivery-progress",
      "unknown",
    );
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
    await expect(input).toHaveValue("Keep this changed draft");
    await expect(
      page.getByText("Retained follow-up with unknown delivery", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.sessionUsability.events.queueAttempts)).toBe(0);
    await page.screenshot({ path: info.outputPath("integrated-unknown-320.png") });
    expect(errors).toEqual([]);
  });
}

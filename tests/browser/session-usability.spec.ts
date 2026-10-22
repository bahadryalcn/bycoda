import { expect, test } from "@playwright/test";

for (const light of [false, true]) {
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

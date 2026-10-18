import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [320, 542]) {
    test(`long trail and resized composer stay within ${width}px ${theme} panel`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 500 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/subagent-relay.html?layout");
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
      await page.goto("/tests/browser/subagent-relay.html");
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
    await page.goto(`/tests/browser/subagent-relay.html?${mode}`);
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

import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1100]) {
    test(`question lifecycle preserves answers at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/question-flow.html?theme=${theme}`);
      const form = page.locator("[data-question-form]");
      await expect(form.getByRole("status")).toHaveText("Waiting for your answer");
      await page.screenshot({
        path: `temp/verification/2026-10-26-question-flow/free-answer-${theme}-${width}.png`,
        fullPage: true,
      });
      const answer = form.getByRole("textbox", { name: "Type your answer" });
      await answer.fill("Windows and macOS.\nKeep unfinished drafts and keyboard navigation.");
      await page.getByRole("button", { name: "Hide question", exact: true }).click();
      await page.getByRole("button", { name: "Show question", exact: true }).click();
      await expect(answer).toHaveValue(
        "Windows and macOS.\nKeep unfinished drafts and keyboard navigation.",
      );
      await page.getByRole("button", { name: "Switch session", exact: true }).click();
      await expect(answer).toHaveValue("");
      await page.getByRole("button", { name: "Switch session", exact: true }).click();
      await expect(answer).toHaveValue(
        "Windows and macOS.\nKeep unfinished drafts and keyboard navigation.",
      );
      await page.getByRole("button", { name: "Toggle continuing work", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText(
        "Work may continue while this question is open",
      );
      const send = form.getByRole("button", { name: "Send answer", exact: true });
      await send.focus();
      await send.press("Enter");
      await expect(page.getByLabel("Send count")).toHaveText("1");
      await expect(form.getByRole("status")).toHaveText("Sending answer…");
      const submit = form.locator('button[type="submit"]');
      await expect(submit).toHaveText("Sending answer…");
      await expect(submit).toHaveAttribute("aria-busy", "true");
      await expect(submit).toBeFocused();
      await expect(form.getByRole("button", { name: "Cancel question", exact: true })).not.toHaveAttribute("aria-busy", "true");
      await form.screenshot({
        path: `temp/verification/2026-10-26-question-flow/question-sending-${theme}-${width}.png`,
      });
      await expect(form.locator('button[type="submit"]')).toHaveAttribute("aria-disabled", "true");
      await form
        .locator("form")
        .evaluate((node) =>
          node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      await expect(page.getByLabel("Send count")).toHaveText("1");
      await page.getByRole("button", { name: "Queue answer", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText("Answer saved · waiting to continue");
      await expect(submit).toHaveText("Waiting");
      await expect(submit).toBeDisabled();
      await expect(form.locator('[aria-busy="true"]')).toHaveCount(0);
      await form.screenshot({
        path: `temp/verification/2026-10-26-question-flow/question-queued-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Simulate uncertain delivery", exact: true }).click();
      await expect(form.getByRole("alert")).toContainText("could not be confirmed");
      await expect(form.locator('button[type="submit"]')).toBeDisabled();
      await expect(answer).toHaveValue(
        "Windows and macOS.\nKeep unfinished drafts and keyboard navigation.",
      );
      await expect(answer).toHaveAttribute("readonly", "");
      await expect(answer).toBeEnabled();
      await answer.focus();
      await expect(answer).toBeFocused();
      await page.screenshot({
        path: `temp/verification/2026-10-26-question-flow/unknown-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Simulate not sent", exact: true }).click();
      await expect(form.getByRole("alert")).toContainText("Your answer is kept");
      await expect(answer).not.toHaveAttribute("readonly", "");
      const retry = form.getByRole("button", { name: "Send again", exact: true });
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(page.getByLabel("Send count")).toHaveText("2");
      await expect(submit).toHaveAttribute("aria-busy", "true");
      await page.getByRole("button", { name: "Confirm delivery", exact: true }).click();
      const card = page.locator("[data-question-answer]");
      await expect(card).toContainText("Answered");
      await expect(card).toContainText("Windows and macOS");
      await expect(card.locator(".user-message-bubble")).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      await page.screenshot({
        path: `temp/verification/2026-10-26-question-flow/answered-${theme}-${width}.png`,
        fullPage: true,
      });
      await card.screenshot({
        path: `temp/verification/2026-10-26-question-flow/question-answer-${theme}-${width}.png`,
      });
    });
  }
}

for (const [dismiss, language, theme, width] of [
  ["cancel", "tr", "dark", 390],
  ["decline", "en", "light", 1100],
] as const) {
  test(`${dismiss} shows progress on its own button`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/tests/browser/question-flow.html?theme=${theme}&lang=${language}&dismiss=${dismiss}`);
    const form = page.locator("[data-question-form]");
    const action = form.getByRole("button", {
      name: language === "tr" ? "Soruyu iptal et" : "Decline",
      exact: true,
    });
    await action.focus();
    await action.press("Enter");
    const pending = form.locator('button[aria-busy="true"]');
    await expect(pending).toHaveCount(1);
    await expect(pending).toHaveText(language === "tr" ? "İptal ediliyor…" : "Sending…");
    await expect(pending).toBeFocused();
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.getByLabel("Send count")).toHaveText("1");
    await pending.press("Enter");
    await expect(page.getByLabel("Send count")).toHaveText("1");
    await form.screenshot({
      path: `temp/verification/2026-10-26-question-flow/question-${dismiss}-pending-${theme}-${width}.png`,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1100]) {
    test(`question choices remain explicit and keyboard accessible at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/question-flow.html?theme=${theme}&variant=choices`);
      const form = page.locator("[data-question-form]");
      await expect(form.getByRole("status")).toHaveText("Waiting for your answer");
      const first = form.getByRole("radio", { name: "Windows and macOS", exact: true });
      await first.focus();
      await first.press("Space");
      await expect(first).toBeChecked();
      await expect(page.getByLabel("Send count")).toHaveText("0");
      await first.press("ArrowDown");
      await expect(
        form.getByRole("radio", { name: "Desktop and mobile", exact: true }),
      ).toBeChecked();
      await form.screenshot({
        path: `temp/verification/2026-10-26-question-flow/question-active-${theme}-${width}.png`,
      });
      await form.getByText("Other", { exact: true }).click();
      const custom = form.getByRole("textbox", { name: "Type your answer" });
      await expect(custom).toBeFocused();
      await custom.fill("Linux first.\nKeep keyboard navigation and drafts.");
      await expect(page.getByLabel("Send count")).toHaveText("0");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await form.getByRole("button", { name: "Send answer", exact: true }).click();
      await expect(page.getByLabel("Send count")).toHaveText("1");
    });
  }
}

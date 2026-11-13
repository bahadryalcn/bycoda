import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`bulk deletion stays in one compact row at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/sessions/session-deletion.html?theme=${theme}&bulk`);
      const row = page.locator("[data-session-delete-status]");
      await expect(row).toHaveCount(1);
      await expect(page.locator("[data-session-deletion-detail]")).toHaveCount(0);
      const title = row.getByText(
        "A long conversation title that must wrap while conversation data is being removed",
        { exact: true },
      );
      const counter = row.getByText("8/10", { exact: true });
      await expect(counter).toBeVisible();
      const trash = row.locator("svg").last();
      const geometry = {
        ...(await row.evaluate((element) => ({
          overflow: element.scrollWidth > element.clientWidth,
          height: element.getBoundingClientRect().height,
        }))),
        ...(await title.evaluate((element) => ({
          clippedTitle: element.scrollWidth > element.clientWidth,
          whiteSpace: getComputedStyle(element).whiteSpace,
        }))),
      };
      expect(geometry.overflow).toBe(false);
      expect(geometry.clippedTitle).toBe(true);
      expect(geometry.whiteSpace).toBe("nowrap");
      const titleBox = (await title.boundingBox())!;
      const counterBox = (await counter.boundingBox())!;
      const trashBox = (await trash.boundingBox())!;
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(counterBox.x);
      expect(counterBox.x + counterBox.width).toBeLessThanOrEqual(trashBox.x);
      expect(
        Math.abs(titleBox.y + titleBox.height / 2 - trashBox.y - trashBox.height / 2),
      ).toBeLessThan(2);
      const pendingBox = (await row.boundingBox())!;
      await page.screenshot({
        path: `temp/verification/session-delete-row/pending-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Complete", exact: true }).click();
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("10 conversations deleted.");
      await expect(page.locator("[data-session-deletion-detail]")).toHaveCount(0);
      expect((await row.boundingBox())!.y).toBe(pendingBox.y);
      await page.screenshot({
        path: `temp/verification/session-delete-row/completed-${theme}-${width}.png`,
      });
      await row.getByRole("button", { name: "Dismiss notice", exact: true }).click();
      await expect(row).toHaveCount(0);
      await page.getByRole("button", { name: "Bulk failure", exact: true }).click();
      await expect(row).toContainText("Storage unavailable");
      await expect(row).toHaveAttribute("role", "alert");
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await row.getByRole("button", { name: "Dismiss notice", exact: true }).click();
      await expect(row).toHaveCount(0);
    });
  }
}

for (const theme of ["light", "dark"]) {
  test(`deletion clears success and preserves actionable outcomes in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/sessions/session-deletion.html?theme=${theme}`);
    const notice = page.locator("[data-session-deletion-detail]");
    await expect(notice).toContainText("Preparing deletion…");
    await expect(notice).toContainText("Still working…");
    await expect(notice.getByRole("button")).toHaveCount(0);
    await page.getByRole("button", { name: "Close processes" }).click();
    await expect(notice).toContainText("Closing agent processes…");
    await page.screenshot({ path: test.info().outputPath(`deleting-${theme}.png`) });
    await page.getByRole("button", { name: "Delete data" }).click();
    await expect(notice).toContainText("Deleting conversation data…");
    expect(await notice.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Fail", exact: true }).click();
    await expect(notice.getByRole("alert")).toContainText("Storage unavailable");
    await expect(notice).not.toContainText("Conversation deleted.");
    await notice.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(notice).toHaveCount(0);
    await page.getByRole("button", { name: "Keep worktree warning", exact: true }).click();
    await expect(notice).toContainText("Conversation deleted. Its worktree was kept.");
    await expect(notice).toContainText("Worktree cleanup unavailable");
    await page.screenshot({ path: test.info().outputPath(`cleanup-warning-${theme}.png`) });
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByText("Conversation deleted.", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`completed-${theme}.png`) });
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`deletions another device made add up in one notice at ${width} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/sessions/session-deletion.html?theme=${theme}`);
      await page.getByRole("button", { name: "Complete", exact: true }).click();
      for (let count = 0; count < 3; count += 1)
        await page.getByRole("button", { name: "Remote delete", exact: true }).click();
      const notice = page.locator('[data-remote-activity="deleted"]');
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText("Work laptop deleted 3 conversations.");
      await page.getByRole("button", { name: "Remote failure", exact: true }).click();
      await expect(notice).toContainText("1 could not be completed.");
      expect(await notice.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({
        path: `temp/verification/remote-bulk-delete/remote-notice-${theme}-${width}.png`,
      });
      await notice.getByRole("button").click();
      await expect(notice).toHaveCount(0);
    });
  }
}

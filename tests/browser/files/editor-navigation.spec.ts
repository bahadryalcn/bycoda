import { expect, test } from "@playwright/test";

test("defaulted destructuring arrows stay clean while body errors still reach lint", async ({
  page,
}) => {
  await page.goto("/tests/browser/files/editor-navigation.html");
  await expect(page.locator(".cm-editor")).toBeVisible();
  const source = `const resolveQuickButtonDate = (
  { beginDate, endDate } = {},
  { isFuture = false, startOfDay = false, endOfDay = false } = {}
) => {
  const date = isFuture ? endDate : beginDate;
  if (!date) return null;
  if (endOfDay) return dayjs(date).endOf('day').toDate();
  if (startOfDay) return dayjs(date).startOf('day').toDate();
  return date;
};`;
  const replace = (doc: string) =>
    page.evaluate((doc) => (window as any).editorFixture.replace(doc), doc);
  await replace(source.replace("return date;", "const broken = ;"));
  await expect(page.locator("#errors")).not.toHaveText("0");
  await expect(page.locator(".cm-lintRange-error").first()).toBeVisible();
  await replace(source);
  await expect(page.locator("#errors")).toHaveText("0");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
  await page.screenshot({
    path: "temp/verification/2026-11-10-editor-false-syntax/valid-arrow.png",
  });
});

test("JSX in .js stays clean and real Ctrl/Cmd gestures follow aliases and local definitions", async ({
  page,
}) => {
  await page.goto("/tests/browser/files/editor-navigation.html");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#errors")).toHaveText("0");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
  const point = (needle: string) =>
    page.evaluate((needle) => (window as any).editorFixture.point(needle), needle);
  const run = await point("runRefund()");
  await page.mouse.click(run.x, run.y);
  await expect(page.locator("#navigation")).toBeEmpty();
  for (const modifier of ["Control", "Meta"]) {
    await page.keyboard.down(modifier);
    await page.mouse.move(run.x + 2, run.y);
    await page.mouse.move(run.x, run.y);
    await expect(page.locator(".cm-definition-link")).toHaveCount(1);
    await page.mouse.click(run.x, run.y);
    await page.keyboard.up(modifier);
    await expect(page.locator(".cm-definition-link")).toHaveCount(0);
    await expect(page.locator("#navigation")).toHaveText(
      '{"path":"/fixture/src/refund.js","line":1,"column":17}',
    );
    await page.locator("#navigation").evaluate((element) => {
      element.textContent = "";
    });
  }
  const local = await point("onClick}");
  await page.mouse.click(local.x, local.y);
  await page.keyboard.press("F12");
  expect(await page.evaluate(() => (window as any).editorFixture.head())).toBe(
    await page.evaluate(() => (window as any).editorFixture.definition),
  );
});

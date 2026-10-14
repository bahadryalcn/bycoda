import { test, expect } from "@playwright/test";

test("merge editor selects individual source conflicts, preserves manual edits and undo across layouts", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/merge-conflicts.html");
  const output = page.getByRole("textbox", { name: "Resolved output", exact: true });
  await expect(output).toContainText("price=80");
  await expect(output).not.toContainText("<<<<<<<");
  await expect(page.getByRole("status")).toContainText("Conflict 1 of 2 · 2 unresolved");
  await page.getByRole("button", { name: "Use current", exact: true }).click();
  await expect(output).toContainText("price=100");
  await expect(page.getByRole("button", { name: "Save and stage", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next conflict", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Conflict 2 of 2 · 1 unresolved");
  await page.getByRole("button", { name: "Use incoming", exact: true }).click();
  await expect(output).toContainText("name=incoming");
  const text = await output.innerText();
  await output.fill(text.replace("name=incoming", "name=custom"));
  await page.getByRole("button", { name: "Use edited result", exact: true }).click();
  await page.getByRole("button", { name: "Three column", exact: true }).click();
  await expect(output).toContainText("name=custom");
  await page.screenshot({ path: info.outputPath("three-column.png") });
  await page.getByRole("button", { name: "Twin source", exact: true }).click();
  await expect(output).toContainText("name=custom");
  await page.screenshot({ path: info.outputPath("twin-source.png") });
  await page.getByRole("button", { name: "Save and stage", exact: true }).click();
  await expect(page.getByText("All conflicts resolved", { exact: true })).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (window as unknown as { mergeCalls: { command: string; args: { content?: string } }[] })
        .mergeCalls,
  );
  expect(calls.map((call) => call.command).slice(-2)).toEqual([
    "write_text_file",
    "git_stage_file",
  ]);
  expect(calls.find((call) => call.command === "write_text_file")?.args.content).toContain(
    "name=custom",
  );
  expect(calls.find((call) => call.command === "write_text_file")?.args.content).not.toContain(
    "<<<<<<<",
  );
});

test("merge editor Ctrl+F searches each pane independently and source text remains read only", async ({
  page,
}) => {
  await page.goto("/tests/browser/merge-conflicts.html");
  const panes = [".conflict-pane-ours", ".conflict-pane-theirs", ".conflict-pane-result"];
  const queries = ["price=100", "price=120", "price=80"];
  for (const [index, selector] of panes.entries()) {
    const pane = page.locator(selector);
    const content = pane.locator(".cm-content");
    await content.focus();
    await content.press("Control+f");
    const input = pane.locator('input[name="search"]');
    await expect(input).toBeVisible();
    await input.fill(queries[index]);
    await input.press("Enter");
    await expect(pane.locator(".cm-searchMatch").first()).toBeVisible();
  }
  for (const [index, selector] of panes.entries()) {
    await expect(page.locator(selector).locator('input[name="search"]')).toHaveValue(
      queries[index],
    );
  }
  const ours = page.locator(".conflict-pane-ours .cm-content");
  await ours.focus();
  await ours.press("x");
  await expect(ours).toContainText("price=100");
  await expect(ours).toHaveAttribute("contenteditable", "false");
});

test("merge editor keyboard navigation, undo and narrow light layout keep all decisions accessible", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/merge-conflicts.html?light");
  const current = page.getByRole("button", { name: "Use current", exact: true });
  await current.focus();
  await current.press("Enter");
  const output = page.getByRole("textbox", { name: "Resolved output", exact: true });
  await output.focus();
  await output.press("Control+z");
  await expect(output).toContainText("price=80");
  await expect(page.getByRole("status")).toContainText("2 unresolved");
  await page.getByRole("button", { name: "Next conflict", exact: true }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Conflict 2 of 2");
  await page.getByRole("button", { name: "Previous conflict", exact: true }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Conflict 1 of 2");
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator(".conflict-pane-ours")).toBeVisible();
  await expect(page.locator(".conflict-pane-theirs")).toBeVisible();
  await expect(output).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("narrow-light.png") });
});

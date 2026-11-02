import { test, expect } from "@playwright/test";

// Leave room for the cold Vite module graph before the interaction assertions.
test.setTimeout(120_000);

test("Git generation exposes advisor controls in a narrow panel and keeps the draft", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
  await page.setViewportSize({ width: 300, height: 780 });
  await page.goto("/tests/browser/git-generation.html");
  await expect(page.getByText("Main model", { exact: true })).toHaveCount(0);
  const extrasBounds = (await page
    .getByRole("button", { name: "AI generation settings" })
    .boundingBox())!;
  const generateBounds = (await page
    .getByRole("button", { name: "Generate commit message", exact: true })
    .boundingBox())!;
  expect(Math.abs(extrasBounds.y - generateBounds.y)).toBeLessThan(2);
  expect(Math.abs(extrasBounds.x - (generateBounds.x + generateBounds.width))).toBeLessThan(2);
  // Without a saved choice the trigger hint reports the automatic selection.
  await page.getByRole("button", { name: "AI generation settings" }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Automatic");
  await page.getByRole("button", { name: "AI generation settings" }).click();
  await expect(
    page.getByRole("dialog", { name: "Commit and pull request generation", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Main model", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Extras", exact: true })).toHaveCount(0);
  // Advisor and subagent settings are rows of the one model menu (no separate Extras entry).
  const modelButton = page.getByRole("button", { name: /Claude Haiku 4.5/ });
  const menu = page.getByRole("menu", { name: "Model and settings", exact: true });
  const row = (name: string) =>
    menu.getByRole("menuitem").filter({ has: page.getByText(name, { exact: true }) });
  const choose = async (name: string, option: string) => {
    if (!(await menu.isVisible())) await modelButton.click();
    // Hovering a row opens its flyout; in this narrow panel the flyout covers the row itself,
    // so only click the row when hovering did not open it.
    await row(name).hover();
    const flyout = page.getByRole("menu", { name, exact: true });
    await flyout.waitFor({ timeout: 1000 }).catch(() => row(name).click());
    await flyout.getByRole("menuitemradio", { name: option, exact: true }).click();
  };
  await modelButton.click();
  await expect(row("Advisor")).toBeVisible();
  await expect(row("Advisor")).toHaveCSS("color-scheme", "dark");
  await choose("Advisor", "Opus");
  await choose("Subagent model", "Haiku");
  await choose("Subagent model policy", "Apply to all subagents");
  await expect(page.getByTestId("choice")).toHaveText(/"advisor":"opus"/);
  await expect(page.getByTestId("choice")).toHaveText(/"subagentModel":"haiku"/);
  await expect(page.getByTestId("choice")).toHaveText(/"subagentPolicy":"force"/);
  await expect(page.getByTestId("choice")).toHaveText(/"model":"claude:haiku-4.5"/);
  await expect(page.getByRole("textbox", { name: "Commit message" })).toHaveValue(
    "Keep this commit draft",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("git-generation-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: testInfo.outputPath("git-generation-main-and-extras.png"),
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "AI generation settings" })).toHaveText("");
  await page.getByRole("button", { name: "AI generation settings" }).click();
  // A saved project choice offers one way back to the global selection.
  await page.getByRole("button", { name: "Use global" }).click();
  await expect(page.getByTestId("choice")).toHaveText("");
});

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
  await page.getByRole("button", { name: "AI generation settings" }).click();
  await expect(page.getByText("Automatic · Claude Haiku 4.5", { exact: true })).toBeVisible();
  await expect(page.getByText("Main model", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Extras", exact: true }).click();
  const advisor = page.getByRole("combobox", { name: "Advisor", exact: true });
  await expect(advisor).toBeVisible();
  await expect(advisor).toHaveCSS("color-scheme", "dark");
  await advisor.selectOption("opus");
  await page.getByRole("combobox", { name: "Subagent model", exact: true }).selectOption("haiku");
  await page
    .getByRole("combobox", { name: "Subagent model policy", exact: true })
    .selectOption("force");
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
  await page.getByRole("button", { name: "Use automatic selection" }).click();
  await expect(page.getByTestId("choice")).toHaveText("");
});

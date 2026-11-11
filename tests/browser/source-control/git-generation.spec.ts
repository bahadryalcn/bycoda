import { test, expect } from "@playwright/test";

// Leave room for the cold Vite module graph before the interaction assertions.
test.setTimeout(120_000);

test("Git generation exposes advisor controls in a narrow panel and keeps the draft", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
  await page.setViewportSize({ width: 300, height: 780 });
  await page.goto("/tests/browser/source-control/git-generation.html");
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
  // Advisor and subagent settings live in the one model panel (no separate Extras entry).
  const modelButton = page.getByRole("button", { name: /Claude Haiku 4.5/ });
  const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
  const setting = (name: string) =>
    panel
      .locator("[data-model-settings]")
      .locator(`[role="radiogroup"][aria-label="${name}"], [role="group"][aria-label="${name}"]`);
  const choose = async (name: string, option: string | RegExp) => {
    if (!(await panel.isVisible())) await modelButton.click();
    // Delegation settings sit on the Agents tab when the model also has its own settings.
    const agents = panel.getByRole("tab", { name: /^Agents/ });
    if ((await agents.count()) > 0 && (await agents.getAttribute("aria-selected")) !== "true")
      await agents.click();
    const choice = setting(name)
      .getByRole("radio", { name: option, exact: true })
      .or(setting(name).getByRole("checkbox", { name: option, exact: true }));
    await choice.click();
    await expect(choice).toHaveAttribute("aria-checked", "true");
  };
  // Delegation values are encoded refs inside the saved model settings.
  const saved = async () => {
    const choice = JSON.parse((await page.getByTestId("choice").textContent()) || "{}");
    const settings: Record<string, string> = choice.modelSettings ?? {};
    const decode = (value?: string) => (value ? JSON.parse(value) : null);
    return {
      model: choice.model,
      advisor: decode(settings.crossAdvisor)?.model ?? null,
      subagents: ([] as { model: string }[])
        .concat(decode(settings.crossSubagents) ?? [])
        .map((ref) => ref.model),
      subagentPolicy: settings.subagentPolicy,
    };
  };
  await modelButton.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-model-panel");
  const advisorField = panel.locator("[data-model-settings]").getByRole("button", {
    name: /^Advisor\b/,
  });
  // Advisor and Subagents open a picker in the settings column; options are named by model
  // alone because the provider heading carries the "Claude Code · " prefix.
  const delegate = async (name: "Advisor" | "Subagents", option: RegExp) => {
    if (!(await panel.isVisible())) await modelButton.click();
    const agents = panel.getByRole("tab", { name: /^Agents/ });
    if ((await agents.count()) > 0 && (await agents.getAttribute("aria-selected")) !== "true")
      await agents.click();
    const picker = panel.locator("[data-model-setting-picker]");
    if (name === "Advisor") await advisorField.click();
    else await setting(name).getByRole("button", { name: "Add", exact: true }).click();
    await expect(picker).toBeVisible();
    await picker
      .getByRole("radio", { name: option })
      .or(picker.getByRole("checkbox", { name: option }))
      .click();
    if (name === "Subagents")
      await picker.getByRole("button", { name: "Done", exact: true }).click();
    await expect(picker).toHaveCount(0);
  };
  await delegate("Advisor", /^Claude Opus 5\.5\b/);
  await expect(advisorField).toContainText("Claude Opus 5.5");
  await expect(panel.locator("[data-model-settings]")).toHaveCSS("color-scheme", "dark");
  await delegate("Subagents", /^Claude Haiku 4\.5\b/);
  await choose("Subagent model policy", "Apply to all");
  await expect.poll(saved).toEqual({
    model: "claude:haiku-4.5",
    advisor: "claude:opus-5-5",
    subagents: ["claude:haiku-4.5"],
    subagentPolicy: "force",
  });
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

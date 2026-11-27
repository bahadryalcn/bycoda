import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Leave room for the cold Vite module graph before the interaction assertions.
test.setTimeout(120_000);

test("commit generation notice fits the narrow Changes panel and closes from the keyboard", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
  const evidence = "temp/verification/git-generation-notice";
  mkdirSync(evidence, { recursive: true });
  for (const variant of ["review", "suggestion"]) {
    await page.goto(`/tests/browser/source-control/git-generation.html?notice&${variant}`);
    const notice = page
      .getByRole("status")
      .filter({ hasText: /Review the message|AI message ready/ });
    const dismiss = page.getByRole("button", { name: "Dismiss notice" });
    const draft = page.getByRole("textbox", { name: "Commit message" });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      for (const width of [1280, 800, 300]) {
        await page.setViewportSize({ width, height: 320 });
        await expect(dismiss).toBeVisible();
        const copy = (await notice.boundingBox())!;
        const close = (await dismiss.boundingBox())!;
        expect(copy.x + copy.width).toBeLessThanOrEqual(close.x);
        expect(Math.abs(copy.y + copy.height / 2 - close.y - close.height / 2)).toBeLessThan(2);
        await page.getByRole("complementary").screenshot({
          path: `${evidence}/${variant}-${theme}-${width}.png`,
          animations: "disabled",
        });
      }
    }
    await dismiss.focus();
    await page.keyboard.press("Enter");
    await expect(notice).toHaveCount(0);
    await expect(draft).toHaveValue("Describe the staged changes");
  }
});

test("commit generation keeps model, effort and speed together beside the wand", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
  await page.goto("/tests/browser/source-control/git-generation.html?commit");
  const draft = page.getByRole("textbox", { name: "Commit message" });
  const group = page.getByRole("group", { name: "Commit message" });
  const generate = group.getByRole("button", { name: "Generate commit message" });
  const arrow = group.getByRole("button", { name: "Model and settings" });
  const panel = page.getByRole("dialog", { name: "Model and settings" });
  await expect(generate).toBeVisible();
  await expect(arrow.locator("svg")).toHaveCount(1);
  const wandBounds = await generate.boundingBox();
  const arrowBounds = await arrow.boundingBox();
  expect(Math.abs(wandBounds!.x + wandBounds!.width - arrowBounds!.x)).toBeLessThan(2);
  await arrow.click();
  await expect(panel).toBeVisible();
  const settings = panel.locator("[data-model-settings]");
  const accountMenu = panel.locator("[data-model-account-menu]");
  await expect(settings.getByRole("switch", { name: "Fast" })).toBeVisible();
  await accountMenu.click();
  await panel.getByRole("radio", { name: /Work/ }).click();
  await expect(accountMenu).toContainText("Work");
  const savedChoice = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("bycoda.gitCommitGeneration.v1:/fixture") ?? "null"),
    );
  await expect.poll(savedChoice).toMatchObject({ providerAccountId: "work" });
  await panel.getByRole("option", { name: /^Claude Opus 5\.5\b/ }).click();
  await expect(panel.getByRole("tab", { name: /^Agents/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Provider settings" })).toHaveCount(0);
  await expect(settings.getByText(/Auto.compact|Context window|Advisor|Subagents/i)).toHaveCount(0);
  await settings.getByRole("radio", { name: "High", exact: true }).click();
  await settings.getByRole("switch", { name: "Fast" }).click();
  await expect(draft).toHaveValue("Keep this commit draft");
  const evidence = "temp/verification/git-commit-controls";
  mkdirSync(evidence, { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 780 });
      await expect(settings.getByRole("switch", { name: "Fast" })).toBeInViewport();
      await page.screenshot({
        path: `${evidence}/model-account-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  }
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(arrow).toBeFocused();
  await expect.poll(savedChoice).toMatchObject({
    harness: "claude",
    providerAccountId: "work",
    model: "claude:opus-5-5",
    modelSettings: { effort: "high", fast: "true" },
  });
  await generate.click();
  await expect(draft).toHaveValue("Fixture commit message");
  await page.reload();
  await arrow.click();
  await expect(accountMenu).toContainText("Work");
  await panel.getByRole("button", { name: "Automatic", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bycoda.gitCommitGeneration.v1:/fixture")))
    .toBeNull();
});

test("Git generation exposes advisor controls in a narrow panel and keeps the draft", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
  await page.setViewportSize({ width: 300, height: 780 });
  await page.goto("/tests/browser/source-control/git-generation.html");
  await expect(page.getByText("Main model", { exact: true })).toHaveCount(0);
  // Advisor and subagent settings live in the one model panel (no separate Extras entry).
  const modelButton = page.getByRole("button", { name: /Claude Haiku 4.5/ });
  const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
  const setting = (name: string) =>
    panel
      .locator("[data-model-settings]")
      .locator(`[role="radiogroup"][aria-label="${name}"], [role="group"][aria-label="${name}"]`);
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
    };
  };
  await modelButton.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-model-panel");
  // Advisor offers Add while empty and an edit control once a model is picked.
  const advisorGroup = panel
    .locator("[data-model-settings]")
    .getByRole("group", { name: "Advisor", exact: true });
  const advisorField = advisorGroup.getByRole("button");
  // Advisor and Subagents open a picker in the settings column; options are named by model
  // alone because the provider heading carries the "Claude Code · " prefix.
  const delegate = async (name: "Advisor" | "Subagents", option: RegExp) => {
    if (!(await panel.isVisible())) await modelButton.click();
    const agents = panel.getByRole("tab", { name: /^Agents/ });
    if ((await agents.count()) > 0 && (await agents.getAttribute("aria-selected")) !== "true")
      await agents.click();
    const picker = panel.locator("[data-model-setting-picker]");
    if (name === "Advisor") await advisorField.click();
    else {
      // Automatic delegates model selection; Custom opens the manual list picker.
      const custom = setting(name).getByRole("radio", { name: "Custom", exact: true });
      await custom.click();
    }
    await expect(picker).toBeVisible();
    const choice = picker.getByRole("option", { name: option });
    await choice.click();
    if (name === "Subagents") {
      await expect(choice).toHaveAttribute("aria-selected", "true");
      await picker.getByRole("button", { name: "Apply", exact: true }).click();
    }
    await expect(picker).toHaveCount(0);
  };
  await delegate("Advisor", /^Claude Opus 5\.5\b/);
  await expect(advisorGroup).toContainText("Claude Opus 5.5");
  await expect(panel.locator("[data-model-settings]")).toHaveCSS("color-scheme", "dark");
  // Subagent rows name Claude models without the provider prefix their icon already shows.
  await delegate("Subagents", /^Haiku 4\.5\b/);
  await expect.poll(saved).toEqual({
    model: "claude:haiku-4.5",
    advisor: "claude:opus-5-5",
    subagents: ["claude:haiku-4.5"],
  });
  await expect(page.getByRole("textbox", { name: "Commit message" })).toHaveValue(
    "Keep this commit draft",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The subagent mode is the panel's segmented control; the model policy follows from it per turn.
  const policy = panel.locator("[data-model-settings]").getByRole("radiogroup", {
    name: "Subagents",
  });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await policy.getByRole("radio", { name: "Off", exact: true }).click();
    await policy.getByRole("radio", { name: "Automatic", exact: true }).click();
    // Measure the settled plate, not an intermediate shared-layout animation frame.
    await expect
      .poll(() =>
        policy.evaluate((root) => {
          const selected = root.querySelector<HTMLElement>('[aria-checked="true"]')!;
          const button = selected.getBoundingClientRect();
          const plate = selected.querySelector('[aria-hidden="true"]')!.getBoundingClientRect();
          return Math.max(
            Math.abs(button.x - plate.x),
            Math.abs(button.y - plate.y),
            Math.abs(button.width - plate.width),
            Math.abs(button.height - plate.height),
          );
        }),
      )
      .toBeLessThan(1);
    const geometry = await policy.evaluate((root) => {
      const bounds = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const track = root.firstElementChild as HTMLElement;
      return {
        root: bounds(root),
        track: {
          ...bounds(track),
          clientWidth: track.clientWidth,
          scrollWidth: track.scrollWidth,
          scrollLeft: track.scrollLeft,
        },
        options: Array.from(root.querySelectorAll<HTMLElement>('[role="radio"]')).map((button) => {
          const label = button.querySelector<HTMLElement>("span:not([aria-hidden])")!;
          return {
            name: button.getAttribute("aria-label"),
            selected: button.getAttribute("aria-checked"),
            button: bounds(button),
            label: {
              ...bounds(label),
              clientWidth: label.clientWidth,
              scrollWidth: label.scrollWidth,
            },
          };
        }),
      };
    });
    await testInfo.attach(`policy-geometry-${reducedMotion}`, {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath(`git-generation-policy-${reducedMotion}.png`),
    });
  }
  await page.screenshot({
    path: testInfo.outputPath("git-generation-narrow.png"),
  });
  // Put the saved Haiku pick back after the mode toggles above.
  await delegate("Subagents", /^Haiku 4\.5\b/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: testInfo.outputPath("git-generation-main-and-extras.png"),
  });
  await page.reload();
  // The saved choice survives a reload.
  await expect.poll(saved).toEqual({
    model: "claude:haiku-4.5",
    advisor: "claude:opus-5-5",
    subagents: ["claude:haiku-4.5"],
  });
});

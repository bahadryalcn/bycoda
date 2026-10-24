import { expect, test } from "@playwright/test";

test("keyboard button hints stay visible without stealing focus while tabbing", async ({
  page,
}) => {
  await page.goto("/tests/browser/arc-controls.html");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("theme-light", theme === "light"),
        theme,
      );
      for (const name of ["Button API filters", "Native keyboard hint"]) {
        const button = page.getByRole("button", { name, exact: true });
        await button.focus();
        // A key establishes keyboard focus even after pointer-oriented earlier scenarios.
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        const hint = page.getByRole("tooltip");
        await expect(hint).toBeVisible();
        await expect(hint).toContainText(name);
        if (name === "Native keyboard hint") await expect(hint).toContainText("Ctrl+Shift+K");
        await expect(button).toBeFocused();
        const bounds = (await hint.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
        await expect(hint).toHaveCount(0);
        await expect(button).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(button).not.toBeFocused();
      }
    }
  }
});

test("AI question choices stay readable and support native selection", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "AI question fixture" });
  const radios = region.getByRole("radio");
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const light of [false, true]) {
        await page.evaluate(
          (enabled) => document.documentElement.classList.toggle("theme-light", enabled),
          light,
        );
        await expect(radios).toHaveCount(4);
        expect(await region.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        if (width === 768 && reducedMotion === "reduce") {
          await region.screenshot({
            path: testInfo.outputPath(light ? "question-light.png" : "question-dark.png"),
          });
        }
        const copy = await radios.first().evaluate((el) => {
          const label = el.closest("label")!.querySelector("strong")!;
          const style = getComputedStyle(label);
          return { size: parseFloat(style.fontSize), color: style.color, width: label.clientWidth };
        });
        expect(copy.size).toBeGreaterThanOrEqual(13);
        expect(copy.width).toBeGreaterThan(100);
        await radios.first().locator("..").click();
        await expect(radios.first()).toBeChecked();
        await radios.first().focus();
        await page.keyboard.press("ArrowDown");
        await expect(radios.nth(1)).toBeChecked();
        await expect(radios.nth(1)).toBeFocused();
        await expect(region.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
      }
    }
  }
  await radios.last().locator("..").click();
  await expect(region.getByRole("textbox", { name: "Type your answer" })).toBeFocused();
  await expect(region.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await region.getByRole("textbox").fill("Yalnızca animasyon duruyor");
  await expect(region.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
});

test("password reveal stays inside the input independently of its label and helper text", async ({
  page,
}) => {
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared field families", exact: true });
  const input = region.getByLabel("Fixture credential", { exact: true });
  const reveal = region.getByRole("button", { name: "Show fixture credential", exact: true });
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const light of [false, true]) {
        await page.evaluate(
          (enabled) => document.documentElement.classList.toggle("theme-light", enabled),
          light,
        );
        await input.scrollIntoViewIfNeeded();
        const field = (await input.boundingBox())!;
        const action = (await reveal.boundingBox())!;
        expect(action.x).toBeGreaterThan(field.x);
        expect(action.x + action.width).toBeLessThan(field.x + field.width);
        expect(action.y).toBeGreaterThanOrEqual(field.y);
        expect(action.y + action.height).toBeLessThanOrEqual(field.y + field.height);
        expect(Math.abs(action.y + action.height / 2 - field.y - field.height / 2)).toBeLessThan(1);
        const reserved = await input.evaluate((element) =>
          parseFloat(getComputedStyle(element).paddingInlineEnd),
        );
        expect(reserved).toBeGreaterThan(action.width);
        expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
    }
  }
  await input.focus();
  await page.keyboard.press("Tab");
  await expect(reveal).toBeFocused();
  await page.keyboard.press("Space");
  await expect(input).toHaveAttribute("type", "text");
  await expect(input).toBeFocused();
  await expect(region.getByLabel("Saved fixture fields")).toHaveText("");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toBeFocused();
});

test("field families preserve native editing, radio keys, secret reveal and action menu focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared field families", exact: true });
  const number = region.getByLabel("Fixture limit", { exact: true });
  await number.fill("");
  await region.getByRole("button", { name: "Save fixture fields", exact: true }).click();
  await expect(number).toBeFocused();
  await expect(region.getByLabel("Saved fixture fields")).toHaveText("");
  await number.fill("12");
  const secret = region.getByLabel("Fixture credential", { exact: true });
  await secret.focus();
  await secret.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 5));
  await region.getByRole("button", { name: "Show fixture credential", exact: true }).click();
  await expect(secret).toHaveAttribute("type", "text");
  await expect(secret).toBeFocused();
  expect(
    await secret.evaluate((element: HTMLInputElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([2, 5]);
  await region.getByRole("button", { name: "Hide fixture credential", exact: true }).click();
  await expect(secret).toHaveAttribute("type", "password");
  await region.getByRole("radio", { name: "Review first", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(region.getByRole("radio", { name: "Manual approval", exact: true })).toBeChecked();
  await expect(
    region.getByRole("radio", { name: "Unavailable approval", exact: true }),
  ).toBeDisabled();
  await region.getByRole("button", { name: "Save fixture fields", exact: true }).click();
  await expect(region.getByLabel("Saved fixture fields")).toHaveText(
    "12/fixture-only-value/manual",
  );
  await region.getByRole("button", { name: "Reset fixture fields", exact: true }).click();
  await expect(number).toHaveValue("10");
  await expect(region.getByRole("radio", { name: "Review first", exact: true })).toBeChecked();
  const trigger = region.getByRole("button", { name: "Open fixture actions", exact: true });
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Copy fixture", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Retry fixture", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(region.getByLabel("Picked fixture action")).toHaveText("retry");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("shared editing remains reachable at browser zoom 125 150 and 200 percent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared field families", exact: true });
  for (const light of [true, false]) {
    for (const zoom of [1.25, 1.5, 2]) {
      await page.evaluate(
        ({ light, zoom }) => {
          document.documentElement.classList.toggle("theme-light", light);
          document.documentElement.style.zoom = String(zoom);
        },
        { light, zoom },
      );
      const number = region.getByLabel("Fixture limit", { exact: true });
      await number.fill("12");
      await region.getByRole("button", { name: "Save fixture fields", exact: true }).click();
      await expect(region.getByLabel("Saved fixture fields")).toContainText("12/");
      expect(await region.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const secret = region.getByLabel("Fixture credential", { exact: true });
      await secret.focus();
      await page.keyboard.press("Tab");
      const reveal = region.getByRole("button", { name: "Show fixture credential", exact: true });
      await expect(reveal).toBeFocused();
      await page.keyboard.press("Space");
      await expect(secret).toHaveAttribute("type", "text");
      await expect(secret).toBeFocused();
      await region.getByRole("button", { name: "Hide fixture credential", exact: true }).click();
    }
  }
});

test("shared feedback preserves semantic states, recovery and narrow theme layouts", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared feedback", exact: true });
  await region.getByRole("button", { name: "Toggle feedback failure", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("Operation failed");
  await expect(region.getByRole("alert")).toContainText("Retry the operation");
  await region.getByRole("button", { name: "Retry fixture request", exact: true }).click();
  await expect(region.getByLabel("Feedback retry count")).toHaveText("1");
  await expect(
    region.getByRole("progressbar", { name: "Quota limit used", exact: true }),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(
    region.getByRole("progressbar", { name: "Quota limit used", exact: true }),
  ).toHaveAttribute("data-tone", "danger");
  await expect(
    region.getByRole("progressbar", { name: "Waiting for fixture", exact: true }),
  ).not.toHaveAttribute("aria-valuenow");
  await expect(
    region.getByRole("status", { name: "Loading fixture records", exact: true }),
  ).toBeVisible();
  await region.getByRole("button", { name: "Complete fixture loading", exact: true }).click();
  await expect(
    region.getByRole("status", { name: "Loading fixture records", exact: true }),
  ).toHaveCount(0);
  await region.getByRole("button", { name: "Retry loaded fixture", exact: true }).click();
  await expect(region.getByLabel("Feedback retry count")).toHaveText("2");
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        (enabled) => document.documentElement.classList.toggle("theme-light", enabled),
        light,
      );
      for (const tone of ["neutral", "info", "success", "warning", "danger"]) {
        const badge = region.getByTestId(`feedback-${tone}`);
        await expect(badge).toBeVisible();
        expect(
          await badge.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth;
          }),
        ).toBe(true);
      }
      expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
  }
  await region.screenshot({ path: "temp/verification/2026-10-16-ui-system/W2-feedback-light.png" });
});

test("searchable native forms preserve required focus, FormData, defaults, reset and refs", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Native searchable forms", exact: true });
  const project = region.getByRole("button", { name: "Search form projects", exact: true });
  const controlled = region.getByRole("button", {
    name: "Search controlled form projects",
    exact: true,
  });
  const submit = region.getByRole("button", { name: "Submit selection form", exact: true });
  await submit.click();
  await expect(project).toBeFocused();
  await expect(region.getByLabel("Submitted selection form")).toHaveText("");
  await project.press("Enter");
  const search = page.getByRole("combobox", { name: "Search options…", exact: true });
  await search.fill("Project 24");
  await expect(page.getByRole("option", { name: /Project 24 with/ })).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(region.locator('select[name="project"]')).toHaveValue("project-24");
  await expect(region.getByLabel("Native selection changes")).toHaveText("1");
  await submit.click();
  await expect(controlled).toBeFocused();
  await controlled.press("Enter");
  await search.fill("Project 23");
  await page.getByRole("option", { name: /Project 23 with/ }).click();
  await submit.click();
  await expect(region.getByLabel("Submitted selection form")).toHaveText("project-24/project-23");
  await region.getByRole("button", { name: "Set native selection error", exact: true }).click();
  await submit.click();
  await expect(project).toBeFocused();
  await region.getByRole("button", { name: "Clear native selection error", exact: true }).click();
  await region.getByRole("button", { name: "Reset selection form", exact: true }).click();
  await expect(region.locator('select[name="project"]')).toHaveValue("");
  await expect(region.locator('select[name="controlled"]')).toHaveValue("");
  await expect(project).toContainText("Choose project");
  await region.getByRole("button", { name: "Focus native selection ref", exact: true }).click();
  await expect(project).toBeFocused();
  await region.locator('label[for="native-project"]').click();
  await expect(project).toBeFocused();
});

test("expanding actions wait for pointer intent and keep the revealed target stable", async ({
  page,
}) => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/arc-controls.html");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        width === 390,
      );
      const group = page.getByRole("toolbar", { name: "Sample note actions" });
      const copy = group.getByRole("button", { name: "Copy sample", exact: true });
      const add = group.getByRole("button", { name: "Add sample", exact: true });
      await add.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await expect(copy).toHaveAttribute("data-expanded", "true");
      const box = (await add.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await expect(copy).toHaveAttribute("data-expanded", "true");
      await expect(add).toHaveAttribute("data-expanded", "true");
      // Wait through the width animation without moving the pointer.
      await page.waitForTimeout(400);
      await expect(add).toHaveAttribute("data-expanded", "true");
      await page.mouse.move(0, 0);
      await expect(add).toHaveAttribute("data-expanded", "true");
      await expect(copy).toHaveAttribute("data-expanded", "true");
      await copy.focus();
      await page.keyboard.press("ArrowRight");
      await expect(add).toBeFocused();
      await expect(add).toHaveAttribute("data-expanded", "true");
      await page.keyboard.press("ArrowLeft");
      await expect(copy).toBeFocused();
      await expect(copy).toHaveAttribute("data-expanded", "true");
    }
  }
});

test("expanding actions preserve keyboard access and wait for the real async outcome", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Async action group", exact: true });
  const copy = region.getByRole("button", { name: "Copy sample", exact: true });
  await copy.focus();
  await page.keyboard.press("ArrowRight");
  await expect(region.getByRole("button", { name: "Add sample", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(copy).toHaveAttribute("aria-busy", "true");
  await copy.dispatchEvent("click");
  await region.getByRole("button", { name: "Add sample", exact: true }).dispatchEvent("click");
  await expect(region.getByLabel("Action invocations")).toHaveText("1");
  const announcement = region
    .getByRole("toolbar", { name: "Sample note actions", exact: true })
    .getByRole("status");
  await expect(announcement).not.toHaveText("Copied");
  await region.getByRole("button", { name: "Complete group operation", exact: true }).click();
  await expect(announcement).toHaveText("Copied");
});

test("navigation search keeps ranked results, IME guards and deferred reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("Saturation");
  await expect(page.getByRole("option").first()).toContainText("Saturation");
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.getByLabel("Revealed setting")).toHaveText("");
  await expect(search).toBeVisible();
  await search.press("Enter");
  await expect(page.getByLabel("Revealed setting")).toHaveText("appearance:saturation");
  const trigger = page.getByRole("button", { name: "Search settings", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await search.fill("no such setting qwertyz");
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^No matching settings$/ }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(trigger).toBeFocused();
});

test("metadata selection retains unavailable values and skips disabled operations", async ({
  page,
}) => {
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Metadata selection", exact: true });
  await expect(region.getByLabel("Selected metadata values")).toHaveText("missing");
  await region.getByRole("button", { name: /^Metadata selection:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Metadata selection options", exact: true });
  await expect(dialog.getByText("Permission required")).toBeVisible();
  const locked = dialog.getByRole("option", { name: /Locked/ });
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  await locked.dispatchEvent("click");
  await expect(region.getByLabel("Selected metadata values")).toHaveText("missing");
  await dialog.getByRole("option", { name: /Ready/ }).click();
  await expect(region.getByLabel("Selected metadata values")).toHaveText("missing,ready");
  await dialog.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(region.getByLabel("Selected metadata values")).toHaveText("");
  await page.keyboard.press("Escape");
  await expect(region.getByRole("button", { name: /^Metadata selection:/ })).toBeFocused();
});

test("shared density changes geometry while preserving native membership and keyboard choices", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const specimen = page.getByRole("region", { name: "Control preview", exact: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        light,
      );
      for (const density of ["compact", "comfortable", "touch"]) {
        await page.evaluate((density) => {
          document.documentElement.dataset.controlDensity = density;
        }, density);
        const button = specimen.getByRole("button", { name: "primary / neutral", exact: true });
        const minimum = density === "touch" ? 44 : density === "comfortable" ? 32 : 28;
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(minimum);
        if (density === "touch") {
          const search = page.getByRole("textbox", { name: "Inline search", exact: true });
          await search.fill("density query");
          const clear = search.locator("..").getByRole("button");
          expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await clear.click();
          await expect(search).toHaveValue("");
          await expect(search).toBeFocused();
          const checkbox = specimen.locator("input[type=checkbox]");
          expect((await checkbox.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await checkbox.uncheck();
          await expect(checkbox).not.toBeChecked();
          await checkbox.check();
          await expect(checkbox).toBeChecked();
          const radio = specimen.getByRole("radiogroup", { name: "Layout", exact: true });
          const choice = radio.getByRole("radio").first();
          expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await choice.focus();
          await choice.press("ArrowRight");
          await expect(radio.getByRole("radio").last()).toHaveAttribute("aria-checked", "true");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  }
});

test("shared controls retain contrast at custom tint bounds", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const specimen = page.getByRole("region", { name: "Control preview", exact: true });
  const failures = await specimen.evaluate((region) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const c = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((part) => {
        const v = part / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    };
    const failures: {
      light: boolean;
      hue: number;
      saturation: number;
      brightness: number;
      control: string;
      ratio: number;
    }[] = [];
    for (const light of [false, true]) {
      document.documentElement.classList.toggle("theme-light", light);
      for (const hue of [0, 60, 120, 180, 240, 300])
        for (const saturation of [0, 100])
          for (const brightness of [0, 30]) {
            const root = document.documentElement;
            root.style.setProperty("--theme-hue", String(hue));
            root.style.setProperty("--theme-saturation", `${saturation}%`);
            root.style.setProperty("--theme-dark-lightness", `${brightness}%`);
            for (const button of region.querySelectorAll('[data-button-variant="primary"]')) {
              const style = getComputedStyle(button);
              const fg = luminance(style.color);
              const probe = document.createElement("span");
              button.append(probe);
              for (const state of ["solid", "solid-hover", "solid-pressed"]) {
                probe.style.backgroundColor = `var(--button-${state})`;
                const bg = luminance(getComputedStyle(probe).backgroundColor);
                const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
                if (ratio < 4.5)
                  failures.push({
                    light,
                    hue,
                    saturation,
                    brightness,
                    control: `${button.textContent} / ${state}`,
                    ratio,
                  });
              }
              probe.remove();
            }
          }
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test("shared tone specimen preserves contrast, independent info and narrow layouts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const specimen = page.getByRole("region", { name: "Control preview", exact: true });
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await page.getByRole("button", { name: "Reset accent", exact: true }).click();
      const info = specimen.getByRole("button", { name: "primary / info", exact: true });
      const neutral = specimen.getByRole("button", { name: "primary / neutral", exact: true });
      const infoFill = await info.evaluate((node) => getComputedStyle(node).backgroundColor);
      const neutralFill = await neutral.evaluate((node) => getComputedStyle(node).backgroundColor);
      for (const custom of [false, true]) {
        if (custom)
          await page.getByRole("button", { name: "Saturated accent", exact: true }).click();
        await expect(info).toHaveCSS("background-color", infoFill);
        await expect(neutral).toHaveCSS("background-color", neutralFill);
        for (const tone of ["neutral", "accent", "info", "success", "warning", "danger"]) {
          const button = specimen.getByRole("button", { name: `primary / ${tone}`, exact: true });
          for (const interaction of ["rest", "hover", "pressed"]) {
            if (interaction !== "rest") await button.hover();
            if (interaction === "pressed") await page.mouse.down();
            const ratio = await button.evaluate((node) => {
              const style = getComputedStyle(node);
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const context = canvas.getContext("2d", { willReadFrequently: true })!;
              const luminance = (color: string) => {
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                const channels = [...context.getImageData(0, 0, 1, 1).data]
                  .slice(0, 3)
                  .map((part) => {
                    const value = part / 255;
                    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                  });
                return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
              };
              const foreground = luminance(style.color);
              const background = luminance(style.backgroundColor);
              return (
                (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05)
              );
            });
            expect(
              ratio,
              `${width}px ${light ? "light" : "dark"} ${custom ? "custom" : "default"} ${tone}`,
            ).toBeGreaterThanOrEqual(4.5);
            if (interaction === "pressed") await page.mouse.up();
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      if (width === 390 || width === 1440) {
        await specimen.screenshot({
          path: `temp/verification/2026-10-16-ui-system/tones-${width}-${light ? "light" : "dark"}.png`,
        });
      }
    }
  }
});

test("search focus has one owner across shared fields and host tool overrides", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Search clear controls" });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      for (const name of ["Inline search", "Standalone search", "Fixture log search"]) {
        const field = region.getByLabel(name, { exact: true });
        const owner = name === "Standalone search" ? field : field.locator("..");
        const before = await owner.boundingBox();
        await field.click();
        for (const keyboard of [false, true]) {
          if (keyboard) {
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
          }
          await expect(field).toBeFocused();
          await expect(owner).toHaveCSS("outline-style", "solid");
          await expect(owner).toHaveCSS("outline-width", "1px");
          await expect(owner).toHaveCSS("outline-offset", "-1px");
          await expect(owner).toHaveCSS("box-shadow", "none");
          expect(
            await owner.evaluate((node) => {
              const css = getComputedStyle(node);
              return css.outlineColor === css.color;
            }),
          ).toBe(false);
          if (name !== "Standalone search") await expect(field).toHaveCSS("outline-style", "none");
        }
        const after = await owner.boundingBox();
        expect(after!.width).toBe(before!.width);
        expect(after!.height).toBe(before!.height);
        await field.fill("focus check");
        const clear = owner
          .locator("..")
          .getByRole("button", { name: "Clear search", exact: true });
        // The group owns its clear button; standalone places it beside the input.
        const button =
          name === "Standalone search"
            ? clear
            : owner.getByRole("button", { name: "Clear search", exact: true });
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        await expect(button).toHaveCSS("outline-style", "solid");
        await page.keyboard.press("Enter");
        await expect(field).toHaveValue("");
        await expect(field).toBeFocused();
      }
      const combo = region.getByRole("combobox", { name: "Focus combobox", exact: true });
      await combo.click();
      await expect(combo).toHaveCSS("outline-style", "none");
      await expect(combo.locator("..")).toHaveCSS("outline-width", "1px");
      await expect(combo.locator("..")).toHaveCSS("outline-offset", "-1px");
      await combo.fill("First");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(combo).toHaveValue("First");
      await combo.locator("..").getByRole("button", { name: "Clear selection" }).click();
      await expect(combo).toHaveValue("");
      await page.keyboard.press("Escape");
    }
  }
  await page.getByRole("button", { name: "Search choice: First", exact: true }).click();
  const menuSearch = page
    .getByRole("dialog", { name: "Search choice options", exact: true })
    .getByRole("combobox");
  await expect(menuSearch).toBeFocused();
  await expect(menuSearch).toHaveCSS("outline-style", "none");
});

test("text fields keep focus on one border with pointer and keyboard", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Field focus", exact: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      for (const name of [
        "Focus input",
        "Invalid focus input",
        "Commit message",
        "Invalid focus textarea",
      ]) {
        const field = region.getByRole("textbox", { name, exact: true });
        const before = await field.boundingBox();
        await field.click();
        await expect(field).toBeFocused();
        for (const keyboard of [false, true]) {
          if (keyboard) {
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
            await expect(field).toBeFocused();
          }
          // Reduced-motion transitions still finish on a subsequent browser frame.
          await expect
            .poll(() =>
              field.evaluate((node) => {
                const css = getComputedStyle(node);
                return css.outlineColor === css.borderTopColor;
              }),
            )
            .toBe(true);
          const style = await field.evaluate((node) => {
            const css = getComputedStyle(node);
            return {
              outline: css.outlineStyle,
              width: css.outlineWidth,
              offset: css.outlineOffset,
              color: css.outlineColor,
              border: css.borderTopColor,
              shadow: css.boxShadow,
            };
          });
          expect(style).toEqual({
            outline: "solid",
            width: "1px",
            offset: "-1px",
            color: style.border,
            border: style.border,
            shadow: "none",
          });
          if (!name.startsWith("Invalid")) {
            expect(style.color).not.toBe(
              await field.evaluate((node) => getComputedStyle(node).color),
            );
          }
        }
        const after = await field.boundingBox();
        expect(after!.width).toBe(before!.width);
        expect(after!.height).toBe(before!.height);
      }
      await expect(region.getByLabel("Disabled focus textarea", { exact: true })).toBeDisabled();
      const button = region.getByRole("button", { name: "After focus fields" });
      await button.focus();
      await expect(button).toHaveCSS("outline-offset", "2px");
      await region.getByLabel("Commit message", { exact: true }).click();
      await region.screenshot({
        path: `temp/verification/2026-10-15-field-focus/${width}-${light ? "light" : "dark"}.png`,
      });
    }
  }
});

test("shared button API preserves geometry, popup anchors, direct rows and busy keyboard guards", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared button API" });
  await region.scrollIntoViewIfNeeded();
  const icon = region.getByRole("button", { name: "Button API filters", exact: true });
  await icon.focus();
  expect(await icon.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
  for (const [label, size] of [
    ["Button API filters", 28],
    ["Medium button", 36],
    ["Large button", 40],
  ] as const) {
    const rect = await region.getByRole("button", { name: label, exact: true }).boundingBox();
    expect(rect!.width).toBe(size);
    expect(rect!.height).toBe(size);
  }
  const before = await icon.boundingBox();
  await icon.hover();
  await page.mouse.down();
  const pressed = await icon.boundingBox();
  expect(pressed!.width).toBe(before!.width);
  expect(pressed!.height).toBe(before!.height);
  await page.mouse.up();
  await expect(icon).toHaveAttribute("aria-pressed", "true");
  await expect(region.getByLabel("Button popup result")).toHaveText("Opened");
  expect(
    await region.locator("[data-direct-row]").evaluate((node) => node.parentElement!.tagName),
  ).toBe("BUTTON");
  const tab = region.getByRole("tab", { name: "Selected tab", exact: true });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).not.toHaveAttribute("aria-pressed", /.+/);
  await region.getByRole("button", { name: "Toggle pending", exact: true }).click();
  for (const name of ["Saving action", "Saving native action", "Unavailable action"]) {
    const button = region.getByRole("button", { name, exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(button).toBeFocused();
  }
  await expect(region.getByLabel("Button action count")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("shared button variants fit both themes and narrow panels with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        light,
      );
      const region = page.getByRole("region", { name: "Shared button API" });
      await region.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(region.getByRole("button", { name: "primary", exact: true })).toBeVisible();
      const tab = region.getByRole("tab", { name: "Selected tab", exact: true });
      expect(await tab.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
      await page.screenshot({
        path: `temp/verification/2026-10-14-button-api/${width}-${light ? "light" : "dark"}.png`,
      });
    }
  }
});

test("search clearing fits compact and wide layouts, both themes and keyboard use", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const region = page.getByRole("region", { name: "Search clear controls" });
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("light", value),
        light,
      );
      for (const name of ["Inline search", "Standalone search", "Fixture log search"]) {
        const input = region.getByLabel(name, { exact: true });
        await expect(region.getByRole("button", { name: "Clear search", exact: true })).toHaveCount(
          0,
        );
        await input.fill("a long search query that still leaves room for the clear icon");
        const clear = region.getByRole("button", { name: "Clear search", exact: true });
        await expect(clear).toBeVisible();
        const fieldBox = await input.boundingBox();
        const buttonBox = await clear.boundingBox();
        expect(buttonBox!.width).toBe(24);
        expect(buttonBox!.height).toBe(24);
        expect(buttonBox!.y).toBeGreaterThanOrEqual(fieldBox!.y - 4);
        expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(
          fieldBox!.y + fieldBox!.height + 4,
        );
        expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(width);
        await clear.click();
        await expect(input).toHaveValue("");
        await expect(input).toBeFocused();
        await expect(clear).toHaveCount(0);
        await input.fill("keyboard");
        await page.keyboard.press("Tab");
        await expect(clear).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(input).toHaveValue("");
        await expect(input).toBeFocused();
      }
    }
  }
  expect(errors).toEqual([]);
});

test("clearing a select search keeps the menu open and restores its options", async ({ page }) => {
  await page.goto("/tests/browser/arc-controls.html");
  await page.getByRole("button", { name: "Search choice: First", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search choice options", exact: true });
  const input = dialog.getByRole("combobox");
  await input.fill("First");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(input).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
});

test("additional Arc controls preserve data, keyboard actions and inline recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const additions = page.getByRole("region", { name: "Additional Arc controls" });
  await additions.getByRole("searchbox", { name: "Search JSON" }).fill("59");
  await expect(additions.getByRole("treeitem").filter({ hasText: /59/ }).first()).toBeVisible();
  const table = additions.getByRole("table", { name: "Project usage" });
  await table.getByRole("button", { name: "Sort by Cost", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Beta");
  await table.getByRole("button", { name: "Sort by Cost", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Alpha");
  const title = additions.getByRole("button", { name: /^Note title:/ });
  await title.click();
  await additions.getByRole("textbox", { name: "Note title", exact: true }).fill("Renamed note");
  await page.keyboard.press("Enter");
  await expect(title).toContainText("Renamed note");
  await additions.getByLabel("Reject next rename").check();
  await title.click();
  await additions.getByRole("textbox", { name: "Note title", exact: true }).fill("Rejected name");
  await page.keyboard.press("Enter");
  await expect(title).toContainText("Renamed note");
  await expect(additions.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  const recorder = additions.getByRole("button", { name: "Change fixture shortcut", exact: true });
  await recorder.click();
  await page.keyboard.press("Control+Shift+J");
  await expect(recorder).toContainText("J");
  await recorder.click();
  await page.keyboard.press("Escape");
  await expect(recorder).toContainText("J");
  await additions.getByRole("button", { name: "Reset fixture shortcut", exact: true }).click();
  await expect(recorder).toContainText("Ctrl+K");
  expect(errors).toEqual([]);
});

test("date ranges and destructive confirmation apply only after confirmation", async ({ page }) => {
  await page.goto("/tests/browser/arc-controls.html");
  const additions = page.getByRole("region", { name: "Additional Arc controls" });
  const date = additions.getByRole("button", { name: /^Date range:/ });
  await date.click();
  await expect(page.getByRole("dialog", { name: "Date range", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(date).toBeFocused();
  await expect(additions.getByLabel("Applied range")).toHaveText("No range");
  await date.click();
  const dialog = page.getByRole("dialog", { name: "Date range", exact: true });
  await dialog.getByRole("button", { name: "Last 7 days", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(additions.getByLabel("Applied range")).not.toHaveText("No range");
  await additions.getByRole("button", { name: "Delete fixture note", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(additions.getByLabel("Deletion result")).toHaveText("Retained");
  await additions.getByRole("button", { name: "Delete fixture note", exact: true }).click();
  await page.waitForTimeout(300);
  await additions.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(additions.getByLabel("Deletion result")).toHaveText("Deleted");
});

test("image comparison accepts a selected image and retains keyboard and dismissal behavior", async ({
  page,
}) => {
  await page.goto("/tests/browser/arc-controls.html");
  await page.getByRole("button", { name: "Open image comparison", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Image preview: Original fixture" });
  const close = dialog.getByRole("button", { name: "Close image preview", exact: true });
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.y).toBe(16);
  expect(closeBox.x + closeBox.width).toBe(page.viewportSize()!.width - 16);
  await dialog.getByLabel("Compare with image").setInputFiles({
    name: "after.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/><circle cx="400" cy="300" r="150" fill="gray"/></svg>',
    ),
  });
  const divider = dialog.getByRole("slider", { name: "Compare images", exact: true });
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "49");
  await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  expect(await divider.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(30);
  await dialog.getByRole("button", { name: "Stop comparison", exact: true }).click();
  await expect(divider).toHaveCount(0);
  await expect(dialog.getByRole("img", { name: "Original fixture" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Open image comparison", exact: true }).click();
  await close.focus();
  await close.press("Enter");
  await expect(dialog).toHaveCount(0);
});

test("additional surfaces fit narrow and wide windows in both themes and reduced motion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        ({ light }) => {
          document.documentElement.classList.toggle("theme-light", light);
          document.documentElement.style.setProperty(
            "--user-accent-color",
            light ? "#4965d0" : "#909090",
          );
        },
        { light },
      );
      await page.getByRole("region", { name: "Additional Arc controls" }).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const picker = page.getByRole("button", { name: /^Date range:/ });
      await picker.click();
      const panel = page.getByRole("dialog", { name: "Date range", exact: true });
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: `temp/verification/2026-10-13-arc-additions/${width}-${light ? "light" : "dark"}.png`,
      });
    }
  }
  expect(errors).toEqual([]);
});

test("additional controls localize their actions and accessibility labels", async ({ page }) => {
  await page.goto("/tests/browser/arc-controls.html");
  await page.getByRole("button", { name: "Türkçe controls", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "JSON'da ara", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Tarih aralığı:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Tarih aralığı", exact: true });
  await expect(dialog.getByRole("button", { name: "Son 7 gün", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Bu çeyrek", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeVisible();
});

test("preserves settings interaction, compact geometry and both themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const toggle = page.getByRole("switch", { name: "Enable sounds", exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const height = await toggle.evaluate((node) => node.getBoundingClientRect().height);
  expect(height).toBe(28);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(await toggle.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
  await expect(page.getByRole("switch", { name: "Unavailable setting" })).toBeDisabled();

  const slider = page.getByRole("slider", { name: "Opacity", exact: true });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "51");
  await expect(slider).toHaveAttribute("aria-valuetext", "51%");
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");

  const density = page.getByRole("radiogroup", { name: "Density", exact: true });
  const compact = density.getByRole("radio", { name: "Compact", exact: true });
  await compact.focus();
  await page.keyboard.press("ArrowRight");
  const comfortable = density.getByRole("radio", { name: "Comfortable", exact: true });
  await expect(comfortable).toBeFocused();
  await expect(comfortable).toHaveAttribute("aria-checked", "true");
  await page.getByRole("textbox", { name: "Filter notes", exact: true }).fill("launch");
  await expect(page.getByRole("textbox", { name: "Filter notes", exact: true })).toHaveValue(
    "launch",
  );

  const themed = page.getByRole("button", { name: "Light theme", exact: true });
  const darkBackground = await themed.evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/dark.png" });
  await themed.click();
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "Dark theme", exact: true })
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .not.toBe(darkBackground);
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/light.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(comfortable).toBeInViewport();
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/narrow.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(
    await toggle.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).getPropertyValue("--duration-fast")),
    ),
  ).toBe(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("selection, expanding details and history keep their interactions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const standard = page.getByRole("button", { name: /^Standard choice:/ });
  await standard.click();
  await page.getByRole("option", { name: "Second", exact: true }).click();
  await expect(standard).toContainText("Second");
  const search = page.getByRole("button", { name: /^Search choice:/ });
  await search.click();
  await page.getByRole("combobox", { name: "Search options…" }).fill("First");
  await page.getByRole("option", { name: "First", exact: true }).click();
  await expect(search).toContainText("First");
  const morph = page.getByRole("combobox", { name: "Property choice" });
  await morph.click();
  await expect(page.getByRole("option", { name: "Second", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Second", exact: true }).click();
  await expect(morph).toContainText("Second");
  await morph.click();
  await page.keyboard.press("Escape");
  await expect(morph).toHaveAttribute("aria-expanded", "false");
  await expect(morph).toBeFocused();
  const card = page.getByRole("button", { name: "Draft details" });
  await card.click();
  const draft = page.getByRole("textbox", { name: "Retained draft" });
  await draft.fill("Keep this draft");
  await page.keyboard.press("Escape");
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await expect(card).toBeFocused();
  await card.click();
  await expect(draft).toHaveValue("Keep this draft");
  await expect(page.getByRole("button", { name: "Open attempt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Completed attempt/ }).click();
  await expect(page.getByText("Review summary", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await morph.click();
  const option = page.getByRole("option", { name: "Second", exact: true });
  await expect(option).toBeVisible();
  await expect
    .poll(() =>
      option.evaluate((node) => {
        const shape = node.closest("[data-open]")?.querySelector('[role="listbox"]');
        return shape ? Number.parseFloat(getComputedStyle(shape.parentElement!).opacity) : 0;
      }),
    )
    .toBe(1);
  await expect
    .poll(() =>
      option.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const surface = node.closest("[data-open]")?.querySelector("[data-morph-surface]");
        const bounds = surface?.getBoundingClientRect();
        return (
          !!bounds && rect.bottom <= bounds.bottom + 1 && rect.left >= 0 && rect.right <= innerWidth
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/selection-narrow.png" });
  expect(errors).toEqual([]);
});

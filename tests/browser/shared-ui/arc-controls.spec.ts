import { expect, test, type Locator, type Page } from "@playwright/test";

test("textarea resize defaults preserve caller, autosize and fill ownership", async ({ page }) => {
  await page.goto("/tests/browser/shared-ui/arc-controls.html?view=coherence&data=textarea");
  const region = page.getByRole("region", { name: "Textarea resize fixture" });
  await expect(region.getByRole("textbox", { name: "Default resizing", exact: true })).toHaveCSS(
    "resize",
    "vertical",
  );
  for (const name of ["Explicitly disabled resizing", "Automatic height", "Fill panel"]) {
    const field = region.getByRole("textbox", { name, exact: true });
    await expect(field).toHaveCSS("resize", "none");
    await field.fill("Retained Turkish instructions İstanbul 🧪\n".repeat(12));
    await expect(field).toHaveValue("Retained Turkish instructions İstanbul 🧪\n".repeat(12));
  }
});

test("coherence effort keeps context and long content readable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.goto(
        `/tests/browser/shared-ui/arc-controls.html?view=coherence&data=worst&theme=${theme}`,
      );
      const region = page.getByRole("region", { name: "UI coherence fixture" });
      await expect(region.getByRole("radiogroup", { name: "Reasoning effort" })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-13-ui-coherence/shared-${process.env.UI_COHERENCE_BEFORE ? "before" : "after"}-${width}-${theme}.png`,
      });
      expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
  }
  const region = page.getByRole("region", { name: "UI coherence fixture" });
  await expect(region.getByText("Reasoning effort", { exact: true })).toBeVisible();
});

test("coherence stress data retains keyboard choices, disabled state and contrast", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(
      `/tests/browser/shared-ui/arc-controls.html?view=coherence&data=worst&dir=rtl&theme=${theme}`,
    );
    // Chromium CSS zoom emulates layout zoom. This does not prove native window scaling.
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    const region = page.getByRole("region", { name: "UI coherence fixture" });
    const effort = region.getByRole("radiogroup", { name: "Reasoning effort" });
    const high = effort.getByRole("radio", {
      name: "Yüksek düşünme seviyesi, ayrıntılı değerlendirme",
    });
    await high.focus();
    await expect(high).toBeFocused();
    await high.press("End");
    await expect(effort.getByRole("radio", { name: "Ultra", exact: true })).toBeChecked();
    await region.getByRole("button", { name: "Disable effort" }).click();
    await expect(high).toBeDisabled();
    await expect(effort.getByRole("radio", { name: "Ultra", exact: true })).toBeChecked();
    const geometry = await region.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        viewport: innerWidth,
        overflow: element.scrollWidth > element.clientWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.overflow).toBe(false);
    // Composite the actual foreground through transparent ancestors to measure rendered ink.
    const contrast = await region
      .getByText("Reasoning effort", { exact: true })
      .evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const rgb = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const pixel = context.getImageData(0, 0, 1, 1).data;
          return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
        };
        const composite = (top: number[], bottom: number[]) => {
          const alpha = top[3] ?? 1;
          return top
            .slice(0, 3)
            .map((channel, index) => channel * alpha + bottom[index] * (1 - alpha));
        };
        const ancestors: Element[] = [];
        for (let node: Element | null = element; node; node = node.parentElement)
          ancestors.unshift(node);
        let background = [255, 255, 255];
        for (const node of ancestors)
          background = composite(rgb(getComputedStyle(node).backgroundColor), background);
        const foreground = composite(rgb(getComputedStyle(element).color), background);
        const luminance = (channels: number[]) =>
          channels
            .map((channel) => {
              const value = channel / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
        return (values[1] + 0.05) / (values[0] + 0.05);
      });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `temp/verification/2026-11-13-ui-coherence/shared-after-800-${theme}-200-rtl.png`,
    });
    await page.evaluate(() => {
      document.body.style.zoom = "1";
    });
    for (const state of ["Empty", "One", "1,000", "Demo data"]) {
      await page.getByRole("radio", { name: state, exact: true }).click();
      const trigger = region.getByRole("button", { name: /^Account:/ });
      await trigger.click();
      if (state !== "Empty") {
        await expect(page.getByRole("option").first()).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await page.keyboard.press("Escape");
      }
    }
  }
});

test("keyboard button hints stay visible without stealing focus while tabbing", async ({
  page,
}) => {
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
        // The shortcut renders as key caps (Ctrl, Shift, K) with a spoken label on its group.
        if (name === "Native keyboard hint") {
          await expect(hint).toContainText(/Ctrl\s*Shift\s*K|⌃\s*⇧\s*K/);
          await expect(hint.getByRole("img")).toHaveAccessibleName(/Shift/);
        }
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
        await expect(region.getByRole("button", { name: /^Send answer$/ })).toBeEnabled();
      }
    }
  }
  await radios.last().locator("..").click();
  await expect(region.getByRole("textbox", { name: "Type your answer" })).toBeFocused();
  await expect(region.getByRole("button", { name: /^Send answer$/ })).toBeDisabled();
  await region.getByRole("textbox").fill("Yalnızca animasyon duruyor");
  await expect(region.getByRole("button", { name: /^Send answer$/ })).toBeEnabled();
});

test("password reveal stays inside the input independently of its label and helper text", async ({
  page,
}) => {
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared field families", exact: true });
  const input = region.getByLabel("Fixture credential", { exact: true });
  const reveal = region.getByRole("button", { name: "Show fixture credential", exact: true });
  const frame = input.locator("xpath=ancestor::*[@data-field-control][1]");
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
        // The field frame (FieldControl) owns the border; the reveal action is its own end
        // column, so it sits inside the frame without overlapping the editable text.
        const field = (await frame.boundingBox())!;
        const editor = (await input.boundingBox())!;
        const action = (await reveal.boundingBox())!;
        expect(action.x).toBeGreaterThan(field.x);
        expect(action.x + action.width).toBeLessThan(field.x + field.width);
        expect(action.y).toBeGreaterThanOrEqual(field.y);
        expect(action.y + action.height).toBeLessThanOrEqual(field.y + field.height);
        expect(Math.abs(action.y + action.height / 2 - field.y - field.height / 2)).toBeLessThan(1);
        expect(action.x).toBeGreaterThanOrEqual(editor.x + editor.width - 1);
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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

test("expanding actions wait for pointer intent and keep the revealed target stable", async ({
  page,
}) => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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

/** Normal fields focus through their neutral border, with no halo or inset outline. */
async function expectFieldFocus(owner: Locator, resting?: string) {
  await expect
    .poll(() =>
      owner.evaluate((node, before) => {
        const css = getComputedStyle(node);
        // Browsers serialize the zero-size shadow as either `none` or a color
        // followed by zero offsets, blur and spread. Both draw no halo.
        const lengths = css.boxShadow.match(/-?(?:\d*\.)?\d+px/g) ?? [];
        return {
          outline: css.outlineStyle,
          noHalo:
            css.boxShadow === "none" ||
            (lengths.length >= 3 && lengths.every((length) => Number.parseFloat(length) === 0)),
          border: before === undefined || css.borderTopColor !== before,
        };
      }, resting),
    )
    .toEqual({ outline: "none", noHalo: true, border: true });
}

test("search focus has one owner across shared fields and host tool overrides", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
        // Grouped searches own their frame; the standalone field renders inside a FieldControl frame.
        const owner =
          name === "Standalone search"
            ? field.locator("xpath=ancestor::*[@data-field-control][1]")
            : field.locator("..");
        const before = await owner.boundingBox();
        const resting = await owner.evaluate((node) => getComputedStyle(node).borderTopColor);
        await field.click();
        for (const keyboard of [false, true]) {
          if (keyboard) {
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
          }
          await expect(field).toBeFocused();
          // Field focus contract (src/styles/arc.css): the frame's neutral border
          // changes without a halo, inset outline or second ring on the editor.
          await expectFieldFocus(owner, resting);
          await expect(field).toHaveCSS("outline-style", "none");
          await expect(field).toHaveCSS("box-shadow", "none");
        }
        const after = await owner.boundingBox();
        expect(after!.width).toBe(before!.width);
        expect(after!.height).toBe(before!.height);
        await field.fill("focus check");
        // The frame owns its clear button in every appearance.
        const button = owner.getByRole("button", { name: "Clear search", exact: true });
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
      await expect(combo).toHaveCSS("box-shadow", "none");
      // The open combobox frame has no halo; its border follows the open state.
      await expectFieldFocus(combo.locator(".."));
      await combo.fill("First");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(combo).toHaveValue("First");
      await combo.locator("..").getByRole("button", { name: "Clear selection" }).click();
      await expect(combo).toHaveValue("");
      await page.keyboard.press("Escape");
      await region.screenshot({
        path: testInfo.outputPath(`search-focus-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  await page.getByRole("button", { name: "Search choice: First", exact: true }).click();
  const menuSearch = page
    .getByRole("dialog", { name: "Search choice options", exact: true })
    .getByRole("combobox");
  await expect(menuSearch).toBeFocused();
  await expect(menuSearch).toHaveCSS("outline-style", "none");
});

test("text fields keep focus on one border with pointer and keyboard", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
        // Text areas render inside a FieldControl frame, which owns focus presentation.
        const framed = await field.evaluate((node) => !!node.closest("[data-field-control]"));
        const owner = framed ? field.locator("xpath=ancestor::*[@data-field-control][1]") : field;
        const resting = await owner.evaluate((node) => getComputedStyle(node).borderTopColor);
        await field.click();
        await expect(field).toBeFocused();
        for (const keyboard of [false, true]) {
          if (keyboard) {
            await page.keyboard.press("Tab");
            await page.keyboard.press("Shift+Tab");
            await expect(field).toBeFocused();
          }
          if (name.startsWith("Invalid")) {
            // Invalid fields keep their danger border and show the invalid ring.
            await expect
              .poll(() =>
                owner.evaluate((node, before) => {
                  const css = getComputedStyle(node);
                  return {
                    outline: css.outlineStyle,
                    ring: /0px 0px 0px 2px/.test(css.boxShadow),
                    border: css.borderTopColor === before,
                  };
                }, resting),
              )
              .toEqual({ outline: "none", ring: true, border: true });
          } else {
            // Reduced-motion transitions still finish on a subsequent browser frame.
            await expectFieldFocus(owner, resting);
          }
          if (framed) {
            await expect(field).toHaveCSS("outline-style", "none");
            await expect(field).toHaveCSS("box-shadow", "none");
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
        path: testInfo.outputPath(`field-focus-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
});

test("shared button API preserves geometry, popup anchors, direct rows and busy keyboard guards", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared button API" });
  await region.scrollIntoViewIfNeeded();
  const icon = region.getByRole("button", { name: "Button API filters", exact: true });
  await icon.focus();
  expect(await icon.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
  // Medium buttons share the md form-field height (--ui-field-height-md) so they align with fields.
  for (const [label, size] of [
    ["Button API filters", 28],
    ["Medium button", 32],
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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

test("pending quiet actions preserve hierarchy, geometry and keyboard focus", async ({ page }) => {
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
  const region = page.getByRole("region", { name: "Shared button API" });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      for (const reducedMotion of ["no-preference", "reduce"] as const) {
        await page.emulateMedia({ reducedMotion });
        const actions = [
          region.getByRole("button", { name: "Refresh quiet action", exact: true }),
          region.getByRole("button", { name: "Quiet native action", exact: true }),
        ];
        const before = await Promise.all(actions.map((action) => action.boundingBox()));
        await actions[0].focus();
        // Change the owner's pending state without moving focus from the action.
        await region
          .getByRole("button", { name: "Toggle pending", exact: true })
          .evaluate((node: HTMLButtonElement) => node.click());
        await expect(actions[0]).toBeFocused();
        for (const [index, action] of actions.entries()) {
          await expect(action).toHaveAttribute("aria-busy", "true");
          await expect(action).toHaveJSProperty("disabled", false);
          await expect(action).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
          await expect(action).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
          if (index === 1) {
            // The label keeps its width and accessible name beneath a centered spinner.
            await expect(action.locator(":scope > span").first()).toHaveCSS("opacity", "0");
            await expect(action.locator(':scope > span[aria-hidden="true"]')).toBeVisible();
            await expect(action).toContainText("Quiet native action");
            await expect(action).toHaveAccessibleName("Quiet native action");
          }
          const after = await action.boundingBox();
          expect(after!.width).toBe(before[index]!.width);
          expect(after!.height).toBe(before[index]!.height);
          await action.focus();
          await page.keyboard.press("Enter");
          await page.keyboard.press("Space");
          await expect(action).toBeFocused();
        }
        await expect(region.getByLabel("Button action count")).toHaveText("0");
        await region.screenshot({
          path: `temp/verification/2026-10-25-apple-ui/shared-${width}-${light ? "light" : "dark"}-${reducedMotion}.png`,
        });
        await region.getByRole("button", { name: "Toggle pending", exact: true }).click();
        await expect(actions[0]).not.toHaveAttribute("aria-busy", "true");
      }
    }
  }
});

test("search clearing fits compact and wide layouts, both themes and keyboard use", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // The browser's benign ResizeObserver loop notice (WebKit reports it as an error event while
    // the clear action resizes the field); it is not an application exception.
    if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
  });
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
        // The clear action is the shared 20px inline action.
        expect(buttonBox!.width).toBe(20);
        expect(buttonBox!.height).toBe(20);
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
  const additions = page.getByRole("region", { name: "Additional Arc controls" });
  const date = additions.getByRole("button", { name: "Date range", exact: true });
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
  await page.getByRole("button", { name: "Open image comparison", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Image preview: Original fixture" });
  const close = dialog.getByRole("button", { name: "Close image preview", exact: true });
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.y).toBe(16);
  expect(closeBox.x + closeBox.width).toBe(page.viewportSize()!.width - 16);
  // The file input is hidden behind the visible Compare button, so choose the file the way a user does.
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Compare with image", exact: true }).click();
  await (
    await chooser
  ).setFiles({
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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
      const picker = page.getByRole("button", { name: "Date range", exact: true });
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
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
  await page.getByRole("button", { name: "Türkçe controls", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "JSON'da ara", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tarih aralığı", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tarih aralığı", exact: true });
  await expect(dialog.getByRole("button", { name: "Son 7 gün", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Bu çeyrek", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeVisible();
});

test("preserves settings interaction, compact geometry and both themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
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

test("selection and history keep their interactions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/shared-ui/arc-controls.html");
  const standard = page.getByRole("button", { name: /^Standard choice:/ });
  await standard.click();
  await page.getByRole("option", { name: "Second", exact: true }).click();
  await expect(standard).toContainText("Second");
  const search = page.getByRole("button", { name: /^Search choice:/ });
  await search.click();
  await page.getByRole("combobox", { name: "Search options…" }).fill("First");
  await page.getByRole("option", { name: "First", exact: true }).click();
  await expect(search).toContainText("First");
  const property = page.getByRole("button", { name: /^Property choice:/ });
  await property.click();
  await expect(page.getByRole("option", { name: "Second", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Second", exact: true }).click();
  await expect(property).toContainText("Second");
  await property.click();
  await page.keyboard.press("Escape");
  await expect(property).toHaveAttribute("aria-expanded", "false");
  await expect(property).toBeFocused();
  await expect(page.getByRole("button", { name: "Open attempt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Completed attempt/ }).click();
  await expect(page.getByText("Review summary", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await property.click();
  const option = page.getByRole("option", { name: "Second", exact: true });
  await expect(option).toBeVisible();
  const propertyDialog = page.getByRole("dialog", { name: "Property choice options", exact: true });
  const propertyList = propertyDialog.getByRole("listbox", {
    name: "Property choice",
    exact: true,
  });
  await expect(propertyDialog).toBeVisible();
  await expect(propertyList).toBeVisible();
  await expect(propertyDialog).toHaveCSS("opacity", "1");
  await expect(property).toHaveAttribute(
    "aria-controls",
    (await propertyDialog.getAttribute("id"))!,
  );
  await expect
    .poll(() =>
      option.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const bounds = node.closest('[role="dialog"]')?.getBoundingClientRect();
        return (
          !!bounds &&
          rect.top >= bounds.top - 1 &&
          rect.bottom <= bounds.bottom + 1 &&
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          rect.left >= 0 &&
          rect.right <= innerWidth
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/selection-narrow.png" });
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------
// Behaviour matrix inside the one ControlSpecimen reference (?matrix, alias ?view=matrix). FIXTURE evidence only: these checks run
// against current public adapters in a browser fixture and are never installed/native acceptance.
// ---------------------------------------------------------------------------------------
type MatrixOptions = { layout?: "default" | "narrow" | "short"; theme?: "light" | "dark" };

async function openMatrix(page: Page, { layout = "default", theme = "dark" }: MatrixOptions = {}) {
  await page.goto(
    `/tests/browser/shared-ui/arc-controls.html?matrix&layout=${layout}&theme=${theme}`,
  );
  await expect(page.getByTestId("control-matrix")).toBeVisible();
}

// Computed state that can carry a focus indication, read for a control and its frame ancestors.
async function focusChain(control: Locator) {
  return control.evaluate((node) => {
    const chain: string[] = [];
    const outlined: boolean[] = [];
    let current: Element | null = node;
    for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
      const css = getComputedStyle(current);
      chain.push(
        [css.outlineStyle, css.outlineWidth, css.outlineColor, css.boxShadow, css.borderColor].join(
          "|",
        ),
      );
      // A visually hidden native input (opacity 0 or 1px) can carry an outline nobody sees.
      const box = current.getBoundingClientRect();
      const shown = Number.parseFloat(css.opacity) > 0 && box.width > 2 && box.height > 2;
      outlined.push(
        shown && css.outlineStyle !== "none" && Number.parseFloat(css.outlineWidth) > 0,
      );
      if (depth > 0 && current.hasAttribute("data-testid")) break;
    }
    return { chain, outlined };
  });
}

// Moves focus with a keyboard modality so :focus-visible applies, ending on the same control.
async function focusByKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
}

test.describe("shared control state matrix", () => {
  test("field placeholders inherit their control typography", async ({ page }) => {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await openMatrix(page, { theme });
        for (const name of ["Plain field", "Matrix text area", "Toolbar search sm"]) {
          const control = page.getByLabel(name, { exact: true });
          await expect(control).toBeVisible();
          const typography = await control.evaluate((node) => {
            const body = getComputedStyle(node);
            const placeholder = getComputedStyle(node, "::placeholder");
            return {
              body: [body.fontSize, body.fontFamily, body.fontWeight, body.letterSpacing],
              placeholder: [
                placeholder.fontSize,
                placeholder.fontFamily,
                placeholder.fontWeight,
                placeholder.letterSpacing,
              ],
            };
          });
          expect(typography.placeholder, `${name}: ${theme} ${width}`).toEqual(typography.body);
        }
      }
    }
  });

  test("matrix sections render every family with stable test ids", async ({ page }) => {
    await openMatrix(page);
    for (const id of [
      "matrix-actions",
      "matrix-fields",
      "matrix-choices",
      "matrix-navigation",
      "matrix-tree",
      "matrix-text",
      "matrix-action-variants",
      "matrix-action-icons",
      "matrix-action-states",
      "matrix-action-long",
      "matrix-action-groups",
      "matrix-field-text",
      "matrix-field-special",
      "matrix-field-toolbar",
      "matrix-choice-select",
      "matrix-choice-checkbox",
      "matrix-choice-switch",
      "matrix-choice-radio",
      "matrix-choice-segmented",
      "matrix-nav-tabs",
      "matrix-nav-stepper",
      "matrix-tree-rows",
      "matrix-text-match",
      "matrix-text-time",
      "matrix-text-shortcut",
    ]) {
      await expect(page.getByTestId(id), id).toHaveCount(1);
    }
    // Every variant is present at each public size.
    for (const variant of ["Primary", "Secondary", "Ghost", "Danger", "Link"]) {
      for (const size of ["sm", "md", "lg"]) {
        await expect(
          page.getByRole("button", { name: `${variant} ${size}`, exact: true }),
        ).toBeVisible();
      }
    }
  });

  test("keyboard Tab order follows the document with one :focus-visible owner per stop", async ({
    page,
  }) => {
    // Walks every stop in the matrix; CI WebKit needs more than the default budget.
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMatrix(page);
    // Start on the layout selector, the first tab stop, so every later stop is counted.
    await page
      .getByRole("radiogroup", { name: "Matrix layout", exact: true })
      .getByRole("radio")
      .first()
      .focus();
    const stops: { name: string; forward: boolean; visible: number; inside: boolean }[] = [];
    for (let step = 0; step < 400; step++) {
      await page.keyboard.press("Tab");
      const state = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="control-matrix"]')!;
        const active = document.activeElement as HTMLElement | null;
        const memory = window as unknown as { __lastStop?: Element };
        const forward =
          !memory.__lastStop ||
          !active ||
          !!(memory.__lastStop.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
        memory.__lastStop = active ?? undefined;
        const label =
          active?.getAttribute("aria-label") ??
          (active as HTMLInputElement | null)?.labels?.[0]?.textContent ??
          active?.textContent ??
          "";
        return {
          name: label.replace(/\s+/g, " ").trim().slice(0, 60),
          forward,
          visible: document.querySelectorAll(":focus-visible").length,
          inside: !!active && root.contains(active),
        };
      });
      if (!state.inside) break;
      stops.push(state);
    }
    expect(stops.length).toBeGreaterThan(60);
    // Never jumps backwards: the matrix has no positive tabindex or reordered focus.
    expect(stops.filter((stop) => !stop.forward).map((stop) => stop.name)).toEqual([]);
    // One visible focus owner at every stop.
    expect(stops.filter((stop) => stop.visible !== 1).map((stop) => stop.name)).toEqual([]);
    const names = stops.map((stop) => stop.name);
    for (const name of [
      "Primary sm",
      "Count action",
      "Selected action",
      "Plain field",
      "Matrix password",
      "Toolbar search sm",
      "Matrix select",
      "Matrix searchable",
      "Checked",
      "Matrix switch",
      "Review first",
      "Selected tab",
    ]) {
      expect(
        names.some((seen) => seen.includes(name)),
        `${name} is a tab stop`,
      ).toBe(true);
    }
    // Unavailable controls are never tab stops.
    for (const name of ["Disabled action", "Disabled select", "Disabled field", "Week"]) {
      expect(
        names.filter((seen) => seen === name),
        `${name} is skipped`,
      ).toEqual([]);
    }
  });

  test("each control family shows a focus indication from exactly one owner", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const theme of ["dark", "light"] as const) {
      await openMatrix(page, { theme });
      const families: [string, Locator][] = [
        ["Button", page.getByRole("button", { name: "Secondary md", exact: true })],
        ["Button primary", page.getByRole("button", { name: "Primary md", exact: true })],
        ["Button icon", page.getByRole("button", { name: "Ghost md icon", exact: true })],
        ["ButtonGroup segment", page.getByRole("button", { name: "Day", exact: true })],
        [
          "SplitButton menu",
          page.getByRole("button", { name: "Split primary options", exact: true }),
        ],
        ["TextField", page.getByLabel("Plain field", { exact: true })],
        ["TextareaField", page.getByLabel("Matrix text area", { exact: true })],
        ["NumberField", page.getByLabel("Matrix number", { exact: true })],
        ["PasswordField", page.getByLabel("Matrix password", { exact: true })],
        ["SearchInput", page.getByLabel("Toolbar search sm", { exact: true })],
        ["Checkbox", page.getByTestId("matrix-checkbox-on")],
        ["Switch", page.getByRole("switch", { name: "Matrix switch", exact: true })],
        ["Radio", page.getByRole("radio", { name: /^Review first/ })],
        ["Segmented", page.getByRole("radio", { name: "A long first segment label" }).first()],
        ["Tab", page.getByRole("tab", { name: "Selected tab" }).first()],
        ["TreeRow", page.getByTestId("matrix-tree-selected")],
      ];
      for (const [family, control] of families) {
        await control.scrollIntoViewIfNeeded();
        const before = await focusChain(control);
        await focusByKeyboard(page, control);
        const after = await focusChain(control);
        const changed = after.chain.filter((value, index) => value !== before.chain[index]).length;
        expect(
          changed,
          `${family} (${theme}) changes some frame state on keyboard focus`,
        ).toBeGreaterThan(0);
        expect(
          after.outlined.filter(Boolean).length,
          `${family} (${theme}) has at most one outlined owner`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("checkbox exposes checked, mixed and unavailable states natively", async ({ page }) => {
    await openMatrix(page);
    const mixed = page.getByTestId("matrix-checkbox-mixed");
    await expect(mixed).toHaveAttribute("aria-checked", "mixed");
    expect(await mixed.evaluate((node: HTMLInputElement) => node.indeterminate)).toBe(true);
    await mixed.focus();
    await page.keyboard.press("Space");
    await expect(mixed).toBeChecked();
    await expect(mixed).not.toHaveAttribute("aria-checked", "mixed");
    expect(await mixed.evaluate((node: HTMLInputElement) => node.indeterminate)).toBe(false);
    await page.keyboard.press("Space");
    await expect(mixed).toHaveAttribute("aria-checked", "mixed");
    await expect(page.getByTestId("matrix-checkbox-on")).toBeChecked();
    await expect(page.getByTestId("matrix-checkbox-off")).not.toBeChecked();
    await expect(page.getByTestId("matrix-checkbox-disabled")).toBeDisabled();
    await expect(page.getByTestId("matrix-checkbox-disabled-on")).toBeDisabled();
    await expect(page.getByTestId("matrix-checkbox-disabled-on")).toBeChecked();
    await page.getByText("Unchecked", { exact: true }).click();
    await expect(page.getByTestId("matrix-checkbox-off")).toBeChecked();
  });

  test("switch exposes role and aria-checked and honors keyboard and disabled state", async ({
    page,
  }) => {
    await openMatrix(page);
    const toggle = page.getByRole("switch", { name: "Matrix switch", exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Switch on", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const blocked = page.getByRole("switch", { name: "Disabled switch", exact: true });
    await expect(blocked).toBeDisabled();
    await expect(blocked).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByRole("switch", { name: "Disabled switch on", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("radio group arrow keys move focus and selection and skip unavailable options", async ({
    page,
  }) => {
    await openMatrix(page);
    const group = page.getByRole("group", { name: "Matrix radios", exact: true });
    const review = group.getByRole("radio", { name: /^Review first/ });
    const manual = group.getByRole("radio", { name: /^Manual approval/ });
    const locked = group.getByRole("radio", { name: /^Unavailable approval/ });
    await expect(review).toBeChecked();
    await expect(locked).toBeDisabled();
    await review.focus();
    await page.keyboard.press("ArrowDown");
    await expect(manual).toBeChecked();
    await expect(manual).toBeFocused();
    // Past the last available option engines may wrap or stop, but never select the unavailable one.
    await page.keyboard.press("ArrowDown");
    await expect(locked).not.toBeChecked();
    await review.check();
    await review.focus();
    await page.keyboard.press("ArrowDown");
    await expect(manual).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(review).toBeChecked();
  });

  test("segmented control uses roving focus with arrow, Home and End keys", async ({ page }) => {
    await openMatrix(page);
    const group = page.getByRole("radiogroup", { name: "Matrix segments", exact: true });
    const options = group.getByRole("radio");
    await expect(options).toHaveCount(3);
    await expect(options.first()).toHaveAttribute("aria-checked", "true");
    await options.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(options.nth(1)).toBeFocused();
    await expect(options.nth(1)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("End");
    await expect(options.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(options.first()).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(options.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(options.first()).toBeFocused();
    // Only the selected option is a tab stop.
    expect(
      await options.evaluateAll(
        (nodes) => nodes.filter((node) => (node as HTMLElement).tabIndex >= 0).length,
      ),
    ).toBe(1);
    // The pressed-mode sibling keeps button semantics.
    const pressed = page.getByRole("group", { name: "Pressed segments", exact: true });
    await expect(pressed.getByRole("button", { name: "List" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("loading and disabled actions never activate", async ({ page }) => {
    await openMatrix(page);
    const count = page.getByTestId("matrix-action-count");
    await expect(count).toHaveText("0");
    await page.getByRole("button", { name: "Count action", exact: true }).click();
    await expect(count).toHaveText("1");
    for (const id of ["matrix-loading-text", "matrix-loading-icon"]) {
      const control = page.getByTestId(id);
      expect(
        await control.evaluate(
          (node: HTMLButtonElement) =>
            node.disabled || node.getAttribute("aria-disabled") === "true",
        ),
        `${id} is blocked for assistive technology`,
      ).toBe(true);
      await control.evaluate((node) => (node as HTMLElement).click());
      await control.focus({ timeout: 500 }).catch(() => {});
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await expect(count).toHaveText("1");
    }
    await page
      .getByRole("button", { name: "Disabled action", exact: true })
      .evaluate((node) => (node as HTMLElement).click());
    await expect(count).toHaveText("1");
    // The loading text action keeps its name while pending.
    await expect(page.getByTestId("matrix-loading-text")).toContainText("Loading action");
    const pressed = page.getByRole("button", { name: "Selected action", exact: true });
    await pressed.click();
    await expect(pressed).toHaveAttribute("aria-pressed", "true");
  });

  test("split action keeps independent primary and menu gates", async ({ page }) => {
    await openMatrix(page);
    const blocked = page.getByRole("group", { name: "Split blocked", exact: true });
    await expect(
      blocked.getByRole("button", { name: "Split blocked", exact: true }),
    ).toBeDisabled();
    const menu = blocked.getByRole("button", { name: "Split blocked options", exact: true });
    await expect(menu).toBeEnabled();
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Available option" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Available option" })).toHaveCount(0);
    await expect(menu).toBeFocused();
    const loading = page.getByRole("group", { name: "Split loading", exact: true });
    await expect(
      loading.getByRole("button", { name: "Split loading options", exact: true }),
    ).toBeDisabled();
    // A joined group keeps a disabled segment without disabling its siblings.
    const joined = page.getByRole("group", { name: "Joined actions", exact: true });
    await expect(joined.getByRole("button", { name: "Week", exact: true })).toBeDisabled();
    await expect(joined.getByRole("button", { name: "Day", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(joined.getByRole("button", { name: "Month", exact: true })).toBeEnabled();
  });

  test("tree rows distinguish drop destination from selection [CMP-08]", async ({ page }) => {
    for (const theme of ["dark", "light"] as const) {
      await openMatrix(page, { theme });
      const signature = (id: string) =>
        page.getByTestId(`matrix-tree-${id}`).evaluate((node) => {
          const read = (pseudo: string | null) => {
            const css = getComputedStyle(node, pseudo);
            return [
              css.backgroundColor,
              css.boxShadow,
              css.outlineStyle,
              css.outlineWidth,
              css.outlineColor,
              css.borderInlineStartWidth,
              css.borderInlineStartColor,
              pseudo ? css.content : "",
              pseudo ? css.backgroundImage : "",
              pseudo ? css.inlineSize : "",
            ].join("|");
          };
          return [read(null), read("::before"), read("::after")].join("||");
        });
      const rest = await signature("depth1");
      const selected = await signature("selected");
      const drop = await signature("drop");
      const both = await signature("selected-drop");
      expect(selected, `selected differs from rest (${theme})`).not.toBe(rest);
      expect(drop, `drop target differs from rest (${theme})`).not.toBe(rest);
      expect(drop, `drop target differs from selection (${theme})`).not.toBe(selected);
      expect(both, `selected drop target differs from selection (${theme})`).not.toBe(selected);
      expect(both, `selected drop target differs from drop target (${theme})`).not.toBe(drop);
      await expect(page.getByTestId("matrix-tree-drop")).toHaveAttribute(
        "data-tree-drop-target",
        "true",
      );
      await expect(page.getByTestId("matrix-tree-drop")).not.toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });

  test("tree rows keep depth, cut, unavailable and long-name geometry", async ({ page }) => {
    await openMatrix(page, { layout: "narrow" });
    const padding = (id: string) =>
      page
        .getByTestId(`matrix-tree-${id}`)
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingInlineStart));
    const depths = [
      await padding("depth0"),
      await padding("depth1"),
      await padding("depth2"),
      await padding("depth3"),
    ];
    expect(depths[1]).toBeGreaterThan(depths[0]);
    expect(depths[2]).toBeGreaterThan(depths[1]);
    expect(depths[3]).toBeGreaterThan(depths[2]);
    await expect(page.getByTestId("matrix-tree-depth3")).toHaveAttribute("aria-level", "4");
    await expect(page.getByTestId("matrix-tree-cut")).toHaveAttribute("data-tree-cut", "true");
    expect(
      await page
        .getByTestId("matrix-tree-cut")
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).opacity)),
    ).toBeLessThan(1);
    await expect(page.getByTestId("matrix-tree-disabled")).toBeDisabled();
    const long = page.getByTestId("matrix-tree-long");
    const bounds = (await page.getByTestId("matrix-tree-rows").boundingBox())!;
    const row = (await long.boundingBox())!;
    expect(row.width).toBeLessThanOrEqual(bounds.width + 1);
    expect(await long.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    // Rows share one fixed height regardless of state or name length.
    const heights = await page
      .getByTestId("matrix-tree-rows")
      .getByRole("treeitem")
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
  });

  test("text field controls keep one height whatever their grid neighbours contain", async ({
    page,
  }) => {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await openMatrix(page);
      // Inputs inside a FieldControl are borderless editors; their frame carries the height.
      const heights = await page
        .getByTestId("matrix-field-text")
        .locator("input:not([type='hidden'])")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            name: (node as HTMLInputElement).labels?.[0]?.textContent ?? "",
            height: Math.round(
              (node.closest("[data-field-control]") ?? node).getBoundingClientRect().height,
            ),
          })),
        );
      expect(heights.length).toBeGreaterThan(6);
      const reference = Math.min(...heights.map((entry) => entry.height));
      expect(
        heights.filter((entry) => Math.abs(entry.height - reference) > 1),
        `${width}: inputs taller than the shortest field (${reference}px)`,
      ).toEqual([]);
    }
  });

  test("compact and form-size search, button and icon button share one row alignment", async ({
    page,
  }) => {
    for (const theme of ["dark", "light"] as const) {
      await openMatrix(page, { theme });
      for (const size of ["sm", "md"] as const) {
        const row = page.getByTestId(`matrix-toolbar-${size}`);
        const search = row.locator("[data-ui-focus-group]");
        const filter = page.getByTestId(`matrix-toolbar-${size}-filter`);
        const add = page.getByTestId(`matrix-toolbar-${size}-add`);
        const [a, b, c] = (
          await Promise.all([search.boundingBox(), filter.boundingBox(), add.boundingBox()])
        ).map((box) => box!);
        const center = (box: { y: number; height: number }) => box.y + box.height / 2;
        const label = `${size} ${theme}`;
        expect(
          Math.abs(center(a) - center(b)),
          `search/filter centers (${label})`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(center(a) - center(c)),
          `search/add centers (${label})`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(a.height - b.height),
          `search/filter heights (${label})`,
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(b.height - c.height), `filter/add heights (${label})`).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  test("long labels and narrow or short layouts never overflow their container", async ({
    page,
  }) => {
    for (const layout of ["narrow", "short"] as const) {
      for (const width of [320, 800]) {
        await page.setViewportSize({ width, height: 700 });
        await openMatrix(page, { layout });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${layout} ${width}: no page-level horizontal scroll`,
        ).toBe(true);
        // Sections do not clip, so any descendant wider than the section is a real overflow.
        const overflowing = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-testid^="matrix-"]')]
            .filter((node) => node.tagName === "SECTION" && node.scrollWidth > node.clientWidth + 1)
            .map((node) => `${node.dataset.testid}: ${node.scrollWidth} > ${node.clientWidth}`),
        );
        expect(overflowing, `${layout} ${width}: sections that overflow horizontally`).toEqual([]);
        const narrow = page.getByTestId("matrix-action-narrow");
        const container = (await narrow.boundingBox())!;
        for (const button of await narrow.getByRole("button").all()) {
          const box = (await button.boundingBox())!;
          expect(
            box.x + box.width,
            `${layout} ${width}: long label stays inside`,
          ).toBeLessThanOrEqual(container.x + container.width + 1);
          // Label text must wrap, truncate or be clipped by the button, never paint outside it.
          const spill = await button.evaluate((node) => {
            const frame = node.getBoundingClientRect();
            return [...node.querySelectorAll<HTMLElement>("*")].some((child) => {
              const rect = child.getBoundingClientRect();
              if (!rect.width || (rect.right <= frame.right + 1 && rect.left >= frame.left - 1)) {
                return false;
              }
              for (let at: HTMLElement | null = child; at; at = at.parentElement) {
                if (getComputedStyle(at).overflowX !== "visible") return false;
                if (at === node) break;
              }
              return true;
            });
          });
          expect(spill, `${layout} ${width}: label painted outside its button`).toBe(false);
        }
      }
    }
    // Short layout scrolls inside the matrix body and keeps the last section reachable.
    await openMatrix(page, { layout: "short" });
    const body = page.getByTestId("control-matrix-body");
    expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await page.getByTestId("matrix-text").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("matrix-time-fixed")).toBeVisible();
  });

  test("matrix text families keep their semantics", async ({ page }) => {
    await openMatrix(page);
    const matched = page.getByTestId("matrix-match-active");
    await expect(matched).toHaveText("src/shared/ui/SearchableSelect.tsx");
    expect(await matched.locator("[data-match]").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("matrix-match-inactive").locator("[data-match]")).toHaveCount(0);
    await expect(page.getByTestId("matrix-time-today")).toContainText("Today");
    await expect(page.getByTestId("matrix-time-yesterday")).toContainText("Yesterday");
    await expect(page.getByTestId("matrix-time-fixed")).toHaveAttribute("datetime", /^2027-01-15T/);
    expect(await page.getByTestId("matrix-text-shortcut").locator("kbd").count()).toBeGreaterThan(
      3,
    );
    await expect(page.getByTestId("matrix-text-shortcut").getByRole("img").first()).toHaveAttribute(
      "aria-label",
      /.+/,
    );
  });

  test("matrix has accessible names, unique ids, valid ARIA and no nested interactives", async ({
    page,
  }) => {
    for (const layout of ["default", "narrow"] as const) {
      await openMatrix(page, { layout });
      const findings = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="control-matrix"]')!;
        const out: string[] = [];
        const text = (node: Element | null) =>
          (node?.textContent ?? "").replace(/\s+/g, " ").trim();
        const name = (node: Element): string => {
          const labelledBy = node.getAttribute("aria-labelledby");
          if (labelledBy)
            return labelledBy
              .split(/\s+/)
              .map((id) => text(document.getElementById(id)))
              .join(" ")
              .trim();
          const aria = node.getAttribute("aria-label");
          if (aria?.trim()) return aria.trim();
          const labels = (node as HTMLInputElement).labels;
          if (labels?.length)
            return [...labels]
              .map((label) => text(label))
              .join(" ")
              .trim();
          if (node.getAttribute("title")) return node.getAttribute("title")!;
          return text(node);
        };
        const describe = (node: Element) =>
          `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}[${node.getAttribute("role") ?? ""}] "${text(node).slice(0, 30)}"`;
        const interactive =
          'button, input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [role="treeitem"], [role="combobox"], [role="menuitem"], [role="option"]';
        for (const node of root.querySelectorAll(interactive)) {
          if (node.closest("[hidden], [aria-hidden='true']")) continue;
          if (!name(node)) out.push(`unnamed: ${describe(node)}`);
          if (node.querySelector(interactive)) out.push(`nested interactive: ${describe(node)}`);
        }
        const ids = new Map<string, number>();
        for (const node of document.querySelectorAll("[id]"))
          ids.set(node.id, (ids.get(node.id) ?? 0) + 1);
        for (const [id, total] of ids) if (total > 1) out.push(`duplicate id: ${id} x${total}`);
        for (const attribute of ["aria-checked", "aria-pressed"]) {
          for (const node of root.querySelectorAll(`[${attribute}]`)) {
            const value = node.getAttribute(attribute);
            if (!["true", "false", "mixed"].includes(value ?? ""))
              out.push(`${attribute}=${value}: ${describe(node)}`);
          }
        }
        for (const attribute of ["aria-expanded", "aria-selected", "aria-disabled"]) {
          for (const node of root.querySelectorAll(`[${attribute}]`)) {
            const value = node.getAttribute(attribute);
            if (!["true", "false"].includes(value ?? ""))
              out.push(`${attribute}=${value}: ${describe(node)}`);
          }
        }
        const parents: [string, string][] = [
          ['[role="tab"]', '[role="tablist"]'],
          ['[role="treeitem"]', '[role="tree"], [role="group"]'],
        ];
        for (const [child, parent] of parents)
          for (const node of root.querySelectorAll(child))
            if (!node.closest(parent)) out.push(`${child} outside ${parent}: ${describe(node)}`);
        for (const node of root.querySelectorAll(
          '[role="radiogroup"], [role="group"], [role="tablist"], [role="tree"]',
        ))
          if (!name(node)) out.push(`unnamed container: ${describe(node)}`);
        return out;
      });
      expect(findings, `${layout}: accessibility findings`).toEqual([]);
    }
  });

  // ---- Phase 2: scenarios added after subagents A, B and C landed (fixture evidence only) ----

  const triggerOf = (page: Page, label: string) =>
    page.getByRole("button", { name: new RegExp(`^${label}`) });

  test("searchable select keeps its committed value while loading and exposes a reachable retry", async ({
    page,
  }) => {
    await openMatrix(page);
    const loading = triggerOf(page, "Branch loading");
    await expect(loading).toBeEnabled();
    await expect(loading).toHaveAttribute("aria-busy", "true");
    await expect(loading).toContainText("main");
    await loading.click();
    const popup = page.getByRole("dialog");
    await expect(popup).toContainText("Loading branches…");
    // Stale options stay choosable and the committed value is not replaced by the status.
    await expect(popup.getByRole("option", { name: "develop" })).toBeVisible();
    await expect(loading).toContainText("main");
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(loading).toBeFocused();
    await expect(loading).toContainText("main");

    const failing = triggerOf(page, "Branch with error");
    await failing.click();
    const alert = page.getByRole("alert").filter({ hasText: "Could not reach the host" });
    await expect(alert).toBeVisible();
    const retry = page.getByRole("dialog").getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    await expect(page.getByRole("option", { name: "feature/search" })).toHaveCount(0);
    // From the search field, one Tab reaches Retry; Enter loads and clears the error.
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole("option", { name: "feature/search" })).toBeVisible();
    await expect(failing).toContainText("main");
  });

  test("searchable select separates an empty source, a filtered-empty search and a large list", async ({
    page,
  }) => {
    await openMatrix(page);
    await triggerOf(page, "Empty projects").click();
    await expect(page.getByRole("dialog")).toContainText("No projects yet");
    await page.keyboard.press("Escape");
    await triggerOf(page, "Filtered projects").click();
    await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible();
    await expect(page.getByRole("dialog").locator("input").first()).toBeFocused();
    await page.keyboard.type("zzz");
    await expect(page.getByRole("dialog")).toContainText("No matching projects");
    await expect(page.getByRole("dialog")).not.toContainText("No projects yet");
    await page.keyboard.press("Escape");
    const big = triggerOf(page, "Big list");
    await expect(big).toContainText("refs/heads/feature/branch-250");
    await big.click();
    await expect(page.getByRole("option")).toHaveCount(500);
    await expect(page.getByRole("dialog").locator("input").first()).toBeFocused();
    await page.keyboard.type("branch-499");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  test("searchable select keyboard skips unavailable options and never selects them", async ({
    page,
  }) => {
    await openMatrix(page);
    const reviewers = triggerOf(page, "Reviewers");
    await reviewers.click();
    await expect(page.getByRole("dialog").locator("input").first()).toBeFocused();
    const active = () =>
      page.evaluate(() => {
        const id = document
          .querySelector("[aria-activedescendant]")
          ?.getAttribute("aria-activedescendant");
        return (id && document.getElementById(id)?.textContent) || "";
      });
    expect(await active()).toContain("Project with a very long descriptive name");
    await page.keyboard.press("ArrowDown");
    expect(await active()).toContain("Another reviewer");
    expect(await active()).not.toContain("Unavailable person");
    await page.keyboard.press("Enter");
    const unavailable = page.getByRole("option", { name: /Unavailable person/ });
    await expect(unavailable).toHaveAttribute("aria-disabled", "true");
    await unavailable.click({ force: true });
    await page.keyboard.press("Escape");
    const chips = page.getByTestId("matrix-choice-async");
    await expect(chips).toContainText("Another reviewer");
    await expect(chips.getByText("Unavailable person", { exact: true })).toHaveCount(0);
  });

  test("select keyboard skips unavailable options and keeps a disabled committed value", async ({
    page,
  }) => {
    await openMatrix(page);
    const environment = triggerOf(page, "Environment");
    await expect(triggerOf(page, "Committed disabled value")).toContainText("Staging");
    await environment.focus();
    await page.keyboard.press("ArrowDown");
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    const active = () =>
      page.evaluate(() => {
        const id = document
          .querySelector("[aria-activedescendant]")
          ?.getAttribute("aria-activedescendant");
        return (id && document.getElementById(id)?.textContent) || "";
      });
    expect(await active()).toBe("Development");
    await page.keyboard.press("ArrowDown");
    expect(await active()).toBe("Production");
    await page.keyboard.press("Enter");
    await expect(environment).toContainText("Production");
    await environment.click();
    const staging = page.getByRole("option", { name: "Staging" });
    expect(
      await staging.evaluate(
        (node) =>
          (node as HTMLButtonElement).disabled || node.getAttribute("aria-disabled") === "true",
      ),
    ).toBe(true);
    await staging.click({ force: true });
    await page.keyboard.press("Escape");
    await expect(environment).toContainText("Production");
    await expect(environment).not.toContainText("Staging");
  });

  test("segmented control arrow keys skip a disabled segment", async ({ page }) => {
    await openMatrix(page);
    const group = page.getByRole("radiogroup", { name: "Disabled segment", exact: true });
    const alpha = group.getByRole("radio", { name: "Alpha" });
    const beta = group.getByRole("radio", { name: "Beta" });
    const gamma = group.getByRole("radio", { name: /^Gamma/ });
    const delta = group.getByRole("radio", { name: "Delta" });
    await expect(beta).toBeDisabled();
    await alpha.focus();
    await page.keyboard.press("ArrowRight");
    await expect(gamma).toBeFocused();
    await expect(gamma).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(alpha).toBeFocused();
    await page.keyboard.press("End");
    await expect(delta).toBeFocused();
    await page.keyboard.press("Home");
    await expect(alpha).toBeFocused();
    await expect(beta).not.toHaveAttribute("aria-checked", "true");
    const pressed = page.getByRole("group", { name: "Disabled pressed segment", exact: true });
    await expect(pressed.getByRole("button", { name: "Beta" })).toBeDisabled();
  });

  test("a narrow segmented control keeps its selected segment scrolled into view", async ({
    page,
  }) => {
    for (const theme of ["dark", "light"] as const) {
      await openMatrix(page, { theme });
      const group = page.getByRole("radiogroup", { name: "Narrow segments", exact: true });
      const selected = group.getByRole("radio", { checked: true });
      await expect(selected).toBeVisible();
      const inside = await selected.evaluate((node) => {
        const track = node.parentElement!;
        const box = node.getBoundingClientRect();
        const frame = track.getBoundingClientRect();
        return {
          overflows: track.scrollWidth > track.clientWidth,
          inside: box.left >= frame.left - 1 && box.right <= frame.right + 1,
        };
      });
      expect(inside.overflows, `${theme}: the narrow track scrolls`).toBe(true);
      expect(inside.inside, `${theme}: selected segment is fully inside the track`).toBe(true);
    }
  });

  test("middle truncation keeps the full value accessible and the tail visible", async ({
    page,
  }) => {
    await openMatrix(page);
    const full = "src/features/source-control/ui/GitChangesPanel.component.test.tsx";
    for (const width of [160, 480]) {
      for (const kind of ["path", "branch", "model"]) {
        const row = page.getByTestId(`matrix-middle-${kind}-${width}`);
        const state = await row.evaluate((node) => {
          const root = node.querySelector<HTMLElement>("[data-middle-truncate]")!;
          const halves = [...root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')];
          const readable = [...root.children].find(
            (child) => child.getAttribute("aria-hidden") !== "true",
          )!;
          const frame = node.getBoundingClientRect();
          const tail = halves[halves.length - 1];
          const head = halves[0];
          const tailBox = tail.getBoundingClientRect();
          // Natural width of the full value in the same font, to know whether it needs shortening.
          const probe = document.createElement("span");
          probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
          probe.textContent = readable.textContent;
          root.append(probe);
          const fits = probe.getBoundingClientRect().width <= frame.width;
          probe.remove();
          return {
            value: readable.textContent,
            fits,
            joined: halves.map((half) => half.textContent).join(""),
            tailText: tail.textContent,
            tailInside:
              tailBox.width > 0 &&
              tailBox.right <= frame.right + 1 &&
              tailBox.left >= frame.left - 1,
            tailClipped: tail.scrollWidth > tail.clientWidth + 1,
            headClipped: head.scrollWidth > head.clientWidth + 1,
            rootClipped: root.scrollWidth > root.clientWidth + 1,
            rootInside: root.getBoundingClientRect().right <= frame.right + 1,
          };
        });
        expect.soft(state.value, `${kind} ${width}: full value is readable text`).toBeTruthy();
        // A shortened value recovers its full text through the shared overflow hint (no native title).
        if (state.headClipped || state.tailClipped) {
          await row.locator("[data-middle-truncate]").hover();
          await expect
            .soft(page.getByRole("tooltip"), `${kind} ${width}: hint carries the full value`)
            .toHaveText(state.value!);
          await page.mouse.move(0, 0);
          await expect(page.getByRole("tooltip")).toHaveCount(0);
        }
        expect
          .soft(state.joined, `${kind} ${width}: visible halves reconstruct the value`)
          .toBe(state.value);
        expect
          .soft(state.tailInside, `${kind} ${width}: tail stays inside the container`)
          .toBe(true);
        expect.soft(state.tailClipped, `${kind} ${width}: tail is not clipped`).toBe(false);
        expect
          .soft(state.rootInside, `${kind} ${width}: value stays inside the container`)
          .toBe(true);
        if (kind === "path") expect.soft(state.value).toBe(full);
        if (kind === "path" && width === 160) {
          expect.soft(state.headClipped, "path 160: the head is what gets shortened").toBe(true);
          expect.soft(state.tailText.endsWith("test.tsx")).toBe(true);
        }
        if (kind === "path" && width === 480 && state.fits) {
          // Platform fonts differ; only a value that fits must stay unshortened.
          expect.soft(state.headClipped, "path 480: nothing needs shortening").toBe(false);
        }
      }
    }
  });

  test("long label button stays within its container and ends in an ellipsis", async ({ page }) => {
    for (const theme of ["dark", "light"] as const) {
      await openMatrix(page, { theme });
      const container = (await page.getByTestId("matrix-action-narrow").boundingBox())!;
      for (const button of await page
        .getByTestId("matrix-action-narrow")
        .getByRole("button")
        .all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(container.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width + 1);
        const text = await button.evaluate((node) => {
          const frame = node.getBoundingClientRect();
          // The innermost element holding the label text.
          let holder: HTMLElement = node as HTMLElement;
          for (const el of node.querySelectorAll<HTMLElement>("*")) {
            if (el.children.length === 0 && el.textContent) holder = el;
          }
          let ellipsis = false;
          let clipper: HTMLElement = holder;
          for (let at: HTMLElement | null = holder; at; at = at.parentElement) {
            const css = getComputedStyle(at);
            if (css.textOverflow === "ellipsis" && css.overflowX !== "visible") {
              ellipsis = true;
              clipper = at;
              break;
            }
            if (at === node) break;
          }
          const box = holder.getBoundingClientRect();
          return {
            ellipsis,
            truncated: clipper.scrollWidth > clipper.clientWidth + 1,
            inside: box.right <= frame.right + 1 && box.left >= frame.left - 1,
          };
        });
        expect(text.ellipsis, `${theme}: label ends in an ellipsis`).toBe(true);
        expect(text.truncated, `${theme}: label is actually shortened`).toBe(true);
        expect(text.inside, `${theme}: label box stays inside its button`).toBe(true);
      }
    }
  });

  test("tab alignment follows the explicit align prop", async ({ page }) => {
    await openMatrix(page);
    const gaps = async (id: string) =>
      page.getByTestId(id).evaluate((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        const text = range.getBoundingClientRect();
        const frame = button.getBoundingClientRect();
        return { left: text.left - frame.left, right: frame.right - text.right };
      });
    const start = await gaps("matrix-tab-start");
    const centered = await gaps("matrix-tab-default");
    const end = await gaps("matrix-tab-end");
    expect(start.left).toBeLessThan(start.right - 20);
    expect(Math.abs(centered.left - centered.right)).toBeLessThanOrEqual(2);
    expect(end.right).toBeLessThan(end.left - 20);
    await expect(page.getByTestId("matrix-tab-start")).toHaveAttribute(
      "data-button-align",
      "start",
    );
    await expect(page.getByTestId("matrix-tab-end")).toHaveAttribute("data-button-align", "end");
  });

  test("tab labels truncate in the middle, keep the extension and the unsaved dot", async ({
    page,
  }) => {
    await openMatrix(page);
    for (const width of [180, 120]) {
      const strip = page.getByTestId(`matrix-tabs-middle-${width}`);
      const stripBox = (await strip.boundingBox())!;
      const dot = strip.getByRole("img", { name: "Unsaved changes" });
      await expect(dot).toBeVisible();
      const dotBox = (await dot.boundingBox())!;
      expect(
        dotBox.x + dotBox.width,
        `${width}: dot stays inside the tab strip`,
      ).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1);
      const label = await strip.evaluate((node) => {
        const halves = [
          ...node.querySelectorAll<HTMLElement>('[data-middle-truncate] [aria-hidden="true"]'),
        ];
        const tail = halves[halves.length - 1];
        const frame = node.getBoundingClientRect();
        const box = tail.getBoundingClientRect();
        return {
          tailText: tail.textContent,
          inside: box.width > 0 && box.right <= frame.right + 1,
        };
      });
      expect(label.tailText?.endsWith("v2.tsx"), `${width}: extension survives`).toBe(true);
      expect(label.inside, `${width}: tail inside strip`).toBe(true);
      // The shortened label recovers its full name through the shared overflow hint.
      await strip.locator("[data-middle-truncate]").hover();
      await expect(page.getByRole("tooltip")).toHaveText("Quarterly-report.final.v2.tsx");
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
    // The end-truncating label fades and exposes its full text only while it is clipped.
    const end = page.getByTestId("matrix-tabs-end-120").locator(".tab-label");
    await expect(end).toHaveAttribute("data-overflow", "true");
    await end.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Quarterly-report.final.v2.tsx");
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // The unsaved dot must stay visible when the end-truncating label is clipped.
    const endStrip = page.getByTestId("matrix-tabs-end-120");
    const endBox = (await endStrip.boundingBox())!;
    const endDot = (await endStrip.getByRole("img", { name: "Unsaved changes" }).boundingBox())!;
    expect
      .soft(endDot.x + endDot.width, "end-truncating tab: dot stays inside the strip")
      .toBeLessThanOrEqual(endBox.x + endBox.width + 1);
  });

  test("tree row slots keep the trailing count visible beside a truncating label", async ({
    page,
  }) => {
    await openMatrix(page, { layout: "narrow" });
    const row = page.getByTestId("matrix-tree-long");
    const state = await row.evaluate((node) => {
      const frame = node.getBoundingClientRect();
      const trailing = [...node.querySelectorAll<HTMLElement>("span")].find(
        (el) => el.textContent === "128",
      )!;
      const label = [...node.querySelectorAll<HTMLElement>("span")].find((el) =>
        el.textContent?.startsWith("a-very-long"),
      )!;
      const trailingBox = trailing.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      return {
        trailingInside: trailingBox.right <= frame.right + 1 && trailingBox.width > 0,
        labelTruncated: label.scrollWidth > label.clientWidth + 1,
        noOverlap: labelBox.right <= trailingBox.left + 1,
        rowOverflow: node.scrollWidth > node.clientWidth + 1,
      };
    });
    expect(state.trailingInside).toBe(true);
    expect(state.labelTruncated).toBe(true);
    expect(state.noOverlap).toBe(true);
    expect(state.rowOverflow).toBe(false);
    // Toggle slot is reserved on files so labels share one start across rows.
    const starts = await page
      .getByTestId("matrix-tree-rows")
      .locator('[data-testid^="matrix-tree-depth"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const label = [...node.querySelectorAll<HTMLElement>("span")].find(
            (el) => el.children.length === 0 && el.textContent,
          )!;
          return Math.round(label.getBoundingClientRect().left - node.getBoundingClientRect().left);
        }),
      );
    expect(starts[1] - starts[0], "depth steps indent labels").toBeGreaterThan(0);
  });

  test("joined groups and split buttons keep one control height and independent gates", async ({
    page,
  }) => {
    await openMatrix(page);
    const review = page.getByRole("group", { name: "Review", exact: true });
    const [groupBox, firstBox] = [
      await review.boundingBox(),
      await review.getByRole("button").first().boundingBox(),
    ];
    expect(
      Math.abs(groupBox!.height - firstBox!.height),
      "group is exactly one Button tall",
    ).toBeLessThanOrEqual(1);
    await expect(review.getByRole("button", { name: "Request changes" })).toBeDisabled();
    await expect(review.getByRole("button", { name: /^Merg/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    const seam = (name: string) =>
      page.getByRole("group", { name, exact: true }).getAttribute("data-split-seam");
    expect(await seam("Commit")).toBe("gap");
    expect(await seam("Merge pull request")).toBe("shared");
    expect(await seam("Shell")).toBe("none");
    const commit = page.getByRole("group", { name: "Commit", exact: true });
    await expect(commit.locator('[data-split-part="primary"]')).toHaveCount(1);
    await expect(commit.locator('[data-split-part="menu"]')).toHaveCount(1);
    const heights = await commit
      .locator("button")
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    await expect(page.getByRole("button", { name: "Commit blocked", exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Commit blocked options", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Merge pull request", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: "Merge options", exact: true })).toBeDisabled();
    const full = (await page.getByTestId("matrix-split-full").boundingBox())!;
    const fullGroup = (await page
      .getByRole("group", { name: "Commit everything", exact: true })
      .boundingBox())!;
    expect(Math.abs(fullGroup.width - full.width)).toBeLessThanOrEqual(1);
  });

  test("tag input and search errors are announced and distinguishable from read only and disabled", async ({
    page,
  }) => {
    await openMatrix(page);
    const tags = page
      .getByTestId("matrix-field-more")
      .getByRole("textbox", { name: "Tags with error" });
    await expect(tags).toHaveAttribute("aria-invalid", "true");
    const described = await tags.evaluate((node) =>
      (node.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
    expect(described).toContain("At least three labels");
    await expect(
      page.getByRole("alert").filter({ hasText: "At least three labels" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Invalid search" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByRole("textbox", { name: "Read only search" })).toHaveAttribute(
      "readonly",
      "",
    );
    await expect(page.getByRole("textbox", { name: "Disabled search" })).toBeDisabled();
    const frame = (testId: string) =>
      page.getByTestId(testId).evaluate((node) => {
        const css = getComputedStyle(node);
        return [css.borderColor, css.backgroundColor, css.opacity, css.outlineColor].join("|");
      });
    const invalid = await frame("matrix-search-invalid");
    const readonly = await frame("matrix-search-readonly");
    const disabled = await frame("matrix-search-disabled");
    expect(invalid).not.toBe(readonly);
    expect(readonly).not.toBe(disabled);
  });
});

test.describe("inline actions and caller placement (H1, written 2026-10-28, not yet run)", () => {
  const background = (locator: Locator) =>
    locator.evaluate((node) => getComputedStyle(node).backgroundColor);
  const alpha = (color: string) => {
    // Computed colors serialize as `rgba(r, g, b, a)` or, for mixed tokens, `color(srgb r g b / a)`.
    const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const match = color.match(/rgba?\(([^)]+)\)/);
    const parts = match ? match[1]!.split(",").map((part) => Number(part.trim())) : [];
    return parts.length === 4 ? parts[3]! : 1;
  };

  test("the host keeps one highlight while the pointer moves onto its inline action", async ({
    page,
  }) => {
    for (const theme of ["dark", "light"] as const) {
      await openMatrix(page, { theme });
      const host = page.getByTestId("matrix-inline-tab-readme");
      const close = page.getByTestId("matrix-inline-close-readme");
      const tab = host.getByRole("tab");
      await tab.hover();
      const hovered = await background(host);
      await close.hover();
      expect(await background(host), `${theme}: host fill stays while over the action`).toBe(
        hovered,
      );
      // The primary control never paints its own fill inside a host.
      expect(alpha(await background(tab)), `${theme}: tab fill`).toBe(0);
      // The action adds a translucent overlay, never an opaque square.
      expect(alpha(await background(close)), `${theme}: close overlay`).toBeLessThan(1);
      // A selected host keeps its selection fill under the hovered action.
      const selected = page.getByTestId("matrix-inline-tab-panel");
      const before = await background(selected);
      await page.getByTestId("matrix-inline-close-panel").hover();
      expect(await background(selected), `${theme}: selected host`).toBe(before);
    }
  });

  test("inline actions reveal with the host, keyboard focus and selection", async ({ page }) => {
    await openMatrix(page);
    const opacity = (testId: string) =>
      page.getByTestId(testId).evaluate((node) => Number(getComputedStyle(node).opacity));
    await page.mouse.move(0, 0);
    await expect.poll(() => opacity("matrix-inline-more-inbox")).toBe(0);
    // Selected and always-revealed rows show their actions at rest.
    await expect.poll(() => opacity("matrix-inline-more-release")).toBe(1);
    await expect.poll(() => opacity("matrix-inline-more-pinned")).toBe(1);
    await page.getByTestId("matrix-inline-row-inbox").hover();
    await expect.poll(() => opacity("matrix-inline-more-inbox")).toBe(1);
    await page.mouse.move(0, 0);
    // Keyboard focus reveals a hidden action without hover.
    await page.getByTestId("matrix-inline-row-inbox").getByRole("button").first().focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("matrix-inline-more-inbox")).toBeFocused();
    await expect.poll(() => opacity("matrix-inline-more-inbox")).toBe(1);
  });

  test("inline actions never trigger the primary action, and middle click stays with the host", async ({
    page,
  }) => {
    await openMatrix(page);
    const log = page.getByTestId("matrix-inline-log");
    await page.getByTestId("matrix-inline-close-readme").click();
    await expect(log).toHaveText("closed readme");
    await expect(page.getByTestId("matrix-inline-tab-readme")).toHaveCount(0);
    await page.getByTestId("matrix-inline-remove-pinned").click();
    await expect(log).toHaveText("removed pinned");
    await page.getByTestId("matrix-inline-close-panel").press("Enter");
    await expect(log).toHaveText("closed panel");
    await page.getByRole("button", { name: "Reset tabs" }).click();
    await page.getByTestId("matrix-inline-tab-long").getByRole("tab").click({ button: "middle" });
    await expect(log).toHaveText("closed long");
  });

  test("caller utilities change placement but not internal presentation", async ({ page }) => {
    await openMatrix(page);
    const field = page.getByTestId("matrix-placement-field");
    const box = (await field.boundingBox())!;
    expect(Math.round(box.width), "w-40 sets the field width").toBe(160);
    const fieldStyle = await field.evaluate((node) => {
      const css = getComputedStyle(node);
      return { padding: css.paddingInlineStart, size: css.fontSize };
    });
    expect(fieldStyle.padding, "px-10 cannot restyle the field's padding").not.toBe("40px");
    expect(fieldStyle.size, "text-ui-title cannot retype the field").not.toBe("16px");
    expect(
      Math.round((await page.getByTestId("matrix-placement-select").boundingBox())!.width),
    ).toBe(160);
    expect(
      Math.round((await page.getByTestId("matrix-placement-button").boundingBox())!.width),
    ).toBe(192);
    const segments = page.getByRole("radiogroup", { name: "Placed segments", exact: true });
    expect(await segments.evaluate((node) => getComputedStyle(node).marginInlineStart)).toBe(
      "24px",
    );
  });

  test("a text button without an icon reserves no empty slot and keeps its width while busy", async ({
    page,
  }) => {
    await openMatrix(page);
    const idle = page.getByTestId("matrix-loading-idle");
    const busy = page.getByTestId("matrix-loading-busy");
    const inset = (locator: Locator) =>
      locator.evaluate((node) => {
        const label = [...node.querySelectorAll("span")].find(
          (span) => span.textContent === "Delete",
        )!;
        const padding = parseFloat(getComputedStyle(node).paddingInlineStart);
        return label.getBoundingClientRect().left - node.getBoundingClientRect().left - padding;
      });
    // Only the padding precedes the label: no reserved 14-16px icon slot.
    expect(await inset(idle)).toBeLessThan(2);
    // Pending keeps the same width and the label in the accessible name.
    expect(Math.round((await busy.boundingBox())!.width)).toBe(
      Math.round((await idle.boundingBox())!.width),
    );
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(busy).toHaveAccessibleName("Delete");
    // With a start icon, the icon and the spinner share one slot.
    await expect(
      page.getByTestId("matrix-loading-start-icon").locator("[aria-hidden='true'] svg"),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------
// The one control reference (ControlSpecimen) in matrix mode (?matrix). FIXTURE evidence only:
// keyboard, density and theme are exercised on the same real components the product imports.
// ---------------------------------------------------------------------------------------
// Visible boxes that run past the reference's content edge. Boxes inside a scrolling or clipping ancestor
// (segmented track, visually hidden data table) own their overflow, absolutely positioned hidden inputs are
// not content, and 12px of slack covers the intentional negative-margin bleeds of the calendar, chart
// scroller and usage legend (focus-ring room).
async function overflowingFamilies(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-shared-matrix]")!;
    const edge =
      root.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(root).paddingRight);
    return [...root.querySelectorAll<HTMLElement>("*")]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        if (box.width <= 2 || box.right <= edge + 12) return false;
        for (let up = node.parentElement; up && up !== root; up = up.parentElement) {
          const parent = getComputedStyle(up);
          if (
            parent.overflowX !== "visible" ||
            parent.clip !== "auto" ||
            parent.visibility === "hidden"
          )
            return false;
        }
        const css = getComputedStyle(node);
        return css.visibility !== "hidden" && css.position !== "absolute";
      })
      .slice(0, 8)
      .map(
        (node) =>
          `${node.closest("[data-specimen-family]")?.getAttribute("data-specimen-family")} <- ${node.tagName}.${String(node.className).slice(0, 50)} (${Math.round(node.getBoundingClientRect().width)}px)`,
      );
  });
}

test.describe("control reference state matrix", () => {
  const openReference = async (page: Page, theme: "light" | "dark" = "dark") => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/shared-ui/arc-controls.html?matrix&theme=${theme}`);
    await expect(page.locator("[data-shared-matrix]")).toBeVisible();
    await expect(page.getByRole("group", { name: "State matrix", exact: true })).toBeVisible();
  };

  test("mounts every family in the single reference without horizontal overflow", async ({
    page,
  }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["dark", "light"] as const) {
        await openReference(page, theme);
        expect(await page.locator("[data-specimen-family]").count()).toBeGreaterThanOrEqual(18);
        const overflowing = await overflowingFamilies(page);
        expect(overflowing, `${theme} ${width}px`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  });

  // One walk per theme, each with its own deadline: one evaluate and one Tab per stop make a
  // single WebKit walk take 40-80 s, so both walks in one test exceeded 120 s on a slow runner.
  for (const theme of ["dark", "light"] as const) {
    test(`keyboard Tab visits controls in order with exactly one focus ring owner per stop (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openReference(page, theme);
      await page.locator("[data-specimen-family] button:not([disabled])").first().focus();
      const doubled: string[] = [];
      let stops = 0;
      for (let step = 0; step < 200; step++) {
        const stop = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          const root = document.querySelector("[data-shared-matrix]");
          if (!active || !root || !root.contains(active)) return null;
          const draws = (node: HTMLElement) => {
            const css = getComputedStyle(node);
            return (
              css.outlineStyle !== "none" &&
              Number.parseFloat(css.outlineWidth) > 0 &&
              css.outlineColor !== "rgba(0, 0, 0, 0)"
            );
          };
          // A visually hidden native input hands its keyboard focus to the visible control that wraps it.
          const box = active.getBoundingClientRect();
          const hidden =
            Number.parseFloat(getComputedStyle(active).opacity) === 0 ||
            box.width <= 2 ||
            box.height <= 2;
          const owners: string[] = [];
          if (!hidden && draws(active)) owners.push(active.tagName);
          for (let node = active.parentElement; node && node !== root; node = node.parentElement)
            if (draws(node)) owners.push(`${node.tagName}.${node.className}`);
          const family = active
            .closest("[data-specimen-family]")
            ?.getAttribute("data-specimen-family");
          const label =
            active.getAttribute("aria-label") ?? active.textContent?.trim().slice(0, 24);
          const revisited = active.hasAttribute("data-tab-visited");
          active.setAttribute("data-tab-visited", "");
          return { revisited, owners, where: `${family} / ${active.tagName}[${label}]` };
        });
        if (!stop || stop.revisited) break;
        stops++;
        if (stop.owners.length > 1) doubled.push(`${stop.where}: ${stop.owners.join(" + ")}`);
        await page.keyboard.press("Tab");
      }
      expect(stops, `${theme} tab stops`).toBeGreaterThan(30);
      expect(doubled, `${theme} stops drawing more than one focus ring`).toEqual([]);
    });
  }

  test("keyboard operates the selection families", async ({ page }) => {
    await openReference(page);
    const family = page.locator('[data-specimen-family="Segmented / radio / checkbox / switch"]');
    const segments = family.getByRole("radiogroup", { name: "Layout", exact: true });
    const first = segments.getByRole("radio").first();
    await first.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await first.press("ArrowRight");
    await expect(segments.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true");
    const checkbox = family.getByRole("checkbox", { name: "Selected", exact: true });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).not.toBeChecked();
    await expect(family.getByRole("checkbox", { name: "Unavailable", exact: true })).toBeDisabled();
    const enabled = family.getByRole("switch", { name: "Enabled", exact: true });
    await expect(enabled).toHaveAttribute("aria-checked", "false");
    await expect(family.getByRole("switch", { name: "Unavailable", exact: true })).toBeDisabled();
  });

  test("density changes control geometry and keeps the matrix inside its container", async ({
    page,
  }) => {
    for (const theme of ["dark", "light"] as const) {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openReference(page, theme);
        for (const density of ["compact", "comfortable", "touch"]) {
          await page.evaluate((density) => {
            document.documentElement.dataset.controlDensity = density;
          }, density);
          const save = page
            .locator('[data-specimen-family="Button"] [data-specimen-state^="normal"] button')
            .first();
          const minimum = density === "touch" ? 44 : density === "comfortable" ? 32 : 28;
          expect(
            (await save.boundingBox())!.height,
            `${theme} ${width}px ${density}`,
          ).toBeGreaterThanOrEqual(minimum);
          const overflowing = await overflowingFamilies(page);
          expect(overflowing, `${theme} ${width}px ${density}`).toEqual([]);
        }
      }
    }
  });

  test("grouped bar chart draws one patterned bar per series in each category with a series table", async ({
    page,
  }) => {
    await openReference(page);
    const single = page.locator('[data-specimen-state="bars (single series)"]');
    await expect(single.locator("path[data-key]")).toHaveCount(5);
    await expect(single.locator("path[data-lane]")).toHaveCount(0);

    const cell = page.locator('[data-specimen-state="bars (grouped series + legend)"]');
    await expect(cell.locator("path[data-key]")).toHaveCount(12);
    for (const lane of [0, 1, 2])
      await expect(cell.locator(`path[data-lane="${lane}"]`)).toHaveCount(4);
    // The first series stays solid; later series carry a surface pattern beyond colour.
    await expect(cell.locator("path[data-lane='0']").first()).toHaveAttribute(
      "data-pattern",
      "solid",
    );
    await expect(cell.locator("path[data-lane='1']").first()).toHaveAttribute(
      "data-pattern",
      "diagonal",
    );
    await expect(cell.locator("path[data-lane='2']").first()).toHaveAttribute(
      "data-pattern",
      "dots",
    );
    await expect(cell.locator("path[data-pattern-for]")).toHaveCount(8);
    // The bars of one category sit side by side without overlapping.
    const boxes = await Promise.all(
      [0, 1, 2].map((lane) => cell.locator(`path[data-key="group-3:${lane}"]`).boundingBox()),
    );
    expect(boxes.every(Boolean)).toBe(true);
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 0.5);
    expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 0.5);
    // The legend names every series; the screen-reader table has one row per category and series.
    await expect(cell.getByRole("list", { name: "Series" }).getByRole("listitem")).toHaveCount(3);
    const table = cell.locator("table");
    await expect(table.locator("thead th")).toHaveText(["Time", "Preview", "Series"]);
    await expect(table.locator("tbody tr")).toHaveCount(12);
    await expect(table.locator("tbody tr").nth(4).locator("td").nth(1)).toHaveText("Selected");
    // No single average line crosses grouped bars.
    await expect(cell.locator("line[class*='mean']")).toHaveCount(0);
    await cell.screenshot({ path: "temp/verification/2026-10-29-ui-l2/grouped-bars-dark.png" });
    await openReference(page, "light");
    await page
      .locator('[data-specimen-state="bars (grouped series + legend)"]')
      .screenshot({ path: "temp/verification/2026-10-29-ui-l2/grouped-bars-light.png" });
  });
});

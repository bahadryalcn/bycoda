import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bycoda.language", "en");
    localStorage.setItem("bycoda.diffLayout", "auto");
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No native host in responsive fixture: ${command}`);
        },
      },
    });
  });
});

test("workspace resize fits all panes and retains mounted drafts and ratios", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/workspace-layout.html");
  await expect(page.getByRole("separator")).toHaveCount(2);
  const field = page.getByRole("textbox").first();
  await field.fill("Draft stays while Git sidebar expands");
  const original = await page.getByTestId("layout").textContent();
  for (const width of [1440, 980, 640, 420, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(field).toHaveValue("Draft stays while Git sidebar expands");
    await expect(page.getByTestId("layout")).toHaveText(original!);
    const panes = await page.locator("[data-pane-id]").evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetWidth > 0)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
    );
    expect(panes.length).toBeGreaterThan(0);
    for (const pane of panes) {
      expect(pane.left).toBeGreaterThanOrEqual(-1);
      expect(pane.right).toBeLessThanOrEqual(width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 640) await page.screenshot({ path: info.outputPath("workspace-narrow.png") });
  }
});

test("automatic diff follows available width and preserves edits, focus and undo", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/editor-selection.html?search=split");
  const layout = page.getByRole("button", { name: /^Diff view:/ });
  const choose = async (label: string) => {
    await layout.click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  await choose("Automatic");
  await expect(page.locator(".cm-mergeView")).toHaveCount(1);
  const content = () =>
    page.locator('.cm-content[contenteditable="true"]:not([aria-readonly="true"])');
  await content().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n// retained resize draft");
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    await page.setViewportSize({ width: 720, height: 900 });
    await expect(page.locator(".cm-mergeView")).toHaveCount(0);
    await expect(content()).toContainText("retained resize draft");
    await expect(content()).toBeFocused();
    await page.screenshot({ path: info.outputPath(`diff-inline-${light ? "light" : "dark"}.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".cm-mergeView")).toHaveCount(1);
    await expect(content()).toContainText("retained resize draft");
    await expect(content()).toBeFocused();
  }
  await page.keyboard.press("Control+z");
  await expect(content()).not.toContainText("retained resize draft");
  const draft = page.getByRole("textbox", { name: "Chat draft" });
  await draft.fill("Keep focus here");
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(page.locator(".cm-mergeView")).toHaveCount(0);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("Keep focus here");
  await choose("Side-by-side view");
  await expect(page.locator(".cm-mergeView")).toHaveCount(1);
  await choose("Inline");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".cm-mergeView")).toHaveCount(0);
});

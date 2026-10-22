import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No native host in layout fixture: ${command}`);
        },
      },
    });
  });
  await page.goto("/tests/browser/workspace-layout.html");
  await expect(page.getByRole("separator")).toHaveCount(2);
});

test("pane maximization preserves ratios and mounted drafts, and restores the split", async ({
  page,
}, testInfo) => {
  const layout = page.getByTestId("layout");
  const original = await layout.textContent();
  const maximizeBox = (await page
    .getByRole("button", { name: "Maximize panel", exact: true })
    .first()
    .boundingBox())!;
  const closeBox = (await page
    .getByRole("button", { name: "Close pane", exact: true })
    .first()
    .boundingBox())!;
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(maximizeBox.x);
  const field = page.getByRole("textbox").first();
  await field.fill("Draft before maximizing");
  await page.getByRole("button", { name: "Maximize panel", exact: true }).first().click();
  await expect(page.getByRole("separator")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(field).toHaveValue("Draft before maximizing");
  expect(await layout.textContent()).toBe(original);
  await page.getByRole("button", { name: "Restore panel layout", exact: true }).click();
  await expect(page.getByRole("separator")).toHaveCount(2);
  expect(await layout.textContent()).toBe(original);
  await expect(field).toHaveValue("Draft before maximizing");
  await page.screenshot({ path: testInfo.outputPath("restored-layout.png") });
});

test("sashes resize with keyboard and pointer, and Escape cancels a drag", async ({ page }) => {
  const separator = page.getByRole("separator", { name: "Resize columns" }).first();
  const layout = page.getByTestId("layout");
  const original = await layout.textContent();
  await separator.focus();
  await separator.press("ArrowRight");
  await expect(layout).not.toHaveText(original!);
  await separator.press("Enter");
  await expect(layout).toHaveText(original!);
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + box.height / 2);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(layout).toHaveText(original!);
  expect(await page.evaluate(() => document.body.style.cursor)).toBe("");
});

test("group tab insertion previews exact order and clears on cancel", async ({ page }) => {
  await page.getByRole("button", { name: "Group Gamma with Alpha" }).click();
  const gamma = page.getByRole("tab", { name: "Gamma", exact: true });
  const alpha = page.getByRole("tab", { name: "Alpha", exact: true });
  const from = (await gamma.boundingBox())!;
  const to = (await alpha.boundingBox())!;
  const layout = page.getByTestId("layout");
  const original = await layout.textContent();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 6 });
  await expect(page.locator('[data-pane-tab-drop="before"]:visible')).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-pane-tab-drop]")).toHaveCount(0);
  await expect(layout).toHaveText(original!);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(
    await page.getByRole("tablist", { name: "Pane sessions" }).getByRole("tab").allTextContents(),
  ).toEqual(["Gamma", "Alpha"]);
});

test("a short narrow chat keeps a long draft and its controls scrollable", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Maximize panel", exact: true }).first().click();
  await page.setViewportSize({ width: 360, height: 280 });
  const field = page.getByRole("textbox").first();
  await field.fill(Array.from({ length: 25 }, (_, i) => `Draft line ${i}`).join("\n"));
  expect(await field.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.getByRole("button", { name: "Send", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("chat-360x280.png") });
});

test("saved file tabs preview insertion into another group and collapse the empty editor", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-layout.html?files");
  const alpha = page.getByRole("tab", { name: "alpha.ts", exact: true });
  const beta = page.getByRole("tab", { name: "beta.ts", exact: true });
  await expect(alpha).toBeVisible();
  const from = (await alpha.boundingBox())!;
  const to = (await beta.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator('[data-file-tab-drop="before"]:visible')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole("separator")).toHaveCount(0);
  expect(
    await page.getByRole("tablist", { name: "Open files" }).getByRole("tab").allTextContents(),
  ).toEqual(["alpha.ts", "beta.ts"]);
  expect(
    JSON.parse((await page.getByTestId("editors").textContent())!).map(
      (pane: { files: unknown[] }) => pane.files.length,
    ),
  ).toEqual([2]);
});

test("detached window chrome keeps layout, return and native controls reachable at 320px", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/workspace-layout.html?chrome");
  await page.setViewportSize({ width: 320, height: 280 });
  const header = page.locator("header.bycoda-titlebar");
  // Detached windows carry the native window controls in the working bar below the title bar.
  const workingBar = page.locator("[data-detached-working-bar]");
  for (const name of ["Minimize window", "Maximize window", "Close window"])
    await expect(workingBar.getByRole("button", { name, exact: true })).toBeInViewport();
  await expect(
    header.getByRole("button", { name: "Return to main window", exact: true }),
  ).toBeInViewport();
  await expect(header.locator("[data-layout-control] button")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("detached-chrome-320x280.png") });
});

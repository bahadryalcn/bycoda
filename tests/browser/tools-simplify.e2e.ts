import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/host-tools.html?detached=1";
const captures = "temp/verification/2026-10-26-tools-simplify";
const tools = [
  { name: "Devices", id: "devices" },
  { name: "Host browser", id: "browser" },
  { name: "Development servers", id: "servers" },
  { name: "Logs", id: "logs" },
  { name: "Resource usage", id: "resources" },
] as const;

async function selectTool(page: Page, name: string) {
  await page.getByRole("button", { name: "Conversation tool selection", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(page.getByRole("tabpanel", { name, exact: true })).toBeVisible();
  await expect(page.locator(".host-tools-current-tool")).toHaveText(name);
}

async function methodCount(page: Page, method: string) {
  return page.evaluate((value) => {
    const calls = (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls;
    return calls.filter((call) => call.method === value).length;
  }, method);
}

async function expectCompactHeader(page: Page) {
  const bar = page.locator(".host-tools-topbar");
  const picker = bar.getByRole("button", { name: "Conversation tool selection", exact: true });
  const barBox = (await bar.boundingBox())!;
  const pickerBox = (await picker.boundingBox())!;
  expect(barBox.height).toBeLessThanOrEqual(48);
  expect(
    Math.abs(pickerBox.y + pickerBox.height / 2 - (barBox.y + barBox.height / 2)),
  ).toBeLessThan(2);
  expect(barBox.x + barBox.width - (pickerBox.x + pickerBox.width)).toBeLessThanOrEqual(16);
  expect(pickerBox.x).toBeGreaterThan(barBox.x + barBox.width / 2 - 60);
  const machine = bar.getByRole("button", { name: /^Tool machine:/ });
  if (await machine.isVisible()) {
    const machineBox = (await machine.boundingBox())!;
    expect(machineBox.x).toBeLessThan(pickerBox.x);
    expect(
      Math.abs(machineBox.y + machineBox.height / 2 - (pickerBox.y + pickerBox.height / 2)),
    ).toBeLessThan(2);
  }
  expect(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(
    await page.getByRole("tabpanel").evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
}

async function openBrowser(page: Page) {
  await page
    .getByRole("textbox", { name: "Website address", exact: true })
    .fill("http://localhost:5173");
  await page.getByRole("button", { name: "Open website", exact: true }).click();
  await expect(page.locator(".host-browser-frame")).toBeVisible();
}

for (const theme of ["dark", "light"] as const) {
  for (const width of [360, 480]) {
    test(`all tools keep their content and a single upper-right selector at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}&theme=${theme}`);
      for (const tool of tools) {
        await selectTool(page, tool.name);
        if (tool.id === "devices") {
          await page.getByRole("button", { name: "Boot", exact: true }).click();
          await expect(
            page.getByRole("img", { name: "Current device screen", exact: true }),
          ).toBeVisible();
          await expect(page.locator(".device-panel-setup")).toHaveCount(0);
        } else if (tool.id === "browser") {
          await openBrowser(page);
          await expect(
            page.getByRole("textbox", { name: "Text to type into host browser", exact: true }),
          ).toHaveCount(0);
        } else if (tool.id === "servers") {
          await expect(
            page.getByRole("list", { name: "Development servers", exact: true }),
          ).toBeVisible();
          await expect(page.locator(".dev-server-form")).toHaveCount(0);
        } else if (tool.id === "logs") {
          await expect(page.locator(".runtime-log-row").first()).toBeVisible();
          await expect(page.locator(".runtime-logs-monitor-setup")).toHaveCount(0);
          await expect(
            page.getByRole("region", { name: "Log timeline", exact: true }),
          ).toBeVisible();
        } else {
          expect(await methodCount(page, "resources.read")).toBe(0);
          await page.getByRole("button", { name: "Sample now", exact: true }).click();
          await expect(page.locator(".resource-value").first()).toHaveText("2.4%");
          await expect(
            page.getByRole("img", { name: "bycoda host CPU", exact: true }),
          ).toBeVisible();
        }
        await expectCompactHeader(page);
        await expectNoHorizontalOverflow(page);
        if (width === 480) {
          await page.screenshot({
            path: `${captures}/${theme}-${tool.id}-480.png`,
            animations: "disabled",
          });
        }
      }
    });
  }
}

test("the compact tool menu preserves keyboard navigation and returns focus", async ({ page }) => {
  await page.goto(fixture);
  const picker = page.getByRole("button", { name: "Conversation tool selection", exact: true });
  await picker.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: "Devices", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "Host browser", exact: true })).toBeVisible();
  await expect(picker).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitemradio", { name: "Resource usage", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "Resource usage", exact: true })).toBeVisible();
  await expect(picker).toBeFocused();
  expect(await methodCount(page, "resources.read")).toBe(0);
});

test("log filters and monitor URL drafts remain usable without expanding permanent setup", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Logs");
  await expect(page.locator(".runtime-log-row").first()).toBeVisible();
  const source = page.getByRole("button", { name: /^Log source:/ });
  await source.click();
  await page.getByRole("option", { name: "Demo browser", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(source).toHaveAccessibleName("Log source: Demo browser");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Log filters", exact: true });
  await filters.getByRole("button", { name: "Log level: All levels", exact: true }).click();
  await page.getByRole("option", { name: "ERROR", exact: true }).click();
  await expect(page.locator(".runtime-log-row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Website monitors", exact: true }).click();
  const monitors = page.getByRole("dialog", { name: "Website monitors", exact: true });
  await monitors
    .getByRole("textbox", { name: "Website port or URL", exact: true })
    .fill("http://localhost:3000/unfinished");
  await page.keyboard.press("Escape");
  await expect(monitors).toHaveCount(0);
  await page.getByRole("button", { name: "Website monitors", exact: true }).click();
  await expect(
    monitors.getByRole("textbox", { name: "Website port or URL", exact: true }),
  ).toHaveValue("http://localhost:3000/unfinished");
  expect(await methodCount(page, "runtimeLogs.monitors.start")).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".runtime-log-row")).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
});

test("resource diagnostics sample only on request and keep details out of the chart surface", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Resource usage");
  expect(await methodCount(page, "resources.read")).toBe(0);
  await expect(page.getByText("Logical CPUs", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sample now", exact: true }).click();
  await expect(page.locator(".resource-value").first()).toHaveText("2.4%");
  expect(await methodCount(page, "resources.read")).toBe(2);
  await page.getByRole("button", { name: "Measurement details", exact: true }).click();
  await expect(page.getByText("Logical CPUs", { exact: true })).toBeVisible();
  await expect(page.getByText("Node heap", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Logical CPUs", { exact: true })).toHaveCount(0);
  await expect(page.locator(".resource-value").first()).toHaveText("2.4%");
});

test("opening and editing a server start form preserves its draft without starting or stopping a process", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Development servers");
  await expect(page.getByRole("list", { name: "Development servers", exact: true })).toBeVisible();
  const start = page.getByRole("button", { name: "Start server", exact: true });
  await start.click();
  await page
    .getByRole("textbox", { name: "Server name", exact: true })
    .fill("Review before launch");
  await page
    .getByRole("textbox", { name: "Server command", exact: true })
    .fill("pnpm dev --port 4321");
  await start.click();
  await expect(page.locator(".dev-server-form")).toHaveCount(0);
  await start.click();
  await expect(page.getByRole("textbox", { name: "Server name", exact: true })).toHaveValue(
    "Review before launch",
  );
  await expect(page.getByRole("textbox", { name: "Server command", exact: true })).toHaveValue(
    "pnpm dev --port 4321",
  );
  for (const method of [
    "devServers.start",
    "devServers.stop",
    "devServers.restart",
    "devServers.kill",
  ])
    expect(await methodCount(page, method)).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test("browser URL and preview stay local while view-only mode prevents input", async ({ page }) => {
  await page.goto(fixture);
  await selectTool(page, "Host browser");
  await openBrowser(page);
  await expect(page.getByRole("button", { name: "Release", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select element and add to composer", exact: true }),
  ).toBeDisabled();
  const beforeInput = await methodCount(page, "browser.input");
  await page.locator(".host-browser-frame").click({ position: { x: 40, y: 30 } });
  expect(await methodCount(page, "browser.input")).toBe(beforeInput);
  await page.getByRole("button", { name: "Browser controls and setup", exact: true }).click();
  const controls = page.getByRole("dialog", { name: "Browser controls and setup", exact: true });
  await expect(
    controls.getByRole("textbox", { name: "Text to type into host browser", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(controls).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Website address", exact: true })).toHaveValue(
    "http://localhost:5173",
  );
  await expect(page.locator(".host-browser-frame")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("all tool selectors stay operable beside placement and close controls in a narrow dock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 686, height: 900 });
  await page.goto("/tests/browser/host-tools.html");
  await page.addStyleTag({ content: "#root { height: 100dvh; }" });
  await page.evaluate(() =>
    (
      window as unknown as {
        hostToolsUiApi: (action: string, input: Record<string, unknown>) => Promise<unknown>;
      }
    ).hostToolsUiApi("ui.tools.open", { tab: "devices", placement: "right" }),
  );
  const dock = page.locator(".tools-workspace-dock");
  const picker = dock.getByRole("button", { name: "Conversation tool selection", exact: true });
  for (const tool of tools) {
    await picker.click();
    await page.getByRole("menuitemradio", { name: tool.name, exact: true }).click();
    await expect(dock.getByRole("tabpanel", { name: tool.name, exact: true })).toBeVisible();
    await expect(picker).toContainText(tool.name);
    const bar = dock.locator(".host-tools-topbar");
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(48);
    expect(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await expect(dock.getByRole("button", { name: "Close panel", exact: true })).toBeVisible();
  }
  await page.screenshot({ path: `${captures}/narrow-dock.png` });
  await dock.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(dock).toHaveCount(0);
});

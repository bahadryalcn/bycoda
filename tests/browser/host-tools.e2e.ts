import { test, expect, type Page, type Locator } from "@playwright/test";
const fixture = "/tests/browser/host-tools.html";
const captures = "temp/verification/2026-10-12-tools-usability/browser";

async function selectTool(page: Page, name: string, scope: Page | Locator = page) {
  await expect(scope.locator(".host-tools-topbar")).toBeVisible();
  const tab = scope.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) {
    await tab.click();
    return;
  }
  const menu = scope.getByRole("button", {
    name: /^(Conversation tool selection|Konuşma aracı seçimi)$/,
  });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    return;
  }
  await scope.locator(".host-tools-compact-selector").getByRole("button").click();
  await page.getByRole("option", { name, exact: true }).click();
}
test("tools share a compact responsive top bar", async ({ page }) => {
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${fixture}?detached=1`);
    await selectTool(page, "Host browser");
    const bar = page.locator(".host-tools-topbar");
    await expect(bar.getByRole("button", { name: /^Tool machine:/ })).toBeVisible();
    expect(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    {
      const boxes = await Promise.all([
        bar.getByRole("button", { name: "Conversation tool selection", exact: true }).boundingBox(),
        bar.locator(".host-tools-machine").boundingBox(),
      ]);
      const centers = boxes.map((box) => box!.y + box!.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
      expect((await bar.boundingBox())!.height).toBeLessThan(52);
      expect(boxes[0]!.x).toBeGreaterThan(boxes[1]!.x);
    }
    await page.screenshot({ path: `temp/verification/2026-10-15-tools-topbar/${width}.png` });
  }
});
test("device preview uses the dock height with compact controls", async ({ page }) => {
  for (const width of [390, 520, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 988 });
    await page.goto(`${fixture}?detached=1&lang=tr`);
    await selectTool(page, "Cihazlar");
    await page.getByRole("button", { name: "Önyükleme", exact: true }).click();
    const image = page.getByRole("img", { name: "Geçerli cihaz ekranı" });
    await expect(image).toBeVisible();
    const preview = page.locator(".device-panel-stage");
    const bounds = (await preview.boundingBox())!;
    expect(bounds.height).toBeGreaterThan(988 * 0.5);
    await expect(page.locator(".device-panel-setup")).toHaveCount(0);
    await page.getByRole("button", { name: "Cihaz seçenekleri", exact: true }).click();
    await page.getByRole("button", { name: "Kurulum ve erişim", exact: true }).click();
    await expect(page.locator(".device-panel-setup > summary")).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("switch", { name: "Cihaz kontrolüne izin ver" })).not.toBeChecked();
    expect(
      await page.getByRole("tabpanel").evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    const ratio = await image.evaluate((node: HTMLImageElement) => {
      const rect = node.getBoundingClientRect();
      return {
        displayed: rect.width / rect.height,
        original: node.naturalWidth / node.naturalHeight,
      };
    });
    expect(ratio.displayed).toBeCloseTo(ratio.original, 2);
    await page.screenshot({
      path: `temp/verification/2026-10-13-device-panel/device-panel-${width}.png`,
      animations: "disabled",
    });
  }
});
for (const action of ["Process details", "Stop", "Restart"]) {
  test(`reveals ${action} controls in a compact server panel`, async ({ page }) => {
    await page.setViewportSize({ width: 726, height: 660 });
    await page.goto(fixture);
    await selectTool(page, "Development servers");
    const server = page.getByRole("article", { name: "Demo dev server", exact: true });
    await server.getByText("Process and controls", { exact: true }).click();
    await server.getByRole("button", { name: action, exact: true }).click();
    const details = page.getByRole("region", { name: "Selected process details" });
    await expect(details).toBeFocused();
    await expect(details).toBeInViewport();
    expect(
      await page.evaluate(() =>
        (window as any).hostToolCalls.some((call: { method: string }) =>
          ["devServers.stop", "devServers.kill", "devServers.restart"].includes(call.method),
        ),
      ),
    ).toBe(false);
  });
}

test("direct UI API opens devices on the right, selects a Mac, moves and closes only its conversation panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture);
  const api = (
    action: string,
    input: Record<string, unknown> = {},
    context?: { cwd: string; sessionId: string; title: string },
  ) =>
    page.evaluate(
      ({ action, input, context }) => (window as any).hostToolsUiApi(action, input, context),
      { action, input, context },
    );
  const opened = await api("ui.tools.open", {
    tab: "devices",
    placement: "right",
    machineId: "fixture-mac",
  });
  expect(opened).toMatchObject({
    open: true,
    placement: "right",
    panels: [{ tab: "devices", machine: "machine:fixture-mac", mounted: true }],
  });
  const dock = page.locator(".tools-workspace-dock");
  await dock.getByRole("button", { name: "Conversation tool selection", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "Devices", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tools-workspace")).toHaveAttribute("data-placement", "right");
  await expect(dock.getByRole("button", { name: /Fixture MacBook/ }).first()).toBeVisible();
  await api("ui.tools.open", { tab: "logs" });
  await expect(dock.getByRole("tabpanel", { name: "Logs", exact: true })).toBeVisible();
  expect((await api("ui.tools.status")).panels).toHaveLength(1);
  const foreign = {
    cwd: "G:/demo/foreign",
    sessionId: "foreign-session",
    title: "Other conversation",
  };
  await api("ui.tools.open", { placement: "right" }, foreign);
  await api("ui.tools.place", { placement: "left" });
  await expect(page.locator(".tools-workspace")).toHaveAttribute("data-placement", "left");
  await api("ui.tools.close");
  await expect(page.locator(".tools-workspace-pane")).toHaveCount(1);
  expect((await api("ui.tools.status", {}, foreign)).open).toBe(true);
  expect((await api("ui.tools.status")).open).toBe(false);
  await expect(api("ui.tools.open", { machineId: "missing-machine" })).rejects.toThrow(
    "no longer connected",
  );
  expect((await api("ui.tools.status")).open).toBe(false);
});

test("shows neutral log canvas, source prefixes and six distinct severity colors", async ({
  page,
}) => {
  await page.goto(fixture + "?log-levels=1");
  await selectTool(page, "Logs");
  const timeline = page.locator(".runtime-logs-timeline");
  await expect(timeline.locator('[data-level="success"]')).toHaveCount(1);
  for (const kind of ["server", "browser"]) {
    const row = timeline.locator(`.runtime-log-row[data-source="${kind}"]`).first();
    await expect(row.locator(".runtime-log-meta > :first-child")).toHaveText(
      `[${kind.toUpperCase()}]`,
    );
  }
  const colors = await timeline.evaluate((area) =>
    ["error", "warn", "info", "debug", "http", "success"].map(
      (level) =>
        getComputedStyle(area.querySelector(`[data-level="${level}"] .runtime-log-level`)!).color,
    ),
  );
  expect(new Set(colors).size).toBe(6);
  const neutral = await timeline.evaluate((area) => getComputedStyle(area).backgroundColor);
  const channels = (neutral.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  expect(channels).toHaveLength(3);
  expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(8);
  await page.screenshot({ path: "temp/verification/2026-10-13-logs-simplify/log-colors.png" });
  await page.getByRole("button", { name: "HTTP", exact: true }).click();
  await expect(timeline.locator(".runtime-log-row")).toHaveCount(1);
  await expect(timeline.getByText("GET /dashboard 200 in 12ms", { exact: true })).toBeVisible();
});

test("resource charts show empty and sampled states without overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(fixture);
  await selectTool(page, "Resource usage");
  const panel = page.getByRole("region", { name: "Host resource diagnostics", exact: true });
  await expect(panel.getByText("No samples yet", { exact: true })).toBeVisible();
  await page.screenshot({ path: "temp/verification/2026-10-13-resource-usage/empty.png" });
  await panel.getByRole("button", { name: "Sample now", exact: true }).click();
  await expect(panel.locator(".resource-value").first()).toHaveText("2.4%");
  await expect(panel.getByRole("meter", { name: "Computer memory" })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await expect(panel.locator(".resource-chart-point")).toHaveCount(2);
  await expect(panel.locator(".resource-history-caption")).toContainText("1 / 60");
  await expect(panel.getByRole("button", { name: "Measurement details" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({ path: "temp/verification/2026-10-13-resource-usage/sampled.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole("button", { name: "Sample now", exact: true })).toBeVisible();
  const overflow = await panel.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({
    path: "temp/verification/2026-10-13-resource-usage/narrow.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

async function selectOption(page: Page, scope: Page | Locator, label: string, option: string) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("starts live logs and moves a separate panel without covering the workspace", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Logs");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const reads = await page.evaluate(
    () =>
      (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls.filter(
        (call) => call.method === "runtimeLogs.read",
      ).length,
  );
  expect(reads).toBeGreaterThan(0);
  const placement = page.getByRole("button", { name: "Panel placement", exact: true });
  await placement.click();
  await expect(page.getByRole("dialog", { name: "Panel placement", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(placement).toBeFocused();
  await placement.click();
  await page.getByRole("button", { name: "Separate Logs panel", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Tool panels" });
  await expect(dock).toBeVisible();
  await expect(dock.locator(".tools-workspace-toolbar")).toHaveCount(1);
  await expect(dock.locator(".host-tools-heading")).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Close panels", exact: true })).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Open in new window", exact: true })).toHaveText(
    "",
  );
  for (const placement of ["left", "top", "right", "bottom"]) {
    const trigger = dock.getByRole("button", { name: /^Placement:/ });
    await trigger.click();
    await page
      .getByRole("dialog", { name: "Placement", exact: true })
      .getByRole("button", {
        name: `Dock ${placement[0].toUpperCase()}${placement.slice(1)}`,
        exact: true,
      })
      .click();
    await expect(page.locator(".tools-workspace")).toHaveAttribute("data-placement", placement);
  }
  const dockPlacement = dock.getByRole("button", { name: /^Placement:/ });
  await dockPlacement.click();
  await page.keyboard.press("Escape");
  await expect(dockPlacement).toBeFocused();
  await expect(
    dock.getByText("Demo development server ready on port 5173", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "temp/verification/2026-10-13-tools-toolbar/layout-wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "temp/verification/2026-10-13-tools-toolbar/layout-narrow.png" });
  await dock.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await page.screenshot({
    path: "temp/verification/2026-10-12-tools-usability/browser/layouts/logs-narrow.png",
  });
});

test("inspects unified logs, prepares an agent draft and clears a scoped view", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture);
  await selectTool(page, "Logs");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "Runtime logs", exact: true });
  const timeline = page.getByRole("region", { name: "Log timeline", exact: true });
  await expect(timeline.getByText("Workspace loaded", { exact: true })).toBeVisible();
  await expect(
    timeline.getByText("Demo development server ready on port 5173", { exact: true }),
  ).toBeVisible();
  await expect(timeline.getByText("Failed to fetch project activity", { exact: true })).toHaveCount(
    1,
  );
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await panel.getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Log filters", exact: true });
  await filters.getByRole("button", { name: "Log level: All levels", exact: true }).click();
  await page.getByRole("option", { name: "ERROR", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(timeline.getByText("Workspace loaded", { exact: true })).toHaveCount(0);
  await timeline.locator("details").first().getByText("Details", { exact: true }).click();
  await expect(timeline.getByText("Stack trace", { exact: true })).toBeVisible();
  await timeline.getByRole("checkbox").first().check();
  await panel.getByRole("button", { name: "Add to conversation", exact: true }).click();
  const draft = await page.evaluate(
    () => (window as unknown as { hostLogsDraft: string }).hostLogsDraft,
  );
  expect(draft).toContain("Failed to fetch project activity");
  expect(draft).toMatch(/untrusted/i);
  await panel.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clear view", exact: true }).click();
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(timeline.getByText("Failed to fetch project activity", { exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await selectOption(page, page, "Tool machine", "Fixture MacBook");
  await expect(
    timeline.getByText("MacBook development server ready on port 5173", { exact: true }),
  ).toBeVisible();
  await expect(
    timeline.getByText("Demo development server ready on port 5173", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keeps the log workspace within narrow and wide layouts", async ({ page }) => {
  await page.goto(fixture);
  await selectTool(page, "Logs");
  await expect(
    page
      .getByRole("region", { name: "Log timeline", exact: true })
      .getByText("Workspace loaded", { exact: true }),
  ).toBeVisible();
  for (const width of [1100, 393]) {
    await page.setViewportSize({ width, height: 820 });
    await page.screenshot({
      path: `temp/verification/2026-10-12-tools-usability/browser/layouts/loaded-${width}.png`,
    });
    await expect(
      page.getByRole("button", { name: "Add to conversation", exact: true }),
    ).toBeVisible();
    const logBox = await page.locator(".runtime-logs-timeline").boundingBox();
    expect(logBox!.height).toBeGreaterThan(120);
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeInViewport();
    await expect(page.getByLabel("Website port or URL")).toBeInViewport();
    await page
      .getByRole("button", { name: "Add to conversation", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Add to conversation", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: `temp/verification/2026-10-12-tools-usability/browser/logs/logs-${width}.png`,
      fullPage: true,
    });
  }
});

test("selects local and remote tool machines while clearing the previous browser controls", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Host browser");
  const machine = page.getByRole("button", { name: /^Tool machine:/ });
  await expect(machine).toHaveAccessibleName("Tool machine: Project host · This computer");
  await selectOption(page, page, "Tool machine", "This computer");
  await page.getByRole("button", { name: "Open website", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "Shared host browser screenshot; click to interact when controlling",
    }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Live view", exact: true }).check();
  await selectOption(page, page, "Tool machine", "Fixture MacBook");
  await expect(page.getByRole("button", { name: "Open website", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("img", {
      name: "Shared host browser screenshot; click to interact when controlling",
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Live view", exact: true })).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Shared host browser · Fixture MacBook", exact: true }),
  ).toBeVisible();
  await selectTool(page, "Resource usage");
  await page.getByRole("button", { name: "Sample now", exact: true }).click();
  const routing = await page.evaluate(() =>
    (
      window as unknown as {
        hostToolCalls: {
          method: string;
          target?: { kind: string; machineId?: string };
          params: Record<string, unknown>;
        }[];
      }
    ).hostToolCalls
      .filter((call) => call.target)
      .map(({ method, target, params }) => ({ method, target, params })),
  );
  expect(
    routing.some((call) => call.method === "browser.open" && call.target?.kind === "local"),
  ).toBe(true);
  expect(
    routing.some(
      (call) => call.method === "resources.read" && call.target?.machineId === "fixture-mac",
    ),
  ).toBe(true);
  expect(
    routing.every((call) => !("projectId" in call.params) && !("sessionId" in call.params)),
  ).toBe(true);
  await selectTool(page, "Development servers");
  await expect(machine).toHaveCount(0);
});

test("shows grouped server ports, reviews impact and offers force after graceful stop", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Development servers");
  const list = page.getByRole("list", { name: "Development servers", exact: true });
  const server = list.getByRole("listitem", { name: "Demo dev server", exact: true });
  await expect(server.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  const selection = page.getByRole("complementary", { name: "Demo dev server", exact: true });
  await selection.getByRole("button", { name: /^Address:/ }).click();
  await expect(
    page.getByRole("option", { name: "http://127.0.0.1:5173", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: "http://[::1]:5173", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "http://[::1]:5173", exact: true }).click();
  await expect(selection.getByRole("button", { name: /^Address:/ })).toContainText(
    "http://[::1]:5173",
  );
  await selection.getByRole("button", { name: "Stop", exact: true }).click();
  const details = page.getByRole("region", { name: "Selected process details" });
  await expect(details.getByText("5173, 5174", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls.filter(
        (call) => call.method === "devServers.stop" || call.method === "devServers.kill",
      ),
    ),
  ).toHaveLength(0);
  await details.getByRole("button", { name: "Confirm graceful stop" }).click();
  await expect(details.getByRole("button", { name: "Confirm force terminate" })).toBeVisible();
  await details.getByRole("button", { name: "Confirm force terminate" }).click();
  await expect(server.getByText("Stopped", { exact: true })).toBeVisible();
  const signals = await page.evaluate(() =>
    (
      window as unknown as { hostToolCalls: { method: string; params: unknown }[] }
    ).hostToolCalls.filter(
      (call) => call.method === "devServers.stop" || call.method === "devServers.kill",
    ),
  );
  expect(signals.map((call) => call.method)).toEqual(["devServers.stop", "devServers.kill"]);
  expect(signals[1].params).toMatchObject({
    id: "fixture-dev-server",
    identity: { pid: 90001, startedAt: "fixture-birth" },
    tree: true,
  });
});

test("shows unavailable external logs and asks for explicit restart information", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Development servers");
  const external = page.getByRole("article", { name: "External server", exact: true });
  await expect(external.getByText("Project association uncertain")).toBeVisible();
  await external.getByText("Process and controls", { exact: true }).click();
  await external.getByRole("button", { name: "Restart", exact: true }).click();
  const details = page.getByRole("region", { name: "Selected process details" });
  await expect(details.getByRole("button", { name: "Confirm restart" })).toBeDisabled();
  await details.getByRole("button", { name: "Show logs" }).click();
  await expect(details.getByText("Logs are unavailable for this external process.")).toBeVisible();
  await expect(page.getByLabel("Restart command")).toHaveValue("");
  await expect(page.getByLabel("Restart working directory")).toHaveValue("");
});

test("development server tools fit wide and narrow terminal docks", async ({ page }) => {
  for (const width of [1000, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture);
    await selectTool(page, "Development servers");
    await expect(
      page.getByRole("listitem", { name: "Demo dev server", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `temp/verification/2026-10-12-tools-usability/browser/servers/tools-${width}.png`,
      fullPage: true,
    });
  }
});
test("opens the browser and sends input using its control lease", async ({ page }) => {
  await page.goto(fixture);
  await selectTool(page, "Host browser");
  await page.getByRole("button", { name: "Open website", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "Shared host browser screenshot; click to interact when controlling",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Browser controls and setup", exact: true }).click();
  await page.getByLabel("Text to type into host browser").fill("Example text");
  await page.getByRole("button", { name: "Type text" }).click();
  await expect(page.getByLabel("Text to type into host browser")).toHaveValue("");
  const inputs = await page.evaluate(() =>
    (
      window as unknown as { hostToolCalls: { method: string; params: Record<string, unknown> }[] }
    ).hostToolCalls.filter((call) => call.method === "browser.input"),
  );
  expect(inputs).toEqual([
    {
      cwd: "G:/demo/example",
      method: "browser.input",
      params: { kind: "text", text: "Example text", leaseId: "fixture-lease" },
    },
  ]);
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.getByRole("button", { name: "Type text" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh frame" })).toBeEnabled();
});
test("starts, boots and captures a device and stops live viewing on tab change", async ({
  page,
}) => {
  await page.goto(fixture);
  await selectTool(page, "Devices");
  await expect(
    page.getByRole("button", {
      name: "Selected device: Demo Android emulator",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls.filter(
          (call) => call.method === "devices.start",
        ).length,
    ),
  ).toBe(1);
  await expect(
    page.getByRole("switch", { name: "Allow device control", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Device options", exact: true }).click();
  await page.getByRole("button", { name: "Add device to conversation", exact: true }).click();
  await expect(page.getByText("Device added to draft.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => (window as unknown as { hostToolDraft: string }).hostToolDraft),
  ).toContain("demo-emulator");
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Boot", exact: true }).click();
  await expect(page.getByRole("img", { name: "Current device screen" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Live view" })).toBeChecked();
  await page.getByRole("switch", { name: "Allow device control", exact: true }).check();
  await expect(page.getByText("App name or bundle ID", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Choose app to open", exact: true }).click();
  await expect(page.getByText("App name or bundle ID", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await selectTool(page, "Resource usage");
  await page.getByRole("button", { name: "Sample now" }).click();
  await expect(page.getByText("140.0 MiB", { exact: true })).toBeVisible();
  const count = await page.evaluate(
    () =>
      (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls.filter(
        (call) => call.method === "devices.capture",
      ).length,
  );
  await page.waitForTimeout(1300);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls.filter(
          (call) => call.method === "devices.capture",
        ).length,
    ),
  ).toBe(count);
});
for (const locale of ["en", "tr"]) {
  for (const width of [360, 390, 760, 1440]) {
    test(`actual detached tools show five panels at ${width}px in ${locale}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?detached=1&lang=${locale}`);
      await expect(page.locator(".host-tools-window")).toBeVisible();
      const names =
        locale === "en"
          ? ["Devices", "Host browser", "Development servers", "Logs", "Resource usage"]
          : ["Cihazlar", "Tarayıcı", "Geliştirme sunucuları", "Loglar", "Kaynak kullanımı"];
      const toolMenu = page.getByRole("button", {
        name: locale === "en" ? "Conversation tool selection" : "Konuşma aracı seçimi",
        exact: true,
      });
      await toolMenu.click();
      await expect(page.getByRole("menuitemradio")).toHaveCount(5);
      await page.keyboard.press("Escape");
      for (let index = 0; index < 5; index++) {
        await selectTool(page, names[index]);
        await expect(page.getByRole("tabpanel")).toBeVisible();
        await expect(page.locator(".host-tools-content > .host-tool-panel")).toBeVisible();
        if (index === 0)
          await expect(page.locator(".device-panel-choice").getByRole("button")).toBeVisible();
        if (index === 1)
          await expect(
            page.getByRole("button", {
              name: locale === "en" ? "Open website" : "Web sitesini aç",
              exact: true,
            }),
          ).toBeEnabled();
        if (index === 2)
          await expect(
            page.getByRole("listitem", { name: "Demo dev server", exact: true }),
          ).toBeVisible();
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
        if (index === 1) {
          await page
            .getByRole("button", {
              name: locale === "en" ? "Open website" : "Web sitesini aç",
              exact: true,
            })
            .click();
          await expect(page.locator(".host-browser-frame")).toBeVisible();
        }
        if (index === 3) {
          await expect(page.getByText("Workspace loaded", { exact: true })).toBeVisible();
        }
        if (index === 4) {
          await page
            .getByRole("button", {
              name: locale === "en" ? "Sample now" : "Şimdi örnekle",
              exact: true,
            })
            .click();
          await expect(page.getByText("2.4%", { exact: true })).toBeVisible();
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        ).toBe(true);
        await page.screenshot({
          path: `${captures}/detached-${locale}-${width}-panel-${index}.png`,
          animations: "disabled",
        });
        const overflow = await page.getByRole("tabpanel").evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          offenders: [...element.querySelectorAll("*")]
            .filter(
              (child) =>
                child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1,
            )
            .map((child) => ({
              tag: child.tagName,
              class: child.className,
              width: child.getBoundingClientRect().width,
            }))
            .slice(0, 8),
        }));
        expect(overflow.scrollWidth <= overflow.width + 1, JSON.stringify(overflow)).toBe(true);
        if ([0, 1, 3, 4].includes(index)) {
          const selectors = [page.locator(".host-tools-machine-field").getByRole("button")];
          if (index === 0) selectors.push(page.locator(".device-panel-choice").getByRole("button"));
          if (index === 3) {
            selectors.push(
              page.getByRole("button", {
                name: locale === "en" ? "Filters" : "Filtreler",
                exact: true,
              }),
            );
          }
          for (const [selectorIndex, trigger] of selectors.entries()) {
            await trigger.click();
            const dialog = page.getByRole("dialog").last();
            await expect(dialog).toBeVisible();
            const bounds = await dialog.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
            expect(bounds!.y).toBeGreaterThanOrEqual(0);
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
            await page.screenshot({
              path: `${captures}/detached-${locale}-${width}-dropdown-${index}-${selectorIndex}.png`,
              animations: "disabled",
            });
            await page.keyboard.press("Escape");
            await expect(trigger).toBeFocused();
          }
        }
      }
      {
        const selector = page.getByRole("button", {
          name: locale === "en" ? "Conversation tool selection" : "Konuşma aracı seçimi",
          exact: true,
        });
        await selector.focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await expect(selector).toBeFocused();
        await expect(selector).toContainText(names[4]);
      }
      expect(errors).toEqual([]);
    });
  }
}

test("keeps preview separate from explicit website log monitoring", async ({ page }) => {
  await page.goto(fixture + "?detached=1");
  await selectTool(page, "Host browser");
  await page.getByLabel("Website address").fill("http://localhost:5173");
  await page.getByRole("button", { name: "Open website", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "Shared host browser screenshot; click to interact when controlling",
    }),
  ).toBeVisible();
  const monitorStarts = () =>
    page.evaluate(
      () =>
        (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls.filter(
          (call) => call.method === "runtimeLogs.monitors.start",
        ).length,
    );
  expect(await monitorStarts()).toBe(0);
  await selectTool(page, "Logs");
  await expect(page.getByText("Workspace loaded", { exact: true })).toBeVisible();
  expect(await monitorStarts()).toBe(0);
  const logAreaBefore = await page.locator(".runtime-logs-timeline").boundingBox();
  await expect(page.getByRole("button", { name: /^Filters and options/ })).toHaveCount(0);
  const logAreaAfter = await page.locator(".runtime-logs-timeline").boundingBox();
  expect(logAreaAfter!.height).toBe(logAreaBefore!.height);
  await page.getByRole("button", { name: "Website monitors", exact: true }).click();
  await page.getByLabel("Website port or URL").fill("http://localhost:5173");
  await page.getByRole("button", { name: "Open website and capture logs", exact: true }).click();
  await expect(page.getByLabel("Website port or URL")).toHaveValue("");
  expect(await monitorStarts()).toBe(1);
  await expect(page.getByRole("button", { name: "Stop monitor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop monitor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop monitor", exact: true })).toHaveCount(0);
});

test("finds servers by port and name and retains list scroll across updates and scan failures", async ({
  page,
}) => {
  await page.goto(fixture + "?detached=1&servers=many");
  await selectTool(page, "Development servers");
  const search = page.getByLabel("Find server", { exact: true });
  const list = page.getByRole("list", { name: "Development servers", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(26);
  await search.fill("5173");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem", { name: "Demo dev server", exact: true })).toBeVisible();
  await search.fill("external");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem", { name: "External server", exact: true })).toBeVisible();
  await search.fill("");
  const panel = page.getByRole("tabpanel");
  await panel.evaluate((element) => {
    element.scrollTop = 750;
  });
  const scrollBefore = await panel.evaluate((element) => element.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);
  const controls = page.getByRole("region", { name: "Development servers", exact: true });
  const refresh = () =>
    controls
      .getByRole("button", { name: "Refresh", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
  await page.evaluate(() => {
    (
      window as unknown as { hostToolFixture: { scanDelayMs: number } }
    ).hostToolFixture.scanDelayMs = 150;
  });
  await refresh();
  await expect(list.getByRole("listitem")).toHaveCount(26);
  await expect(page.locator('.dev-servers-panel[aria-busy="true"]')).toHaveCount(0);
  await expect
    .poll(() => panel.evaluate((element) => element.scrollTop))
    .toBeCloseTo(scrollBefore, 0);
  await page.evaluate(() => {
    (
      window as unknown as { hostToolFixture: { scanFailure: boolean } }
    ).hostToolFixture.scanFailure = true;
  });
  await refresh();
  await expect(
    page.getByText("Showing the last successful scan. Retry to update.", { exact: true }),
  ).toBeAttached();
  await expect(list.getByRole("listitem")).toHaveCount(26);
  await expect
    .poll(() => panel.evaluate((element) => element.scrollTop))
    .toBeCloseTo(scrollBefore, 0);
  await page.evaluate(() => {
    const fixture = (
      window as unknown as { hostToolFixture: { scanFailure: boolean; updateServer: () => void } }
    ).hostToolFixture;
    fixture.scanFailure = false;
    fixture.updateServer();
  });
  await page
    .getByRole("button", { name: "Retry scan", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(
    list.getByRole("listitem", { name: "Updated preview server", exact: true }),
  ).toBeAttached();
  await expect
    .poll(() => panel.evaluate((element) => element.scrollTop))
    .toBeCloseTo(scrollBefore, 0);
});

test("compact browser keeps preview and keyboard controls usable at all panel widths", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["dark", "light"]) {
    for (const width of [390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?detached=1`);
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("theme-light", theme === "light"),
        theme,
      );
      await selectTool(page, "Host browser");
      const panel = page.locator(".host-browser-panel");
      await expect(panel.getByRole("button", { name: "Open website", exact: true })).toBeEnabled();
      await expect(
        panel.getByRole("button", { name: "Browser controls and setup", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Browser controls and setup" })).toHaveCount(0);
      const address = panel.getByRole("textbox", { name: "Website address" });
      await address.focus();
      await page.keyboard.press("Enter");
      await expect(panel.locator(".host-browser-frame")).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Select element and add to composer", exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("switch", { name: "Live view" })).toBeEnabled();
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const canvasBox = await panel.locator(".host-browser-preview").boundingBox();
      expect(canvasBox!.height).toBeGreaterThan((await panel.boundingBox())!.height * 0.75);
      const preview = await panel.locator(".host-browser-stage").boundingBox();
      await expect(panel.locator(".host-browser-side")).toHaveCount(0);
      const panelBox = await panel.boundingBox();
      expect(preview!.width).toBeGreaterThan(panelBox!.width * 0.9);
      await page.screenshot({
        path: `temp/verification/2026-10-15-browser-workbench/${theme}-${width}.png`,
        animations: "disabled",
      });
      await panel.getByRole("button", { name: "Actual size", exact: true }).click();
      const actualFrame = await panel.locator(".host-browser-frame").boundingBox();
      expect(actualFrame!.width).toBeGreaterThanOrEqual(1279);
      const scrollablePreview = panel.locator(".host-browser-preview");
      if (width < 1280) {
        expect(
          await scrollablePreview.evaluate((node) => node.scrollWidth > node.clientWidth),
        ).toBe(true);
        await scrollablePreview.evaluate((node) => {
          node.scrollLeft = 160;
        });
        expect(await scrollablePreview.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      }
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await panel.getByRole("button", { name: "Fit preview", exact: true }).click();
      await panel.getByRole("button", { name: "Browser controls and setup", exact: true }).click();
      const controls = page.getByRole("dialog", {
        name: "Browser controls and setup",
        exact: true,
      });
      await expect(controls).toBeVisible();
      const controlsBox = await controls.boundingBox();
      expect(controlsBox!.x).toBeGreaterThanOrEqual(0);
      expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(width);
      await controls
        .getByRole("textbox", { name: "Text to type into host browser" })
        .fill("Kept draft");
      await expect(
        controls.getByRole("textbox", { name: "Text to type into host browser" }),
      ).toHaveValue("Kept draft");
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(controls).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: "Browser controls and setup", exact: true }),
      ).toBeFocused();
      await panel.getByRole("button", { name: "Browser controls and setup", exact: true }).click();
      await expect(
        controls.getByRole("textbox", { name: "Text to type into host browser" }),
      ).toHaveValue("Kept draft");
      await expect(
        controls.getByRole("button", { name: "Close browser", exact: true }),
      ).toBeEnabled();
    }
  }
  await page.setViewportSize({ width: 1920, height: 640 });
  await page.goto(`${fixture}?detached=1`);
  await selectTool(page, "Host browser");
  const shortPanel = page.locator(".host-browser-panel");
  await expect(shortPanel.getByRole("button", { name: "Open website", exact: true })).toBeEnabled();
  await shortPanel.getByRole("textbox", { name: "Website address" }).focus();
  await page.keyboard.press("Enter");
  const shortCanvas = await shortPanel.locator(".host-browser-preview").boundingBox();
  expect(shortCanvas!.height).toBeGreaterThan((await shortPanel.boundingBox())!.height * 0.7);
  expect(shortCanvas!.width).toBeGreaterThan(1800);
  await page.screenshot({
    path: "temp/verification/2026-10-15-browser-workbench/dark-1920x640.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
for (const [theme, width] of [
  ["light", 390],
  ["dark", 1440],
] as const) {
  test(`shared AUX log filters ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${fixture}?theme=${theme}`);
    await selectTool(page, "Logs");
    const trigger = page.getByRole("button", { name: "Filters", exact: true });
    await trigger.click();
    const filters = page.getByRole("dialog", { name: "Log filters", exact: true });
    await expect(filters).toBeVisible();
    await filters.getByRole("radio", { name: /^Server/ }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(filters.getByRole("radio", { name: /^Browser/ })).toBeChecked();
    await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(filters.getByRole("radio", { name: /^All/ })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(filters).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `temp/verification/2026-10-16-ui-system/W5b-AUX-logs-${theme}-${width}.png`,
      animations: "disabled",
    });
    expect(
      await page.evaluate(() =>
        (window as any).hostToolCalls.filter((call: any) =>
          [
            "runtimeLogs.monitors.start",
            "devServers.stop",
            "devServers.kill",
            "devServers.restart",
          ].includes(call.method),
        ),
      ),
    ).toEqual([]);
  });
}

test("shared host danger feedback preserves server selection and recovery in both themes", async ({
  page,
}) => {
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 390, height: 820 });
    await page.goto(`${fixture}?detached=1&theme=${theme}`);
    await selectTool(page, "Development servers");
    const servers = page.getByRole("list", { name: "Development servers", exact: true });
    const selected = servers.getByRole("button", { name: /^Demo dev server/ });
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => {
      (
        window as unknown as { hostToolFixture: { scanFailure: boolean } }
      ).hostToolFixture.scanFailure = true;
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const error = page.getByRole("alert").filter({ hasText: "Could not refresh servers." });
    await expect(error).toBeVisible();
    await expect(error).toHaveClass(/bycoda-arc/);
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(servers.getByRole("listitem")).toHaveCount(2);
    expect(await page.locator("body").evaluate((node) => node.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => {
      (
        window as unknown as { hostToolFixture: { scanFailure: boolean } }
      ).hostToolFixture.scanFailure = false;
    });
    await page.getByRole("button", { name: "Retry scan", exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(selected).toHaveAttribute("aria-pressed", "true");
  }
});

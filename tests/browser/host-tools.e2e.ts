import { test, expect, type Page, type Locator } from "@playwright/test";
const fixture = "/tests/browser/host-tools.html";
const captures = "temp/verification/2026-10-12-tools-usability/browser";
test("device preview uses the dock height with compact controls", async ({ page }) => {
  for (const width of [390, 520, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 988 });
    await page.goto(`${fixture}?detached=1&lang=tr`);
    await page.getByRole("tab", { name: "Cihazlar", exact: true }).click();
    await page.getByRole("button", { name: "Önyükleme", exact: true }).click();
    const image = page.getByRole("img", { name: "Geçerli cihaz ekranı" });
    await expect(image).toBeVisible();
    const preview = page.locator(".device-panel-preview");
    const bounds = (await preview.boundingBox())!;
    expect(bounds.height).toBeGreaterThan(988 * 0.5);
    await expect(page.locator(".device-panel-setup > summary")).toBeInViewport();
    await expect(page.locator(".device-panel-setup")).not.toHaveAttribute("open");
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
    await page.getByRole("tab", { name: "Development servers", exact: true }).click();
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
  await expect(dock.getByRole("tab", { name: "Devices", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".tools-workspace")).toHaveAttribute("data-placement", "right");
  await expect(dock.getByRole("button", { name: /Fixture MacBook/ }).first()).toBeVisible();
  await api("ui.tools.open", { tab: "logs" });
  await expect(dock.getByRole("tab", { name: "Logs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
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
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
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
  await page.getByRole("tab", { name: "Resource usage", exact: true }).click();
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
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
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
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
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
  await panel.getByRole("button", { name: "ERROR", exact: true }).click();
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
  await panel.getByRole("button", { name: "Clear view", exact: true }).click();
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
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
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
    await expect(page.getByRole("button", { name: "ERROR", exact: true })).toBeInViewport();
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
  await page.getByRole("tab", { name: "Host browser", exact: true }).click();
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
  await page.getByRole("tab", { name: "Resource usage", exact: true }).click();
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
  await page.getByRole("tab", { name: "Development servers", exact: true }).click();
  await expect(machine).toHaveCount(0);
});

test("shows grouped server ports, reviews impact and offers force after graceful stop", async ({
  page,
}) => {
  await page.goto(fixture);
  await page.getByRole("tab", { name: "Development servers", exact: true }).click();
  const server = page.getByRole("article", { name: "Demo dev server", exact: true });
  await expect(server.getByText("http://127.0.0.1:5173", { exact: true })).toBeVisible();
  await expect(server.getByText("http://[::1]:5173", { exact: true })).toBeVisible();
  await server.getByText("Process and controls", { exact: true }).click();
  await server.getByRole("button", { name: "Stop", exact: true }).click();
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
  await page.getByRole("tab", { name: "Development servers", exact: true }).click();
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
    await page.getByRole("tab", { name: "Development servers", exact: true }).click();
    await expect(page.getByRole("article", { name: "Demo dev server", exact: true })).toBeVisible();
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
  await page.getByRole("tab", { name: "Host browser", exact: true }).click();
  await page.getByRole("button", { name: "Open website", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "Shared host browser screenshot; click to interact when controlling",
    }),
  ).toBeVisible();
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
  await page.getByRole("tab", { name: "Devices", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Selected device: Demo Android emulator · Android · Stopped",
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
  await page.getByRole("button", { name: "Add device to conversation", exact: true }).click();
  await expect(page.getByText("Device added to draft.", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { hostToolDraft: string }).hostToolDraft),
  ).toContain("demo-emulator");
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Boot", exact: true }).click();
  await expect(page.getByRole("img", { name: "Current device screen" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Live view" })).toBeChecked();
  await page.getByRole("switch", { name: "Allow device control", exact: true }).check();
  await expect(page.getByText("App name or bundle ID", { exact: true })).not.toBeVisible();
  await page.locator(".device-panel-manual > summary").click();
  await expect(page.getByText("App name or bundle ID", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Resource usage" }).click();
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
      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveCount(5);
      for (let index = 0; index < 5; index++) {
        await tabs.nth(index).click();
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
            page.getByRole("article", { name: "Demo dev server", exact: true }),
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
          await page.locator(".host-tool-panel .host-tool-primary").click();
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
            selectors.push(page.locator(".runtime-logs-filter").getByRole("button").nth(0));
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
      await tabs.first().focus();
      await page.keyboard.press("End");
      await expect(tabs.last()).toBeFocused();
      await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
      expect(errors).toEqual([]);
    });
  }
}

test("keeps preview separate from explicit website log monitoring", async ({ page }) => {
  await page.goto(fixture + "?detached=1");
  await page.getByRole("tab", { name: "Host browser", exact: true }).click();
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
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  await expect(page.getByText("Workspace loaded", { exact: true })).toBeVisible();
  expect(await monitorStarts()).toBe(0);
  const logAreaBefore = await page.locator(".runtime-logs-timeline").boundingBox();
  await expect(page.getByRole("button", { name: /^Filters and options/ })).toHaveCount(0);
  const logAreaAfter = await page.locator(".runtime-logs-timeline").boundingBox();
  expect(logAreaAfter!.height).toBe(logAreaBefore!.height);
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
  await page.getByRole("tab", { name: "Development servers", exact: true }).click();
  const search = page.getByLabel("Find server", { exact: true });
  await expect(page.getByRole("article")).toHaveCount(26);
  await search.fill("5173");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Demo dev server", exact: true })).toBeVisible();
  await search.fill("external");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "External server", exact: true })).toBeVisible();
  await search.fill("");
  const panel = page.getByRole("tabpanel");
  await panel.evaluate((element) => {
    element.scrollTop = 750;
  });
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
  await expect(page.getByRole("article")).toHaveCount(26);
  await expect(page.locator('.dev-servers-panel[aria-busy="true"]')).toHaveCount(0);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(700);
  await page.evaluate(() => {
    (
      window as unknown as { hostToolFixture: { scanFailure: boolean } }
    ).hostToolFixture.scanFailure = true;
  });
  await refresh();
  await expect(
    page.getByText("Showing the last successful scan. Retry to update.", { exact: true }),
  ).toBeAttached();
  await expect(page.getByRole("article")).toHaveCount(26);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(700);
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
    page.getByRole("article", { name: "Updated preview server", exact: true }),
  ).toBeAttached();
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(700);
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
      await page.getByRole("tab", { name: "Host browser", exact: true }).click();
      const panel = page.locator(".host-browser-panel");
      await expect(panel.getByRole("button", { name: "Open website", exact: true })).toBeEnabled();
      await expect(panel.getByRole("button", { name: "Status", exact: true })).toBeVisible();
      const address = panel.getByRole("textbox", { name: "Website address" });
      await address.focus();
      await page.keyboard.press("Enter");
      await expect(panel.locator(".host-browser-frame")).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Select element and add to composer", exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("switch", { name: "Live view" })).toBeEnabled();
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const frameBox = await panel.locator(".host-browser-frame").boundingBox();
      expect(frameBox!.height).toBeLessThanOrEqual(Math.max(320, 900 - 240) + 1);
      const preview = await panel.locator(".host-browser-stage").boundingBox();
      const side = await panel.locator(".host-browser-side").boundingBox();
      if (width >= 1024) expect(side!.x).toBeGreaterThan(preview!.x + preview!.width);
      else expect(side!.y).toBeGreaterThan(preview!.y);
      await page.screenshot({
        path: `temp/verification/2026-10-15-browser-panel/${theme}-${width}.png`,
        animations: "disabled",
      });
      await panel
        .getByRole("textbox", { name: "Text to type into host browser" })
        .fill("Kept draft");
      await expect(
        panel.getByRole("textbox", { name: "Text to type into host browser" }),
      ).toHaveValue("Kept draft");
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await expect(panel.getByRole("button", { name: "Close browser", exact: true })).toBeEnabled();
    }
  }
  await page.setViewportSize({ width: 1920, height: 640 });
  await page.goto(`${fixture}?detached=1`);
  await page.getByRole("tab", { name: "Host browser", exact: true }).click();
  const shortPanel = page.locator(".host-browser-panel");
  await expect(shortPanel.getByRole("button", { name: "Open website", exact: true })).toBeEnabled();
  await shortPanel.getByRole("textbox", { name: "Website address" }).focus();
  await page.keyboard.press("Enter");
  const shortFrame = await shortPanel.locator(".host-browser-frame").boundingBox();
  expect(shortFrame!.height).toBeLessThanOrEqual(400 + 1);
  await page.screenshot({
    path: "temp/verification/2026-10-15-browser-panel/dark-1920x640.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

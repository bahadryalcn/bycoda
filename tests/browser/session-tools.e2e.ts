import { test, expect, type Page, type Locator } from "@playwright/test";
const fixture = "/tests/browser/session-tools.html";
const captures = "temp/verification/2026-11-04-session-tools/hub";
test("two renderer windows follow focused sessions, retain pin, select manually, clear empty sessions and capture both themes", async ({
  context,
}) => {
  const source = await context.newPage();
  const hub = await context.newPage();
  await source.goto(`${fixture}?role=source&theme=dark`);
  await expect(source.getByRole("button", { name: "Atlas", exact: true })).toBeVisible();
  await hub.goto(`${fixture}?role=hub&theme=dark`);
  const identity = hub.locator(".tools-hub-identity button");
  await expect(identity).toContainText("Atlas");
  await source.bringToFront();
  await source.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(identity).toContainText("Studio");
  await hub.bringToFront();
  await hub.getByRole("button", { name: "Follow active conversation", exact: true }).click();
  await source.bringToFront();
  await source.getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(identity).toContainText("Studio");
  await hub.bringToFront();
  await hub.getByRole("button", { name: "Keep this conversation", exact: true }).click();
  await expect(identity).toContainText("Atlas");
  await identity.click();
  await hub.getByRole("option").filter({ hasText: "Studio" }).click();
  await expect(identity).toContainText("Studio");
  await expect(
    hub.getByRole("button", { name: "Follow active conversation", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await source.bringToFront();
  await source.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(identity).toContainText("Notes");
  await expect(hub.getByText("No tools in this conversation", { exact: true })).toBeVisible();
  await expect(hub.locator(".tools-hub-pane:not([hidden])")).toHaveCount(0);
  await source.getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(identity).toContainText("Atlas");
  await hub.bringToFront();
  await identity.click();
  await hub.getByRole("option").filter({ hasText: "Studio" }).click();
  await expect(identity).toContainText("Studio");
  await source.bringToFront();
  await source.getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(identity).toContainText("Atlas");
  for (const theme of ["light", "dark"])
    for (const width of [1280, 800]) {
      await hub.setViewportSize({ width, height: 860 });
      await hub.goto(`${fixture}?role=hub&theme=${theme}`);
      await expect(hub.locator(".tools-hub-identity button")).toContainText("Atlas");
      await expect(hub.locator(".tools-hub-pane:not([hidden]) .host-browser-bar")).toBeVisible();
      await hub.screenshot({
        animations: "disabled",
        path: `${captures}/${theme}-${width}-hub.png`,
      });
      await hub.locator(".tools-hub-identity button").hover();
      await expect(hub.getByRole("tooltip")).toBeVisible();
      await hub.screenshot({
        animations: "disabled",
        path: `${captures}/${theme}-${width}-hover.png`,
      });
      await hub.locator(".tools-hub-identity button").click();
      await expect(hub.getByRole("listbox", { name: "Tool conversations" })).toBeVisible();
      await hub.screenshot({
        animations: "disabled",
        path: `${captures}/${theme}-${width}-picker.png`,
      });
      expect(
        await hub
          .locator(".tools-hub-header")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await hub.keyboard.press("Escape");
      await expect(hub.locator(".tools-hub-identity button")).toBeFocused();
    }
});

async function chooseTool(page: Page, scope: Locator, label: string) {
  const tab = scope.getByRole("tab", { name: label, exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await scope.getByRole("button", { name: "Conversation tool selection", exact: true }).click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
  }
}

test("actual renderer transfers device marks/comments and server/log drafts through scoped events and back", async ({
  context,
}) => {
  const source = await context.newPage();
  const hub = await context.newPage();
  await source.setViewportSize({ width: 1280, height: 900 });
  await hub.setViewportSize({ width: 1280, height: 900 });
  await source.goto(`${fixture}?role=source&theme=light&shared-device=1`);
  await hub.goto(`${fixture}?role=hub&theme=light&shared-device=1`);
  const dock = source.locator('.tools-workspace-pane[aria-hidden="false"]');
  const pane = hub.locator(".tools-hub-pane:not([hidden])");
  await source.bringToFront();
  await chooseTool(source, dock, "Devices");
  await expect(dock.locator(".device-panel-connect, .device-panel-bar")).toBeVisible();
  if (await dock.getByRole("button", { name: "Connect devices", exact: true }).isVisible())
    await dock.getByRole("button", { name: "Connect devices", exact: true }).click();
  await dock.getByRole("button", { name: "Start emulator", exact: true }).click();
  await expect(dock.getByRole("img", { name: "Current device screen", exact: true })).toBeVisible();
  await dock.getByRole("switch", { name: "Allow device control", exact: true }).click();
  await dock.getByRole("button", { name: "Device text input", exact: true }).click();
  await source
    .getByRole("textbox", { name: "Text to type on device", exact: true })
    .fill("retained device text");
  await source.keyboard.press("Escape");
  await dock.getByRole("button", { name: "Choose app to open", exact: true }).click();
  await source
    .getByRole("textbox", { name: "App name or bundle ID", exact: true })
    .fill("com.example.draft");
  await source.keyboard.press("Escape");
  await dock.getByRole("button", { name: "Mark device screen", exact: true }).click();
  await dock.getByRole("button", { name: "Draw rectangle", exact: true }).click();
  const canvas = dock.getByRole("group", { name: "Current device screen", exact: true });
  const box = (await canvas.boundingBox())!;
  await source.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await source.mouse.down();
  await source.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await source.mouse.up();
  await expect(dock.getByRole("button", { name: "Undo annotation", exact: true })).toBeEnabled();
  await dock.getByRole("button", { name: "Annotation note", exact: true }).click();
  await source
    .getByRole("textbox", { name: "Annotation note", exact: true })
    .fill("source device note");
  await source.keyboard.press("Escape");
  await chooseTool(source, dock, "Development servers");
  await dock.getByRole("button", { name: "Start server", exact: true }).click();
  await dock
    .getByRole("textbox", { name: "Server name", exact: true })
    .fill("Retained server draft");
  await dock
    .getByRole("textbox", { name: "Server command", exact: true })
    .fill("pnpm dev -- --port 6006");
  await chooseTool(source, dock, "Logs");
  await dock.getByRole("searchbox", { name: "Search logs", exact: true }).fill("source log filter");
  await dock.getByRole("button", { name: "Open in new window", exact: true }).click();
  await expect(source.locator(".tools-workspace")).toHaveAttribute("data-open", "false");
  await hub.bringToFront();
  await expect(pane.getByRole("searchbox", { name: "Search logs", exact: true })).toHaveValue(
    "source log filter",
  );
  await pane.getByRole("searchbox", { name: "Search logs", exact: true }).fill("hub log filter");
  await chooseTool(hub, pane, "Development servers");
  await expect(pane.getByRole("textbox", { name: "Server name", exact: true })).toHaveValue(
    "Retained server draft",
  );
  await pane
    .getByRole("textbox", { name: "Server command", exact: true })
    .fill("pnpm dev -- --port 7007");
  await chooseTool(hub, pane, "Devices");
  await expect(
    pane.getByRole("switch", { name: "Allow device control", exact: true }),
  ).not.toBeChecked();
  await pane.getByRole("button", { name: "Mark device screen", exact: true }).click();
  await expect(pane.getByRole("button", { name: "Undo annotation", exact: true })).toBeEnabled();
  await pane.getByRole("button", { name: "Annotation note", exact: true }).click();
  await expect(hub.getByRole("textbox", { name: "Annotation note", exact: true })).toHaveValue(
    "source device note",
  );
  await hub.getByRole("textbox", { name: "Annotation note", exact: true }).fill("hub device note");
  await hub.screenshot({ path: `${captures}/domain-hub-device-note.png`, animations: "disabled" });
  await hub.keyboard.press("Escape");
  await hub.getByRole("button", { name: "Return to conversation", exact: true }).click();
  await expect(source.locator(".tools-workspace")).toHaveAttribute("data-open", "true");
  await expect
    .poll(() =>
      hub.evaluate(
        () => (window as unknown as { sessionToolsHidden?: boolean }).sessionToolsHidden,
      ),
    )
    .toBe(true);
  await source.bringToFront();
  await dock.getByRole("button", { name: "Annotation note", exact: true }).click();
  await expect(source.getByRole("textbox", { name: "Annotation note", exact: true })).toHaveValue(
    "hub device note",
  );
  await source.keyboard.press("Escape");
  await chooseTool(source, dock, "Development servers");
  await expect(dock.getByRole("textbox", { name: "Server command", exact: true })).toHaveValue(
    "pnpm dev -- --port 7007",
  );
  await chooseTool(source, dock, "Logs");
  await expect(dock.getByRole("searchbox", { name: "Search logs", exact: true })).toHaveValue(
    "hub log filter",
  );
});

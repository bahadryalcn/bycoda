import { expect, test, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const evidence = "temp/verification/2026-10-19-servers-ux/browser";

async function openAdvancedSshSettings(editor: Locator) {
  const closed = editor
    .locator("details:not([open]) > summary")
    .filter({ hasText: "Advanced SSH settings" });
  if (await closed.count()) await closed.click();
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1024, 1440]) {
    test(`server activation keeps rows stable and connects once by double click or Enter ${theme} ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/servers.html?terminalWorkspace&theme=${theme}`);
      const inventory = page.getByRole("list", { name: "Servers" });
      const requests = () =>
        page.evaluate(() =>
          (window as any).serversFixtureRequests.filter(
            (entry: any) => entry.command === "ssh_terminal_spawn",
          ),
        );
      const row = inventory.getByRole("button", { name: /^Server 01/ });
      const before = (await row.boundingBox())!;
      await row.click();
      const after = (await row.boundingBox())!;
      expect(Math.abs(after.x - before.x)).toBeLessThan(1);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1);
      expect(Math.abs(after.width - before.width)).toBeLessThan(1);
      expect(await requests()).toHaveLength(0);
      await page.getByRole("button", { name: "Close server details", exact: true }).click();
      await expect(row).toBeFocused();
      await inventory.getByRole("button", { name: /^Server 03/ }).dblclick();
      await expect(page.getByRole("region", { name: "SSH terminal", exact: true })).toBeVisible();
      await expect.poll(async () => (await requests()).length).toBe(1);
      expect((await requests())[0].input.connectionId).toBe("fixture-3");
      const session = page.locator("[data-server-terminal-session]:visible");
      const typography = session.getByRole("group", { name: "Terminal text size" });
      await expect(typography.getByRole("button", { name: "Reset text size" })).toHaveText("13");
      await typography.getByRole("button", { name: "Increase text size", exact: true }).click();
      await expect(typography.getByRole("button", { name: "Reset text size" })).toHaveText("14");
      expect(await requests()).toHaveLength(1);
      await typography.getByRole("button", { name: "Reset text size" }).click();
      await page.evaluate((id) => (window as any).serversFixtureTerminalOutput(id,
        "\x1b[32mubuntu@server-3\x1b[0m:~$ ls -lah\r\ntotal 24K\r\ndrwxr-xr-x  ubuntu ubuntu 4.0K  projects\r\n-rw-r--r--  ubuntu ubuntu 1.2K  README.md\r\n\x1b[32mubuntu@server-3\x1b[0m:~$ "), (await requests())[0].input.id);
      await page.screenshot({ path: `temp/verification/2026-10-19-server-terminal/session-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Servers", exact: true }).click();
      const search = page.getByRole("textbox", { name: "Search servers" });
      await search.fill("Server 02");
      const next = inventory.getByRole("button");
      await next.focus();
      await page.keyboard.press("Space");
      await expect(page.getByRole("region", { name: "Server details" })).toBeVisible();
      expect(await requests()).toHaveLength(1);
      const folder = "temp/verification/2026-10-19-server-activation";
      await mkdir(folder, { recursive: true });
      await page.screenshot({ path: `${folder}/selection-${theme}-${width}.png` });
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await requests()).length).toBe(2);
      expect((await requests())[1].input.connectionId).toBe("fixture-2");
      await expect(
        page.getByRole("tablist", { name: "SSH terminals" }).getByRole("tab"),
      ).toHaveCount(2);
      await page.getByRole("button", { name: "Servers", exact: true }).click();
      await expect(search).toHaveValue("Server 02");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
  test(`server activation never opens SSH for a Host without SSH ${theme}`, async ({ page }) => {
    await page.goto(`/tests/browser/servers.html?terminalWorkspace&hostOnlyFixture&theme=${theme}`);
    const row = page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /^Server 00/ });
    await row.dblclick();
    await expect(page.getByRole("region", { name: "Server details" })).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as any).serversFixtureRequests.some((entry: any) =>
          entry.command.startsWith("ssh_terminal_"),
        ),
      ),
    ).toBe(false);
  });
}

for (const [query, title] of [
  ["groupFixture&inheritedFixture", "Review SSH configuration"],
  ["httpProxyFixture&proxyAuthFixture", "HTTP proxy authentication"],
]) {
  test(`server double click preserves ${title}`, async ({ page }) => {
    await page.goto(`/tests/browser/servers.html?terminalWorkspace&sshFixture&${query}`);
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .dblclick();
    const review = page.getByRole("dialog", { name: title, exact: true });
    await expect(review).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as any).serversFixtureRequests.some(
          (entry: any) => entry.command === "ssh_terminal_spawn",
        ),
      ),
    ).toBe(false);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as any).serversFixtureRequests.some(
          (entry: any) => entry.command === "ssh_terminal_spawn",
        ),
      ),
    ).toBe(false);
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1240]) {
    test(`SSH terminal tab close stays inside its surface and exit recovery is explicit ${theme} ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/servers.html?terminalWorkspace&theme=${theme}`);
      for (let index = 0; index < 2; index++) {
        await page.getByRole("button", { name: "Quick connect", exact: true }).click();
        const editor = page.getByRole("dialog", { name: "Quick connect", exact: true });
        await editor
          .getByRole("textbox", { name: "Host", exact: true })
          .fill(`server-${index}.example.invalid`);
        await editor.getByRole("textbox", { name: "Name", exact: true }).fill("106");
        await editor.getByRole("button", { name: "Connect", exact: true }).click();
        await expect(
          page.getByRole("tablist", { name: "SSH terminals" }).getByRole("tab"),
        ).toHaveCount(index + 1);
        if (index === 0) await page.getByRole("button", { name: "Servers", exact: true }).click();
      }
      const list = page.getByRole("tablist", { name: "SSH terminals" });
      const tabs = list.getByRole("tab");
      await tabs.last().focus();
      await page.keyboard.press("Home");
      await expect(tabs.first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(tabs.last()).toBeFocused();
      for (const group of await list.locator("[data-server-terminal-tab]").all()) {
        const tab = (await group.getByRole("tab").boundingBox())!;
        const close = (await group
          .getByRole("button", { name: "Close terminal: 106", exact: true })
          .boundingBox())!;
        expect(close.x).toBeGreaterThanOrEqual(tab.x);
        expect(close.x + close.width).toBeLessThanOrEqual(tab.x + tab.width + 1);
        expect(close.y).toBeGreaterThanOrEqual(tab.y);
        expect(close.y + close.height).toBeLessThanOrEqual(tab.y + tab.height + 1);
      }
      const activeId = await tabs.last().getAttribute("aria-controls");
      const folder = "temp/verification/2026-10-19-server-terminal-ux";
      await mkdir(folder, { recursive: true });
      await page.screenshot({ path: `${folder}/tabs-${theme}-${width}.png` });
      await list.locator("[data-server-terminal-tab]").first().getByRole("button").click();
      await expect(tabs).toHaveCount(1);
      await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
      await expect(tabs.first()).toHaveAttribute("aria-controls", activeId!);
      await page.evaluate(() => {
        const fixture = window as any;
        const request = fixture.serversFixtureRequests
          .filter((entry: any) => entry.command === "ssh_terminal_quick_spawn")
          .at(-1);
        fixture.serversFixtureEmit("pty-exit", { id: request.input.id, code: 255 });
      });
      await expect(page.getByRole("alert")).toContainText("Terminal closed");
      await expect(page.getByRole("alert")).toContainText("255");
      await expect(page.getByRole("button", { name: "Resume input", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `${folder}/exit-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Back to servers", exact: true }).click();
      await expect(page.getByRole("list", { name: "Servers" })).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            (window as any).serversFixtureRequests.filter(
              (entry: any) => entry.command === "ssh_terminal_quick_spawn",
            ).length,
        ),
      ).toBe(2);
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1280]) {
    test(`server purpose panels retain drafts and require explicit SSH connect ${theme} ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 820 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/servers.html?sshFixture&terminalWorkspace&theme=${theme}`);
      const search = page.getByRole("textbox", { name: "Search servers" });
      expect((await search.boundingBox())!.width).toBeGreaterThan(150);
      await page
        .getByRole("list", { name: "Servers" })
        .getByRole("button", { name: /Existing SSH target/ })
        .click();
      const details = page.getByRole("region", { name: "Server details" });
      const navigation = details.getByRole("navigation", { name: "Server tools" });
      const choose = (name: string) =>
        navigation.getByRole("button", { name, exact: true }).click();
      await expect(
        details.getByRole("button", { name: "Connect via SSH", exact: true }),
      ).toBeVisible();
      await expect(details.getByRole("button", { name: "SSH runbooks", exact: true })).toBeHidden();
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/connection-${theme}-${width}.png` });
      await choose("Automation");
      await expect(
        details.getByRole("heading", { name: "Saved commands", exact: true }),
      ).toBeVisible();
      await choose("Settings");
      await details
        .getByRole("textbox", { name: "Group", exact: true })
        .fill("Unfinished server group");
      await choose("Activity");
      await expect(details.getByText("No connection activity yet.", { exact: true })).toBeVisible();
      await choose("Settings");
      await expect(details.getByRole("textbox", { name: "Group", exact: true })).toHaveValue(
        "Unfinished server group",
      );
      await page.screenshot({ path: `${evidence}/settings-${theme}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await page.evaluate(() =>
          (window as any).serversFixtureRequests.some(
            (entry: any) => entry.command === "ssh_terminal_spawn",
          ),
        ),
      ).toBe(false);
      await details.getByRole("button", { name: "Connect via SSH", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "SSH terminal", exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).serversFixtureRequests.filter(
                (entry: any) => entry.command === "ssh_terminal_spawn",
              ).length,
          ),
        )
        .toBe(1);
      expect(
        await page.evaluate(() =>
          (window as any).serversFixtureRequests.some(
            (entry: any) =>
              entry.command === "server_metadata_update" || entry.command === "pty_write",
          ),
        ),
      ).toBe(false);
    });
  }
}

for (const theme of ["dark", "light"]) {
  test(`SFTP recovery review and scoped progress ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?sftpFixture&theme=${theme}`);
    const dialog = page.getByRole("dialog", { name: "SFTP files", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Paused transfers", { exact: false })).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as unknown as { serversFixtureCalls: string[] }).serversFixtureCalls.includes(
          "ssh_sftp_resume",
        ),
      ),
    ).toBe(false);
    await dialog.locator("summary").filter({ hasText: "Paused transfers" }).click();
    await dialog.getByRole("button", { name: "Review resume", exact: true }).click();
    const review = dialog.getByRole("region", { name: "Resume transfer review" });
    await expect(review).toContainText("C:/Fixture files/large-source.bin");
    await expect(review.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
    await review.getByRole("checkbox").check();
    await review.getByRole("button", { name: "Resume", exact: true }).click();
    const request = await page.evaluate(
      () =>
        (
          window as unknown as {
            serversFixtureRequests: { command: string; input: Record<string, unknown> }[];
          }
        ).serversFixtureRequests.find((entry) => entry.command === "ssh_sftp_resume")!.input,
    );
    expect(request.connectionId).toBe("ssh-sftp-fixture");
    expect(request.recoveryId).toBe("fixture-recovery");
    await page.evaluate((operationId) => {
      const fixture = window as unknown as { serversFixtureProgress: (value: unknown) => void };
      fixture.serversFixtureProgress({
        operationId,
        phase: "resume upload",
        transferredBytes: 524288,
        totalBytes: 1048576,
        state: "running",
      });
      fixture.serversFixtureProgress({
        operationId: "other-owner-operation",
        phase: "upload",
        transferredBytes: 999999,
        totalBytes: 1048576,
        state: "running",
      });
    }, request.operationId);
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "524288");
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "1048576");
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "50%");
    await expect(dialog).toContainText("524,288 / 1,048,576 bytes");
    const folder = "temp/verification/2026-10-18-termius-goal/sftp-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-progress.png` });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() =>
      (
        window as unknown as { serversFixtureFinishTransfer: () => void }
      ).serversFixtureFinishTransfer(),
    );
    await expect(dialog).toContainText("Transfer completed");
  });
}

for (const theme of ["dark", "light"])
  for (const width of [320, 390, 1024]) {
    test(`Servers ${theme} ${width}px retained state and keyboard`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/servers.html?theme=${theme}`);
      const search = page.getByRole("textbox", { name: "Search servers" });
      await expect(page.getByRole("list", { name: "Servers" }).getByRole("button")).toHaveCount(35);
      await expect(page.getByRole("list", { name: "Servers" })).toContainText("Not connected");
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/servers-${theme}-${width}-inventory.png` });
      // Select from the unfiltered long inventory: actions must not live below it.
      const inventory = page.getByRole("list", { name: "Servers" });
      const first = inventory.getByRole("button").first();
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(first).toBeFocused();
      await expect(first).not.toContainText("The machine did not answer");
      const details = page.getByRole("region", { name: "Server details" });
      await expect(details).toBeInViewport();
      await expect(
        details.getByRole("button", { name: "Edit machine", exact: true }),
      ).toBeInViewport();
      await expect(
        details.getByRole("button", { name: "Reconnect", exact: true }),
      ).toBeInViewport();
      const disclosure = details
        .locator("details")
        .filter({ has: page.getByText("Connection details", { exact: true }) });
      await expect(disclosure).not.toHaveAttribute("open");
      await disclosure.locator("summary").click();
      await expect(disclosure.locator("p")).toBeVisible();
      await expect(disclosure.locator("p")).toContainText("The machine did not answer");
      await disclosure.locator("summary").click();
      expect(await inventory.evaluate((node) => node.parentElement!.scrollTop)).toBe(0);
      await inventory.evaluate((node) => {
        node.parentElement!.scrollTop = 300;
      });
      await expect
        .poll(() => inventory.evaluate((node) => node.parentElement!.scrollTop))
        .toBe(300);
      await page.getByRole("button", { name: "Toggle servers" }).click();
      await page.getByRole("button", { name: "Toggle servers" }).click();
      await expect
        .poll(() => inventory.evaluate((node) => node.parentElement!.scrollTop))
        .toBe(300);
      await expect(
        details.getByRole("button", { name: "Edit machine", exact: true }),
      ).toBeInViewport();
      await expect(first).toHaveAttribute("aria-pressed", "true");
      await expect(search).toHaveValue("");
      await page.screenshot({
        path: `${evidence}/servers-${theme}-${width}-unfiltered-selection.png`,
      });
      await search.fill("Server 01");
      const machine = page.getByRole("list", { name: "Servers" }).getByRole("button");
      await machine.focus();
      await page.keyboard.press("Enter");
      await expect(machine).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("region", { name: "Server details" })).toContainText("2222");
      await page.getByRole("button", { name: "Toggle servers" }).click();
      await expect(search).toBeHidden();
      await page.getByRole("button", { name: "Toggle servers" }).click();
      await expect(search).toHaveValue("Server 01");
      await expect(machine).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("button", { name: "Open in new window", exact: true }),
      ).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const serversTab = page.getByRole("tab", { name: "Servers", exact: true });
      await serversTab.focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Social Media", exact: true })).toBeFocused();
      await page.keyboard.press("Home");
      await expect(page.getByRole("tab", { name: "Servers", exact: true })).toBeFocused();
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/servers-${theme}-${width}.png` });
    });
  }

test("projectless rail opens Servers and scroll is retained", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/tests/browser/servers.html?rail=expanded");
  const list = page.getByRole("list", { name: "Servers" });
  await expect(list.getByRole("button")).toHaveCount(35);
  await list.evaluate((element) => {
    element.parentElement!.scrollTop = 300;
  });
  await expect.poll(() => list.evaluate((element) => element.parentElement!.scrollTop)).toBe(300);
  await page.getByRole("button", { name: "Toggle servers" }).click();
  await page
    .getByRole("navigation", { name: "Projects", exact: true })
    .getByRole("button", { name: "Servers", exact: true })
    .click();
  await expect(list).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.parentElement!.scrollTop)).toBe(300);
});

for (const theme of ["light", "dark"]) {
  test(`Servers ${theme} refresh failure keeps one notice and working recovery`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?theme=${theme}&refreshError=1`);
    const inventory = page.getByRole("list", { name: "Servers" });
    await expect(inventory.getByRole("button")).toHaveCount(35);
    await inventory.getByRole("button").first().click();
    await page.getByRole("button", { name: "Refresh servers", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText("Showing last loaded data");
    await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeInViewport();
    await expect(inventory.getByRole("button")).toHaveCount(35);
    await expect(inventory.getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/servers-${theme}-refresh-error.png` });
  });
}

test("saved SSH command previews its target and copies without terminal input or startup execution", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tests/browser/servers.html");
  await page.getByRole("list", { name: "Servers" }).getByRole("button").first().click();
  await page
    .getByRole("navigation", { name: "Server tools" })
    .getByRole("button", { name: "Automation", exact: true })
    .click();
  const dialog = page.getByRole("region", { name: "Saved SSH commands", exact: true });
  await expect(dialog).toContainText("Target: Server 00");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Inspect directory");
  await dialog.getByRole("textbox", { name: "Command preview", exact: true }).fill("pwd");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "Saved commands" })).toContainText(
    "Inspect directory",
  );
  await expect(
    dialog.getByRole("button", { name: "Insert into terminal", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Copy command", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("pwd");
  expect(
    await page.evaluate(() =>
      (window as unknown as { serversFixtureCalls: string[] }).serversFixtureCalls.some(
        (command) => command === "pty_write" || command === "ssh_terminal_spawn",
      ),
    ),
  ).toBe(false);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/saved-command-390.png` });
});

test("quick connect is explicit, leaves inventory unsaved and keeps the raw tab on inventory return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 780 });
  await page.goto("/tests/browser/servers.html?terminalWorkspace=1");
  const calls = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            serversFixtureRequests: { command: string; input: Record<string, unknown> }[];
          }
        ).serversFixtureRequests,
    );
  expect((await calls()).some((item) => item.command.startsWith("ssh_terminal"))).toBe(false);
  await page.getByRole("button", { name: "Quick connect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quick connect", exact: true });
  await dialog.getByRole("textbox", { name: "Host", exact: true }).fill("quick.example.invalid");
  await dialog.getByRole("textbox", { name: "SSH user", exact: true }).fill("alice");
  await expect(dialog.locator('[aria-label="Endpoint preview"]')).toContainText(
    "alice@quick.example.invalid:22",
  );
  expect((await calls()).some((item) => item.command.startsWith("ssh_terminal"))).toBe(false);
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "alice@quick.example.invalid:22", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => (await calls()).filter((item) => item.command.startsWith("ssh_terminal")).length,
    )
    .toBe(1);
  expect((await calls()).some((item) => item.command === "server_ssh_save")).toBe(false);
  await page.getByRole("button", { name: "Servers", exact: true }).click();
  await expect(page.getByRole("list", { name: "Servers" }).getByRole("button")).toHaveCount(35);
  expect((await calls()).some((item) => item.command === "pty_kill")).toBe(false);
  // Raw-tab survival on Bash integration is asserted in the provider lifecycle test;
  // this real xterm fixture has no remote integration capability response.
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/quick-connect-returned-inventory.png` });
});

test("SSH config duplicate choices use or edit the existing record without importing over it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 780 });
  await page.goto("/tests/browser/servers.html?sshFixture=1");
  await page
    .getByRole("list", { name: "Servers" })
    .getByRole("button", { name: /Existing SSH target/ })
    .click();
  await page
    .getByRole("navigation", { name: "Server tools" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "SSH settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "SSH settings", exact: true });
  await dialog.getByRole("button", { name: "Import SSH config", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "SSH config", exact: true })
    .fill("Host imported\n HostName duplicate.example.invalid\n User fixture");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(dialog).toContainText("This endpoint is already saved");
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Skip", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Edit existing", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit SSH server", exact: true });
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Existing SSH target",
  );
  expect(
    await page.evaluate(() =>
      (window as unknown as { serversFixtureCalls: string[] }).serversFixtureCalls.includes(
        "server_ssh_save",
      ),
    ),
  ).toBe(false);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/config-duplicate-existing-editor.png` });
});

for (const theme of ["light", "dark"])
  test(`narrow new SSH forms visual review ${theme} 390px`, async ({ page }) => {
    const folder = "temp/verification/2026-10-18-termius-personal/frontend-final/narrow-visual";
    await mkdir(folder, { recursive: true });
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?terminalWorkspace=1&theme=${theme}`);
    await page.getByRole("button", { name: "Quick connect", exact: true }).click();
    const quick = page.getByRole("dialog", { name: "Quick connect", exact: true });
    await quick
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Production deployment connection with a deliberately long name");
    const address = "application.production.example.invalid";
    await quick.getByRole("textbox", { name: "Host", exact: true }).fill(address);
    await quick.getByRole("textbox", { name: "SSH user", exact: true }).fill("deployment");
    await openAdvancedSshSettings(quick);
    await quick.locator("summary").filter({ hasText: "Use a key file path" }).click();
    await quick
      .getByRole("textbox", { name: "Identity file", exact: true })
      .fill("C:/Users/fixture/ssh/production-deployment-identity-ed25519");
    await quick
      .getByRole("textbox", { name: "Jump host", exact: true })
      .fill("operations@bastion.production.example.invalid:2222");
    await expect(quick.locator('[aria-label="Endpoint preview"]')).toContainText(
      `deployment@${address}:22`,
    );
    await expect(quick.locator('[aria-label="Endpoint preview"]')).toContainText(
      "bastion.production.example.invalid:2222",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${folder}/quick-${theme}-390-preview.png` });
    await quick.getByRole("textbox", { name: "Host", exact: true }).fill("-invalid-host");
    await quick.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(quick.getByRole("alert")).toHaveText("Enter a valid SSH endpoint.");
    await expect(quick.getByRole("button", { name: "Connect", exact: true })).toBeEnabled();
    await page.screenshot({ path: `${folder}/quick-${theme}-390-error.png` });
    await quick.getByRole("textbox", { name: "Host", exact: true }).fill(address);
    await quick.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("tab", {
        name: "Production deployment connection with a deliberately long name",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/tests/browser/servers.html?sshFixture=1&longLabels=1&theme=${theme}`);
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.getByRole("button", { name: "SSH settings", exact: true }).click();
    const config = page.getByRole("dialog", { name: "SSH settings", exact: true });
    await config.getByRole("button", { name: "Import SSH config", exact: true }).click();
    await config
      .getByRole("textbox", { name: "SSH config", exact: true })
      .fill("Host imported\n HostName duplicate.example.invalid\n User fixture");
    await config.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(config.getByRole("button", { name: "Use existing", exact: true })).toBeVisible();
    await expect(config.getByRole("button", { name: "Edit existing", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${folder}/duplicate-${theme}-390-choices.png` });
  });

test("certificate and ordered jump chain edit retains canonical ID and previews an existing import", async ({
  page,
}) => {
  const folder = "temp/verification/2026-10-18-termius-personal/remaining-wave1-ui/browser";
  await page.setViewportSize({ width: 390, height: 780 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/servers.html?sshFixture=1&chainCertificate=1");
  await page
    .getByRole("list", { name: "Servers" })
    .getByRole("button", { name: /Existing SSH target/ })
    .click();
  await page.getByRole("button", { name: "Edit SSH server", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit SSH server", exact: true });
  await openAdvancedSshSettings(editor);
  await expect(editor.getByRole("textbox", { name: "Jump host", exact: true })).toHaveValue(
    "legacy@first.example.invalid:22",
  );
  await editor
    .getByRole("textbox", { name: "Public SSH certificate file", exact: true })
    .fill("C:/keys/public-user-certificate");
  expect(
    await page.evaluate(
      () =>
        (window as any).serversFixtureRequests.filter(
          (entry: any) => entry.command === "ssh_certificate_inspect",
        ).length,
    ),
  ).toBe(0);
  await editor.getByRole("button", { name: "Inspect certificate", exact: true }).click();
  await editor.locator("summary").filter({ hasText: "Certificate details" }).click();
  await expect(editor.getByText("SHA256:FixturePublicKey", { exact: true })).toBeVisible();
  await expect(editor.getByText("fixture-user", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Add jump host", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Jump host 2", exact: true })
    .fill("operator@second.example.invalid:2222");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor
    .getByRole("textbox", { name: "Public SSH certificate file", exact: true })
    .scrollIntoViewIfNeeded();
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/certificate-two-hop-editor-390.png` });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = await page.evaluate(
    () =>
      (
        window as unknown as {
          serversFixtureRequests: { command: string; input: Record<string, unknown> }[];
        }
      ).serversFixtureRequests.find((record) => record.command === "server_ssh_save")!.input,
  );
  expect(saved.id).toBe("ssh-duplicate");
  expect(saved.endpoint).toMatchObject({
    certificateFile: "C:/keys/public-user-certificate",
    jumpHosts: ["legacy@first.example.invalid:22", "operator@second.example.invalid:2222"],
  });
  expect((saved.endpoint as Record<string, unknown>).jumpHost).toBeUndefined();
  await page
    .getByRole("navigation", { name: "Server tools" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "SSH settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "SSH settings", exact: true });
  await settings.getByRole("button", { name: "Import SSH config", exact: true }).click();
  await settings
    .getByRole("textbox", { name: "SSH config", exact: true })
    .fill(
      "Host imported\n CertificateFile C:/keys/public-user-certificate\n ProxyJump legacy@first.example.invalid:22,operator@second.example.invalid:2222",
    );
  await settings.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(settings).toContainText(
    "Public SSH certificate file: C:/keys/public-user-certificate",
  );
  await expect(settings).toContainText(
    "legacy@first.example.invalid:22 → operator@second.example.invalid:2222",
  );
  await expect(settings.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Use existing", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${folder}/certificate-two-hop-existing-import-390.png` });
});
for (const theme of ["light", "dark"]) {
  test(`PowerShell suggestions opens a separate explicit tab ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?terminalWorkspace=1&theme=${theme}`);
    await page.getByRole("button", { name: "Quick connect", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Quick connect", exact: true });
    await dialog
      .getByRole("textbox", { name: "Host", exact: true })
      .fill("windows.example.invalid");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Terminal · More actions", exact: true }).click();
    await page.getByRole("button", { name: "About shell suggestions", exact: true }).click();
    await expect(page.getByText(/A new session starts with -NoProfile/)).toBeVisible();
    await page.keyboard.press("Escape");
    if (!(await page.getByRole("button", { name: "Shell suggestions", exact: true }).isVisible())) {
      await page.getByRole("button", { name: "Terminal · More actions", exact: true }).click();
    }
    await page.getByRole("button", { name: "Shell suggestions", exact: true }).click();
    const option = page.getByRole("menuitem", { name: /PowerShell suggestions/ });
    await expect(option).toBeVisible();
    const folder = "temp/verification/2026-10-18-termius-goal/powershell-browser";
    await mkdir(folder, { recursive: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${folder}/${theme}-390-mode-review.png` });
    await option.click();
    await expect(
      page.getByRole("tab", { name: "windows.example.invalid:22", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "windows.example.invalid:22 · PowerShell 7", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).serversFixtureRequests.filter(
              (r: any) => r.command === "ssh_terminal_quick_spawn",
            ).length,
        ),
      )
      .toBe(2);
    const calls = await page.evaluate(
      () =>
        (window as any).serversFixtureRequests as {
          command: string;
          input: Record<string, unknown>;
        }[],
    );
    expect(
      calls
        .filter((r) => r.command === "ssh_terminal_quick_spawn")
        .map((r) => r.input.shellIntegration),
    ).toEqual([undefined, "powershell"]);
    expect(calls.some((r) => r.command === "pty_write" || r.command === "pty_kill")).toBe(false);
  });

  test(`SOCKS5 saves without starting and preserves local draft at 390px ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?forwardFixture=1&theme=${theme}`);
    await page.locator("summary").filter({ hasText: "Port forwarding" }).click();
    await page.locator("summary").filter({ hasText: "Add forwarding rule" }).click();
    await page
      .getByRole("textbox", { name: "Destination host", exact: true })
      .fill("database.example.invalid");
    await page.getByRole("spinbutton", { name: "Destination port", exact: true }).fill("5432");
    await page.getByRole("radio", { name: "SOCKS5", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Development proxy");
    await page.getByRole("spinbutton", { name: "Local port", exact: true }).fill("1080");
    await page.getByRole("button", { name: "Save rule", exact: true }).click();
    await expect(page.getByText("Development proxy", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).serversFixtureRequests.filter(
            (r: any) => r.command === "ssh_forward_start",
          ).length,
      ),
    ).toBe(0);
    await page.getByRole("radio", { name: "Local", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Destination host", exact: true })).toHaveValue(
      "database.example.invalid",
    );
    await expect(
      page.getByRole("spinbutton", { name: "Destination port", exact: true }),
    ).toHaveValue("5432");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByText("Running", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).serversFixtureRequests.find((r: any) => r.command === "ssh_forward_start")
            .input,
      ),
    ).toMatchObject({
      connectionId: "ssh-duplicate",
      kind: "dynamic",
      localPort: 1080,
      targetHost: "",
      targetPort: 0,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const folder = "temp/verification/2026-10-18-termius-goal/forward-restore-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/socks5-${theme}-390.png` });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  });

  test(`cold SSH restore waits for explicit Connect at 390px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/servers.html?sshFixture=1&terminalWorkspace=1&serverRestoreFixture=1&theme=${theme}`,
    );
    await expect(page.getByRole("switch", { name: "Remember saved SSH tabs" })).toBeChecked();
    const preview = page
      .locator("details")
      .filter({ hasText: "Restored tabs reconnect only when you choose Connect." });
    await expect(
      preview.getByText("fixture@duplicate.example.invalid:22", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).serversFixtureRequests.filter(
            (r: any) => r.command === "ssh_terminal_spawn" || r.command === "pty_write",
          ).length,
      ),
    ).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const folder = "temp/verification/2026-10-18-termius-goal/forward-restore-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/restore-${theme}-390.png` });
    await preview.getByRole("button", { name: "Connect", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).serversFixtureRequests.filter(
              (r: any) => r.command === "ssh_terminal_spawn",
            ).length,
        ),
      )
      .toBe(1);
    const input = await page.evaluate(
      () =>
        (window as any).serversFixtureRequests.find((r: any) => r.command === "ssh_terminal_spawn")
          .input,
    );
    expect(input.connectionId).toBe("ssh-duplicate");
    expect(input.id).not.toBe("old-ui-reference");
    expect(input.shellIntegration).toBeUndefined();
    expect(
      await page.evaluate(
        () =>
          (window as any).serversFixtureRequests.filter((r: any) => r.command === "pty_write")
            .length,
      ),
    ).toBe(0);
  });
}

for (const theme of ["light", "dark"]) {
  test(`Automatic remote suggestions insert one line without running it ${theme} 390px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?autocompleteFixture&theme=${theme}`);
    const input = page.locator(".xterm-helper-textarea");
    await expect(input).toBeAttached({ timeout: 30_000 });
    const emit = async (status: string, promptReady: boolean) =>
      page.evaluate(
        ({ status, promptReady }) => {
          (window as any).serversFixtureEmit("ssh-shell-state", {
            id: "autocomplete-fixture",
            status,
            promptReady,
            shell: "bash",
            user: "fixture",
            host: "remote.example.invalid",
          });
        },
        { status, promptReady },
      );
    const requests = () =>
      page.evaluate(
        () =>
          (window as any).serversFixtureRequests as {
            command: string;
            input: Record<string, unknown>;
          }[],
      );
    const count = async () =>
      (await requests()).filter((r) => r.command === "ssh_terminal_suggestions_request").length;
    await page.getByRole("button", { name: "Terminal · More actions", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Suggestion settings" }).click();
    const automatic = page.getByRole("switch", { name: "Show suggestions while typing" });
    await expect(automatic).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await emit("ready", true);
    await input.focus();
    await page.keyboard.type("doc");
    await page.waitForTimeout(350);
    expect(await count()).toBe(0);
    await page.getByRole("button", { name: "Terminal · More actions", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Suggestion settings" }).click();
    await automatic.click();
    await page.keyboard.press("Escape");
    await input.focus();
    await page.keyboard.type("doc");
    const preview = page.getByLabel("Remote suggestion preview", { exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("option", { name: "docker", exact: true })).toBeVisible();
    await expect(input).toBeFocused();
    expect(
      (await requests()).find((r) => r.command === "ssh_terminal_suggestions_request")?.input
        .source,
    ).toBe("commands");
    const beforeNavigation = await count();
    const beforeNavigationWrites = (await requests()).filter(
      (r) => r.command === "pty_write",
    ).length;
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter", "Control+r"]) await page.keyboard.press(key);
    await expect(input).toBeFocused();
    await expect
      .poll(async () =>
        (await requests())
          .filter((r) => r.command === "pty_write")
          .slice(beforeNavigationWrites)
          .map((r) => r.input.data),
      )
      .toEqual(["\u001b[A", "\u001b[B", "\t", "\r", "\u0012"]);
    expect(
      (await requests()).filter((r) => r.command === "ssh_terminal_suggestion_accept"),
    ).toHaveLength(0);
    await page.waitForTimeout(350);
    expect(await count()).toBe(beforeNavigation);
    await expect(preview).toBeHidden();
    await page.keyboard.type("c");
    await expect(preview).toBeVisible();
    const beforeAccept = (await requests()).filter((r) => r.command === "pty_write").length;
    await preview.getByRole("option", { name: "docker", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await requests()).filter((r) => r.command === "ssh_terminal_suggestion_accept").length,
      )
      .toBe(1);
    expect((await requests()).filter((r) => r.command === "pty_write")).toHaveLength(beforeAccept);
    await expect(input).toBeFocused();
    await page.keyboard.press("Control+Space");
    await expect(page.getByLabel("Remote suggestion selection", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toBeFocused();
    await emit("unavailable", false);
    const blocked = await count();
    await page.keyboard.type("x");
    await page.waitForTimeout(350);
    expect(await count()).toBe(blocked);
    // Semantic no-match at a safe prompt must not latch autocomplete off.
    await emit("unavailable", true);
    await page.evaluate(() => (window as any).serversFixtureSuggestion("doc", true));
    await page.keyboard.type("y");
    await expect.poll(count).toBe(blocked + 1);
    await page.evaluate(() => (window as any).serversFixtureSuggestion("doc", false));
    await page.keyboard.type("z");
    await expect(preview).toBeVisible();
    await expect.poll(count).toBe(blocked + 2);
    const beforeIme = await count();
    await input.dispatchEvent("compositionstart", { data: "日" });
    await page.keyboard.type("ime");
    await page.waitForTimeout(350);
    expect(await count()).toBe(beforeIme);
    await input.dispatchEvent("compositionend", { data: "日" });
    await page.keyboard.type("x");
    await expect(preview).toBeVisible();
    const folder = "temp/verification/2026-10-21-ssh-reliability/autocomplete-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-passive.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() =>
      (window as any).serversFixtureEmit("pty-data", {
        id: "autocomplete-fixture",
        data: btoa("\u001b[?1049h"),
      }),
    );
    await expect(preview).toBeHidden();
    const beforeAlternate = await count();
    await page.keyboard.type("topkeys");
    await page.waitForTimeout(350);
    expect(await count()).toBe(beforeAlternate);
  });
}

for (const theme of ["light", "dark"]) {
  test(`Per-hop SSH editor preserves independent drafts ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?sshFixture&chainCertificate&theme=${theme}`);
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    await page.getByRole("button", { name: "Edit SSH server", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit SSH server", exact: true });
    await openAdvancedSshSettings(editor);
    const toggle = editor.getByRole("switch", { name: "Per-hop SSH policy", exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(
      editor.getByRole("textbox", { name: "Jump host 1: Host", exact: true }),
    ).toHaveValue("");
    await editor
      .getByRole("textbox", { name: "Jump host 1: Host", exact: true })
      .fill("first.example.invalid");
    await editor.getByRole("textbox", { name: "Jump host 1: User", exact: true }).fill("operator");
    await editor.getByRole("textbox", { name: "Jump host 1: Port", exact: true }).fill("2222");
    await editor
      .locator("summary")
      .filter({ hasText: "Hop identity and trust references" })
      .click();
    await editor
      .getByRole("region", { name: "Per-hop SSH policy", exact: true })
      .locator("summary")
      .filter({ hasText: "Use a key file path" })
      .first()
      .click();
    await editor
      .getByRole("textbox", { name: "Jump host 1: Identity file", exact: true })
      .fill("C:/keys/first hop key");
    await editor
      .getByRole("textbox", { name: "Jump host 1: Certificate file", exact: true })
      .fill("C:/keys/first hop certificate.pub");
    await editor
      .getByRole("textbox", { name: "Jump host 1: Known hosts file", exact: true })
      .fill("C:/trust/first hop known hosts");
    await toggle.click();
    await expect(editor.getByRole("textbox", { name: "Jump host", exact: true })).toHaveValue(
      "legacy@first.example.invalid:22",
    );
    await toggle.click();
    await expect(
      editor.getByRole("textbox", { name: "Jump host 1: Host", exact: true }),
    ).toHaveValue("first.example.invalid");
    await editor
      .locator("summary")
      .filter({ hasText: "Hop identity and trust references" })
      .click();
    await editor
      .getByRole("region", { name: "Per-hop SSH policy", exact: true })
      .locator("details:not([open]) > summary")
      .filter({ hasText: "Use a key file path" })
      .first()
      .click();
    await expect(
      editor.getByRole("textbox", { name: "Jump host 1: Identity file", exact: true }),
    ).toHaveValue("C:/keys/first hop key");
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/jump-policy-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-editor.png` });
    expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const saved = await page.evaluate(
      () =>
        (window as any).serversFixtureRequests.find((r: any) => r.command === "server_ssh_save")
          .input,
    );
    expect(saved.id).toBe("ssh-duplicate");
    expect(saved.endpoint.jumpPolicies).toEqual([
      {
        host: "first.example.invalid",
        user: "operator",
        port: 2222,
        identityFile: "C:/keys/first hop key",
        certificateFile: "C:/keys/first hop certificate.pub",
        knownHostsFile: "C:/trust/first hop known hosts",
      },
    ]);
    expect(saved.endpoint.jumpHost).toBeUndefined();
    expect(saved.endpoint.jumpHosts).toBeUndefined();
    expect(
      await page.evaluate(() =>
        (window as any).serversFixtureRequests.some(
          (r: any) =>
            r.command === "ssh_terminal_spawn" || r.command === "ssh_terminal_quick_spawn",
        ),
      ),
    ).toBe(false);
  });
}

for (const theme of ["light", "dark"]) {
  test(`Agent forwarding explicit review and ephemeral launch ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/servers.html?sshFixture&terminalWorkspace&agentReviewFixture&theme=${theme}`,
    );
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    const nativeRequests = () =>
      page.evaluate(
        () =>
          (window as any).serversFixtureRequests as {
            command: string;
            input: Record<string, unknown>;
          }[],
      );
    expect((await nativeRequests()).some((r) => r.command === "ssh_agent_forwarding_review")).toBe(
      false,
    );
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Forward SSH agent", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Forward SSH agent", exact: true });
    await expect(modal).toContainText("fixture@duplicate.example.invalid:22");
    await expect(modal).toContainText("remote target can use identities");
    const approve = modal.getByRole("button", { name: "Approve and connect", exact: true });
    await expect(approve).toBeEnabled();
    expect((await nativeRequests()).some((r) => r.command === "ssh_terminal_spawn")).toBe(false);
    await page.evaluate(() => (window as any).serversFixtureAgentTarget());
    await expect(approve).toBeDisabled();
    await expect(modal).toContainText("target changed");
    expect(
      (await nativeRequests()).filter((r) => r.command === "ssh_agent_forwarding_review"),
    ).toHaveLength(1);
    await modal.getByRole("button", { name: "Request new review", exact: true }).click();
    await expect(modal).toContainText("fixture@changed.example.invalid:22");
    await expect(approve).toBeEnabled();
    await page.evaluate(() => (window as any).serversFixtureAgentMode("expired"));
    await modal.getByRole("button", { name: "Request new review", exact: true }).click();
    await expect(approve).toBeDisabled();
    await expect(modal).toContainText("expired or is unavailable");
    await page.evaluate(() => (window as any).serversFixtureAgentMode("error"));
    await modal.getByRole("button", { name: "Request new review", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("Synthetic agent unavailable");
    await page.evaluate(() => (window as any).serversFixtureAgentMode("ready"));
    await modal.getByRole("button", { name: "Request new review", exact: true }).click();
    await expect(approve).toBeEnabled();
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/agent-review-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-review.png` });
    expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await approve.click();
    await expect(modal).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await nativeRequests()).filter((r) => r.command === "ssh_terminal_spawn").length,
      )
      .toBe(1);
    const spawn = (await nativeRequests()).find((r) => r.command === "ssh_terminal_spawn")!.input;
    expect(spawn.connectionId).toBe("ssh-duplicate");
    expect(spawn.agentForwardingReviewId).toMatch(/^synthetic-agent-review-/);
    expect(spawn.shellIntegration).toBeUndefined();
    expect(
      (await nativeRequests()).some(
        (r) => r.command === "server_ssh_save" || r.command === "pty_write",
      ),
    ).toBe(false);
  });
}

for (const theme of ["light", "dark"]) {
  test(`HTTP CONNECT profile roundtrip and route conflict ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?sshFixture&httpProxyFixture&theme=${theme}`);
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    await expect(
      page.getByText("HTTP CONNECT: proxy.example.invalid:8080", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit SSH server", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit SSH server", exact: true });
    await expect(
      editor.getByText("HTTP CONNECT: proxy.example.invalid:8080", { exact: true }),
    ).toBeVisible();
    const openProxy = () =>
      editor.locator("summary").filter({ hasText: "Connection proxy" }).click();
    await openProxy();
    const enabled = editor.getByRole("switch", { name: "HTTP CONNECT upstream", exact: true });
    await expect(enabled).toBeChecked();
    await expect(editor.getByRole("textbox", { name: "Proxy host", exact: true })).toHaveValue(
      "proxy.example.invalid",
    );
    await expect(editor.getByRole("textbox", { name: "Proxy port", exact: true })).toHaveValue(
      "8080",
    );
    await editor
      .getByRole("textbox", { name: "Proxy host", exact: true })
      .fill("edited-proxy.example.invalid");
    await editor.getByRole("textbox", { name: "Proxy port", exact: true }).fill("3128");
    await enabled.click();
    await expect(editor.getByRole("textbox", { name: "Proxy host", exact: true })).toHaveCount(0);
    await enabled.click();
    await expect(editor.getByRole("textbox", { name: "Proxy host", exact: true })).toHaveValue(
      "edited-proxy.example.invalid",
    );
    await openAdvancedSshSettings(editor);
    await editor
      .getByRole("textbox", { name: "Jump host", exact: true })
      .fill("hop.example.invalid");
    await expect(editor.getByRole("status")).toContainText(
      "Choose either an HTTP proxy or a jump chain",
    );
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("valid SSH endpoint");
    expect(
      await page.evaluate(() =>
        (window as any).serversFixtureRequests.some((r: any) => r.command === "server_ssh_save"),
      ),
    ).toBe(false);
    await editor.getByRole("textbox", { name: "Jump host", exact: true }).fill("");
    await editor.getByRole("textbox", { name: "Proxy host", exact: true }).scrollIntoViewIfNeeded();
    await expect(editor).toContainText(
      "Basic credentials require separate approval for each operation.",
    );
    expect(await editor.locator('input[type="password"]').count()).toBe(0);
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/http-proxy-browser";
    await mkdir(folder, { recursive: true });

    expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const saved = () =>
      page.evaluate(() =>
        (window as any).serversFixtureRequests
          .filter((r: any) => r.command === "server_ssh_save")
          .map((r: any) => r.input),
      );
    expect((await saved())[0]).toMatchObject({
      id: "ssh-duplicate",
      endpoint: { httpProxy: { host: "edited-proxy.example.invalid", port: 3128 } },
    });
    await page.getByRole("button", { name: "Edit SSH server", exact: true }).click();
    await openProxy();
    await expect(enabled).toBeChecked();
    await expect(editor.getByRole("textbox", { name: "Proxy port", exact: true })).toHaveValue(
      "3128",
    );
    await page.screenshot({ path: `${folder}/${theme}-390-profile.png` });
    await enabled.click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await saved())[1].endpoint.httpProxy).toBeUndefined();
    expect(
      await page.evaluate(() =>
        (window as any).serversFixtureRequests.some(
          (r: any) =>
            r.command === "ssh_terminal_spawn" || r.command === "ssh_terminal_quick_spawn",
        ),
      ),
    ).toBe(false);
  });
}

for (const theme of ["light", "dark"]) {
  test(`SSH group inheritance review and CAS ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/servers.html?sshFixture&groupFixture&terminalWorkspace&theme=${theme}`,
    );
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    const nativeRequests = () =>
      page.evaluate(
        () =>
          (window as any).serversFixtureRequests as {
            command: string;
            input: Record<string, unknown>;
          }[],
      );
    const launches = async () =>
      (await nativeRequests()).filter(
        (r) => r.command === "ssh_terminal_spawn" || r.command === "ssh_terminal_quick_spawn",
      );
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.getByRole("button", { name: "SSH group settings", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "SSH group settings", exact: true });
    const selection = modal.getByRole("button", { name: /^SSH group:/ });
    await expect(selection).toContainText("No inherited group");
    await expect(modal.getByRole("checkbox", { name: "SSH user", exact: true })).not.toBeChecked();
    expect(await launches()).toHaveLength(0);
    expect((await nativeRequests()).some((r) => r.command === "server_ssh_inheritance_set")).toBe(
      false,
    );
    await selection.click();
    await page.getByRole("option", { name: "Personal defaults", exact: true }).click();
    await modal.getByRole("checkbox", { name: "SSH user", exact: true }).check();
    await modal.getByRole("checkbox", { name: "Remote environment", exact: true }).check();
    const apply = modal.getByRole("button", { name: "Apply inheritance", exact: true });
    await expect(apply).toBeDisabled();
    const preview = modal.getByRole("button", {
      name: "Preview effective configuration",
      exact: true,
    });
    await preview.click();
    const effective = modal.getByRole("region", {
      name: "Effective SSH configuration",
      exact: true,
    });
    await expect(effective).toContainText("group-user@duplicate.example.invalid:22");
    await expect(effective).toContainText("Group · Personal defaults · r1");
    await expect(effective).toContainText("Connection");
    await effective.locator("summary").click();
    await expect(effective).toContainText("APP_STAGE=prod");
    await expect(apply).toBeEnabled();
    // Group revision changes after preview: native CAS refuses it; draft stays selected.
    await page.evaluate(() => (window as any).serversFixtureGroupRevision());
    await apply.click();
    await expect(modal.getByRole("alert")).toContainText("Synthetic configuration changed");
    await expect(modal.getByRole("checkbox", { name: "SSH user", exact: true })).toBeChecked();
    await preview.click();
    await expect(effective).toContainText("r2");
    await modal.getByRole("checkbox", { name: "SSH port", exact: true }).check();
    await expect(apply).toBeDisabled();
    await modal.getByRole("checkbox", { name: "SSH port", exact: true }).uncheck();
    await preview.click();
    await effective.locator("summary").click();
    await apply.click();
    await expect(modal.getByRole("status")).toContainText("SSH inheritance updated");
    const record = await page.evaluate(() => (window as any).serversFixtureRecords()[0]);
    expect(record.sshEndpoint).toMatchObject({ user: "fixture", port: 22 });
    expect(record.metadata.group).toBe("Legacy display label");
    expect(record.metadata.sshInheritance).toEqual({
      groupId: "fixture-group",
      fields: ["user"],
      environment: true,
    });
    expect(await launches()).toHaveLength(0);
    // Group edits have their own CAS, do not silently rebind or launch a terminal.
    await modal.getByRole("button", { name: "Edit group", exact: true }).click();
    await modal.getByRole("textbox", { name: "Group name", exact: true }).fill("Edited defaults");
    await modal.getByRole("button", { name: "Save group", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("Synthetic group revision changed");
    await expect(modal.getByRole("textbox", { name: "Group name", exact: true })).toHaveValue(
      "Edited defaults",
    );
    await modal.getByRole("button", { name: "Close editor", exact: true }).click();
    await preview.click();
    await effective.locator("summary").click();
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/group-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-inheritance.png` });
    expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Connect via SSH", exact: true }).click();
    const connect = page.getByRole("dialog", { name: "Review SSH configuration", exact: true });
    await expect(connect).toContainText("group-user@duplicate.example.invalid:22");
    expect(await launches()).toHaveLength(0);
    await connect.locator("summary").click();
    await expect(connect).toContainText("APP_STAGE");
    await expect(connect).toContainText("prod");
    await page.screenshot({ path: `${folder}/${theme}-390-connect-review.png` });
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    await expect.poll(async () => (await launches()).length).toBe(1);
    expect((await launches())[0].input.expectedConfigurationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect((await nativeRequests()).some((r) => r.command === "pty_write")).toBe(false);
  });
}

for (const theme of ["light", "dark"]) {
  test(`SSH runbook explicit review, ambiguous start and cancel ${theme} 390px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?sshFixture&runbookFixture&theme=${theme}`);
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    const requests = () =>
      page.evaluate(
        () =>
          (window as any).serversFixtureRequests as {
            command: string;
            input: Record<string, unknown>;
          }[],
      );
    const starts = async () =>
      (await requests()).filter((item) => item.command === "ssh_runbook_start");
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Automation", exact: true })
      .click();
    await page.getByRole("button", { name: "SSH runbooks", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "SSH runbooks", exact: true });
    expect(await starts()).toHaveLength(0);
    expect((await requests()).some((item) => item.command === "ssh_runbook_preview")).toBe(false);
    await modal.getByRole("button", { name: /^Runbook:/ }).click();
    await page.getByRole("option", { name: "Inspect remote state · r1", exact: true }).click();
    await modal
      .getByRole("textbox", { name: "Runbook name", exact: true })
      .fill("Reviewed inspection");
    await modal.getByRole("button", { name: "Save runbook", exact: true }).click();
    await expect(modal.getByRole("button", { name: /^Runbook:/ })).toContainText("r2");
    expect(await starts()).toHaveLength(0);
    await modal.getByRole("button", { name: "Review execution", exact: true }).click();
    const review = modal.getByRole("region", { name: "SSH execution review", exact: true });
    await expect(review).toContainText("fixture@duplicate.example.invalid:22");
    await expect(review).toContainText("$HOME");
    await modal.getByRole("textbox", { name: "Concurrency", exact: true }).fill("2");
    await expect(review).toHaveCount(0);
    await expect(
      modal.getByRole("button", { name: "Review execution", exact: true }),
    ).toBeDisabled();
    await modal.getByRole("textbox", { name: "Concurrency", exact: true }).fill("1");
    await modal.getByRole("button", { name: "Review execution", exact: true }).click();
    await review.locator("summary").filter({ hasText: "Connection details" }).click();
    await expect(review).toContainText("Identity file");
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/runbook-browser";
    await mkdir(folder, { recursive: true });
    await review
      .getByRole("button", { name: "Approve and run", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/${theme}-390-review.png` });
    expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.evaluate(() => (window as any).serversFixtureRunbookMode("ambiguous"));
    await review.getByRole("button", { name: "Approve and run", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("Synthetic start response interrupted");
    await expect.poll(async () => (await starts()).length).toBe(1);
    const runId = (await starts())[0].input.runId;
    const status = modal.getByRole("region", { name: "SSH execution status", exact: true });
    await expect(status).toContainText(String(runId));
    await expect(modal.getByRole("textbox", { name: "SSH script", exact: true })).toBeDisabled();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Automation", exact: true })
      .click();
    await page.getByRole("button", { name: "SSH runbooks", exact: true }).click();
    await expect(status).toContainText(String(runId));
    expect(await starts()).toHaveLength(1);
    await status.getByRole("button", { name: "Cancel target", exact: true }).click();
    await expect(status).toContainText("Cancelled");
    await expect(status).toContainText("The remote script may still be running");
    await expect(
      status.getByText("cancel_requested_remote_outcome_unknown", { exact: true }),
    ).not.toBeVisible();
    await status.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/${theme}-390-status.png` });
    expect((await starts())[0].input).toMatchObject({
      automationId: "fixture-book",
      expectedRevision: 2,
      reviewId: expect.stringMatching(/^synthetic-runbook-review-/),
    });
    expect(
      (await requests()).some(
        (item) => item.command === "pty_write" || item.command === "ssh_terminal_spawn",
      ),
    ).toBe(false);
  });
}

for (const theme of ["light", "dark"]) {
  test(`HTTP proxy Basic approval stays ephemeral ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/servers.html?sshFixture&httpProxyFixture&proxyAuthFixture&terminalWorkspace&theme=${theme}`,
    );
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    const requests = () =>
      page.evaluate(
        () =>
          (window as any).serversFixtureRequests as {
            command: string;
            input: Record<string, unknown>;
          }[],
      );
    const calls = async (command: string) =>
      (await requests()).filter((item) => item.command === command);
    const auth = page.getByRole("dialog", { name: "HTTP proxy authentication", exact: true });
    const chooseBasic = async () => {
      await auth.getByRole("radio", { name: "Basic", exact: true }).click();
      await expect(auth.getByRole("textbox", { name: "Proxy username", exact: true })).toHaveValue(
        "",
      );
      await expect(auth.locator('input[type="password"]')).toHaveValue("");
    };
    const fillBasic = async () => {
      await auth
        .getByRole("textbox", { name: "Proxy username", exact: true })
        .fill("synthetic-user");
      await auth.locator('input[type="password"]').fill("synthetic-password");
      await auth.getByRole("checkbox").check();
    };
    expect(await calls("ssh_http_proxy_credentials_approve")).toHaveLength(0);
    expect(await calls("ssh_forward_start")).toHaveLength(0);
    await page.getByRole("button", { name: "Files", exact: true }).click();
    const files = page.getByRole("dialog", { name: "SFTP files", exact: true });
    await files.getByRole("button", { name: "Open", exact: true }).click();
    await expect(auth).toBeVisible();
    await expect(auth).toContainText("HTTP CONNECT: proxy.example.invalid:8080");
    await expect(auth).toContainText("fixture@duplicate.example.invalid:22");
    await auth.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await calls("ssh_sftp_list")).toHaveLength(0);
    await files.getByRole("button", { name: "Open", exact: true }).click();
    await chooseBasic();
    const approve = auth.getByRole("button", { name: "Approve this operation", exact: true });
    await expect(approve).toBeDisabled();
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/proxy-auth-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-approval.png` });
    expect(await auth.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.evaluate(() => (window as any).serversFixtureProxyMode("stale"));
    await fillBasic();
    await approve.click();
    await expect(auth.getByRole("alert")).toContainText("Synthetic proxy target changed");
    await expect(auth.locator('input[type="password"]')).toHaveValue("");
    await expect(approve).toBeDisabled();
    expect(await calls("ssh_sftp_list")).toHaveLength(0);
    await page.evaluate(() => (window as any).serversFixtureProxyMode("ready"));
    await fillBasic();
    await approve.click();
    await expect(auth).toHaveCount(0);
    await expect.poll(async () => (await calls("ssh_sftp_list")).length).toBe(1);
    const listed = (await calls("ssh_sftp_list"))[0].input;
    expect(listed.httpProxyTicketId).toMatch(/^synthetic-proxy-ticket-/);
    const listApproval = (await calls("ssh_http_proxy_credentials_approve")).at(-1)!.input;
    expect(listApproval.operation).toMatchObject({
      kind: "sftpList",
      path: ".",
      operationId: listed.operationId,
    });
    expect(listApproval.expectedEndpoint).toMatchObject({
      host: "duplicate.example.invalid",
      httpProxy: { host: "proxy.example.invalid", port: 8080 },
    });
    await files.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Port forwarding", exact: true })
      .click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await auth
      .getByRole("button", { name: "Continue without authentication", exact: true })
      .click();
    await expect.poll(async () => (await calls("ssh_forward_start")).length).toBe(1);
    expect((await calls("ssh_forward_start"))[0].input.httpProxyTicketId).toBeUndefined();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await chooseBasic();
    await fillBasic();
    await approve.click();
    await expect.poll(async () => (await calls("ssh_forward_start")).length).toBe(2);
    const forwarded = (await calls("ssh_forward_start"))[1].input;
    expect(forwarded.httpProxyTicketId).toMatch(/^synthetic-proxy-ticket-/);
    expect(
      (await calls("ssh_http_proxy_credentials_approve")).at(-1)!.input.operation,
    ).toMatchObject({
      kind: "forward",
      id: forwarded.id,
      forwardKind: "local",
      localPort: 15432,
      targetHost: "db.internal",
      targetPort: 5432,
    });
    await page.getByRole("button", { name: "Connect via SSH", exact: true }).click();
    await expect(auth).toBeVisible();
    await auth.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await calls("ssh_terminal_spawn")).toHaveLength(0);
    await page.getByRole("button", { name: "Connect via SSH", exact: true }).click();
    await chooseBasic();
    await fillBasic();
    await approve.click();
    await expect.poll(async () => (await calls("ssh_terminal_spawn")).length).toBe(1);
    const spawned = (await calls("ssh_terminal_spawn"))[0].input;
    expect(spawned.httpProxyTicketId).toMatch(/^synthetic-proxy-ticket-/);
    expect(
      (await calls("ssh_http_proxy_credentials_approve")).at(-1)!.input.operation,
    ).toMatchObject({ kind: "terminal", id: spawned.id });
    const records = await page.evaluate(() => (window as any).serversFixtureRecords());
    expect(JSON.stringify(records)).not.toContain("synthetic-password");
    expect(JSON.stringify(records)).not.toContain("httpProxyTicketId");
    expect(
      (await calls("ssh_http_proxy_credentials_approve")).every(
        (item) => item.input.password === "[redacted]",
      ),
    ).toBe(true);
    expect(await calls("pty_write")).toHaveLength(0);
  });
}

for (const theme of ["light", "dark"]) {
  test(`SSH scheduled pending review and target Basic approval ${theme} 390px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/servers.html?sshFixture&runbookFixture&runbookPendingFixture&httpProxyFixture&proxyAuthFixture&theme=${theme}`,
    );
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Automation", exact: true })
      .click();
    await page.getByRole("button", { name: "SSH runbooks", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "SSH runbooks", exact: true });
    const calls = (command: string) =>
      page.evaluate(
        (name) =>
          (window as any).serversFixtureRequests.filter((item: any) => item.command === name),
        command,
      );
    await expect(modal.getByRole("region", { name: "Pending execution reviews" })).toContainText(
      "Pending review",
    );
    expect(await calls("ssh_runbook_start")).toHaveLength(0);
    expect(await calls("ssh_runbook_preview")).toHaveLength(0);
    await modal.getByRole("button", { name: "Review", exact: true }).click();
    await modal.getByRole("button", { name: "Review execution", exact: true }).click();
    expect((await calls("ssh_runbook_preview"))[0].input.intentId).toBe("synthetic-intent");
    await modal.getByRole("button", { name: "Approve and run", exact: true }).click();
    const auth = page.getByRole("dialog", { name: "HTTP proxy authentication", exact: true });
    await expect(auth).toContainText("fixture-book");
    expect(await calls("ssh_runbook_start")).toHaveLength(0);
    await auth.getByRole("radio", { name: "Basic", exact: true }).click();
    await auth.getByRole("textbox", { name: "Proxy username" }).fill("synthetic-user");
    await auth.locator('input[type="password"]').fill("synthetic-password");
    await auth.getByRole("checkbox").check();
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/runbook-trigger-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-target-basic.png` });
    expect(await auth.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await auth.getByRole("button", { name: "Approve this operation", exact: true }).click();
    await expect.poll(async () => (await calls("ssh_runbook_start")).length).toBe(1);
    const started = (await calls("ssh_runbook_start"))[0].input;
    const grant = (await calls("ssh_http_proxy_credentials_approve"))[0].input;
    expect(started.intentId).toBe("synthetic-intent");
    expect(started.proxyApprovals).toEqual([
      { serverId: "ssh-duplicate", ticketId: expect.stringMatching(/^synthetic-proxy-ticket-/) },
    ]);
    expect(grant.operation).toMatchObject({
      kind: "runbook",
      runId: started.runId,
      automationId: "fixture-book",
      revision: 1,
      reviewDigest: "b".repeat(64),
      serverId: "ssh-duplicate",
    });
    expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}

for (const theme of ["light", "dark"]) {
  test(`Current workspace SSH queue review dismiss recovery ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/servers.html?sshFixture&runbookFixture&queueFixture&terminalWorkspace&theme=${theme}`,
    );
    const calls = (command: string) =>
      page.evaluate(
        (name) =>
          (window as any).serversFixtureRequests.filter((item: any) => item.command === name),
        command,
      );
    await page.getByRole("button", { name: "SSH reviews · 2", exact: true }).click();
    const queue = page.getByRole("dialog", { name: "SSH reviews", exact: true });
    expect(await calls("ssh_runbook_start")).toHaveLength(0);
    expect(await calls("ssh_runbook_preview")).toHaveLength(0);
    await queue.getByRole("button", { name: "Dismiss", exact: true }).first().click();
    await expect(queue.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(1);
    await queue.getByRole("button", { name: "Review execution", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "SSH runbooks", exact: true });
    await expect(modal.getByRole("button", { name: /^Runbook:/ })).toContainText(
      "Inspect remote state",
    );
    expect(await calls("ssh_runbook_start")).toHaveLength(0);
    await modal.getByRole("button", { name: "Review execution", exact: true }).click();
    expect((await calls("ssh_runbook_preview"))[0].input.intentId).toBe("queue-review");
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/current-browser";
    await mkdir(folder, { recursive: true });
    await modal
      .getByRole("button", { name: "Approve and run", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/${theme}-390-queue-review.png` });
    await page.evaluate(() => (window as any).serversFixtureRunbookMode("ambiguous"));
    await modal.getByRole("button", { name: "Approve and run", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("Synthetic start response interrupted");
    const runId = (await calls("ssh_runbook_start"))[0].input.runId;
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await expect(queue).toBeVisible();
    await queue.getByRole("button", { name: "Last execution", exact: true }).click();
    await expect(modal.getByRole("region", { name: "SSH execution status" })).toContainText(
      String(runId),
    );
    expect(await calls("ssh_runbook_start")).toHaveLength(1);
    expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `${folder}/${theme}-390-queue-recovered.png` });
  });
  test(`Current HTTPS editor transport roundtrip ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/servers.html?sshFixture&httpProxyFixture&theme=${theme}`);
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    await page.getByRole("button", { name: "Edit SSH server", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit SSH server", exact: true });
    await editor.locator("summary").filter({ hasText: "Connection proxy" }).click();
    await editor.getByRole("radio", { name: "HTTPS", exact: true }).click();
    await editor.getByRole("textbox", { name: "Proxy port", exact: true }).fill("443");
    await expect(editor).toContainText(
      "HTTPS verifies the proxy certificate and hostname before connecting.",
    );
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/current-browser";
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${theme}-390-https-editor.png` });
    expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const save = await page.evaluate(
      () =>
        (window as any).serversFixtureRequests.find(
          (item: any) => item.command === "server_ssh_save",
        ).input,
    );
    expect(save.endpoint.httpProxy).toEqual({
      host: "proxy.example.invalid",
      port: 443,
      scheme: "https",
    });
    await page.getByRole("button", { name: "Edit SSH server", exact: true }).click();
    await editor.locator("summary").filter({ hasText: "Connection proxy" }).click();
    await expect(editor.getByRole("radio", { name: "HTTPS", exact: true })).toBeChecked();
    await expect(editor.getByRole("textbox", { name: "Proxy port", exact: true })).toHaveValue(
      "443",
    );
    expect(
      await page.evaluate(() =>
        (window as any).serversFixtureRequests.some(
          (item: any) => item.command === "ssh_terminal_spawn",
        ),
      ),
    ).toBe(false);
  });
}

for (const theme of ["light", "dark"]) {
  test(`Current pending start explicit abandonment ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/servers.html?sshFixture&runbookFixture&abandonFailureOnce&theme=${theme}`,
    );
    const calls = (command: string) =>
      page.evaluate(
        (name) =>
          (window as any).serversFixtureRequests.filter((item: any) => item.command === name),
        command,
      );
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    await page
      .getByRole("navigation", { name: "Server tools" })
      .getByRole("button", { name: "Automation", exact: true })
      .click();
    await page.getByRole("button", { name: "SSH runbooks", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "SSH runbooks", exact: true });
    await modal.getByRole("button", { name: /^Runbook:/ }).click();
    await page.getByRole("option", { name: /Inspect remote state/ }).click();
    await modal.getByRole("button", { name: "Review execution", exact: true }).click();
    await page.evaluate(() => (window as any).serversFixtureRunbookMode("preclaim"));
    await modal.getByRole("button", { name: "Approve and run", exact: true }).click();
    const originalRun = (await calls("ssh_runbook_start"))[0].input.runId;
    const status = modal.getByRole("region", { name: "SSH execution status" });
    await expect(status).toContainText(String(originalRun));
    const abandon = modal.getByRole("button", { name: "Abandon pending start", exact: true });
    await expect(abandon).toBeEnabled();
    await abandon.click();
    await expect(modal.getByRole("alert")).toContainText("Synthetic abandon response interrupted");
    await expect(status).toContainText(String(originalRun));
    expect(await calls("ssh_runbook_start")).toHaveLength(1);
    await abandon.click();
    await expect(status).toHaveCount(0);
    await expect(abandon).toHaveCount(0);
    expect((await calls("ssh_runbook_abandon_missing")).map((item: any) => item.input)).toEqual(
      [1, 2].map(() => ({ runId: originalRun, automationId: "fixture-book", revision: 1 })),
    );
    expect(await calls("ssh_runbook_start")).toHaveLength(1);
    await modal.getByRole("button", { name: "Review execution", exact: true }).click();
    await expect(modal.getByRole("button", { name: "Approve and run", exact: true })).toBeEnabled();
    expect(await calls("ssh_runbook_start")).toHaveLength(1);
    const folder = "temp/verification/2026-10-18-termius-goal-review-fixes/current-browser";
    await mkdir(folder, { recursive: true });
    await modal
      .getByRole("button", { name: "Approve and run", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/${theme}-390-abandoned-fresh-review.png` });
  });
  test(`Current raw terminal startup review is metadata only ${theme} 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(
      `/tests/browser/servers.html?sshFixture&runbookFixture&terminalWorkspace&theme=${theme}`,
    );
    await page
      .getByRole("list", { name: "Servers" })
      .getByRole("button", { name: /Existing SSH target/ })
      .click();
    await page.getByRole("button", { name: "Connect via SSH", exact: true }).click();
    await page.getByRole("button", { name: "Terminal · More actions", exact: true }).click();
    await page.getByRole("button", { name: "Review startup scripts", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "SSH reviews", exact: true })).toContainText(
      "No pending SSH reviews.",
    );
    const commands = await page.evaluate(() =>
      (window as any).serversFixtureRequests.map((item: any) => item.command),
    );
    expect(commands).toContain("ssh_runbooks_list");
    expect(commands).not.toContain("ssh_runbook_start");
    expect(commands).not.toContain("pty_write");
    expect(commands).not.toContain("ssh_runbook_preview");
  });
}

import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`server redesign sheets ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `/tests/browser/terminal/servers.html?sshFixture&sshKeys&filesFixture&terminalWorkspace&identityColorFixture&groupFixture&inheritedFixture&serversRedesign&theme=${theme}`,
      );
      const folder = "temp/verification/2026-11-14-servers-six";
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `${folder}/${name}-${theme}-${width}.png`,
          animations: "disabled",
        });
      };
      const inventory = page.getByRole("list", { name: "Servers", exact: true });
      await expect(inventory.getByRole("button", { name: /^Existing SSH target/ })).toBeVisible();
      await capture("catalog-list");
      await page.getByRole("radio", { name: "Card view", exact: true }).click();
      await capture("catalog-cards");
      await page.getByRole("button", { name: /^Legacy display label/ }).click();
      await expect(inventory.locator("[data-server-row]")).toHaveCount(1);
      await capture("catalog-group");
      await inventory.getByRole("button", { name: /^Existing SSH target/ }).click();
      const details = page.getByRole("region", { name: "Server details", exact: true });
      await expect(details).toBeVisible();
      await capture("connection");
      for (const [tab, name] of [
        ["Port forwarding", "forwards"],
        ["Automation", "automation"],
        ["Organization", "organization"],
        ["Activity", "activity"],
      ]) {
        await details.getByRole("tab", { name: tab, exact: true }).click();
        if (name === "forwards")
          await details.locator("summary").filter({ hasText: "Add forwarding rule" }).click();
        await capture(name);
      }
      await details.getByRole("tab", { name: "Connection", exact: true }).click();
      await details.getByRole("button", { name: "Choose SSH key", exact: true }).click();
      await details.locator("summary").filter({ hasText: "Use a key file path" }).click();
      await details
        .getByRole("textbox", { name: "Identity file", exact: true })
        .fill("C:/keys/unfinished");
      await details.getByRole("tab", { name: "Organization", exact: true }).click();
      await details.getByRole("tab", { name: "Connection", exact: true }).click();
      await expect(
        details.getByRole("textbox", { name: "Identity file", exact: true }),
      ).toHaveValue("C:/keys/unfinished");
      await capture("identity-draft");
      await details.getByRole("button", { name: "Cancel", exact: true }).click();
      await details.getByRole("tab", { name: "Organization", exact: true }).click();
      await details.getByRole("button", { name: "SSH group settings", exact: true }).click();
      const group = page.getByRole("dialog", { name: "SSH group settings", exact: true });
      await group.getByRole("button", { name: "Edit group", exact: true }).click();
      const defaults = group.locator('[aria-label="Group defaults"]');
      await defaults.scrollIntoViewIfNeeded();
      await capture("group-defaults");
      await defaults.locator("summary").filter({ hasText: "Remote environment" }).click();
      await group
        .getByRole("textbox", { name: "Variable name 1", exact: true })
        .scrollIntoViewIfNeeded();
      await capture("group-environment");
      await page.keyboard.press("Escape");
      await expect(group).toHaveCount(0);
      await expect(details).toBeVisible();
      await details.getByRole("tab", { name: "Connection", exact: true }).click();
      await details.getByRole("button", { name: "Files", exact: true }).click();
      const files = page.getByRole("dialog", { name: "SFTP files", exact: true });
      await expect(files).toBeVisible();
      await capture("sftp-empty");
      await files.getByRole("button", { name: "Open", exact: true }).click();
      await expect(files.getByText("README.md", { exact: true })).toBeVisible();
      await capture("sftp-files");
      await page.keyboard.press("Escape");
      await details.getByRole("button", { name: "Close server details", exact: true }).click();
      await page.getByRole("button", { name: "SSH settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "SSH settings", exact: true });
      await expect(settings.getByText("id_ed25519_work", { exact: true })).toBeVisible();
      await capture("ssh-keys");
      await settings.getByRole("tab", { name: "Known hosts", exact: true }).click();
      await expect(settings.getByText("deploy.example.invalid", { exact: true })).toBeVisible();
      await capture("known-hosts");
      await settings
        .getByRole("textbox", { name: "Search known hosts", exact: true })
        .fill("missing-host");
      await expect(settings.getByText("No results", { exact: true })).toBeVisible();
      await capture("known-hosts-filtered");
      await settings.getByRole("button", { name: "Reset filters", exact: true }).click();
      await expect(settings.getByText("deploy.example.invalid", { exact: true })).toBeVisible();
      await settings.getByRole("tab", { name: "Import SSH config", exact: true }).click();
      await capture("ssh-config-import");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add SSH server", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Add SSH server", exact: true });
      await expect(editor.getByRole("spinbutton", { name: "SSH port", exact: true })).toHaveValue(
        "22",
      );
      await capture("add-server");
      await editor.locator("summary").filter({ hasText: "Advanced SSH settings" }).click();
      await capture("add-server-advanced");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Quick connect", exact: true }).click();
      const quick = page.getByRole("dialog", { name: "Quick connect", exact: true });
      await expect(quick.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
      await expect(quick.getByRole("textbox", { name: "Name", exact: true })).not.toHaveAttribute(
        "required",
        "",
      );
      await capture("quick-connect");
      await quick.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("menuitem", { name: "Import from Termius", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "Import from Termius", exact: true }),
      ).toBeVisible();
      await capture("termius-import");
      expect(errors).toEqual([]);
      const calls = await page.evaluate(() => (window as any).serversFixtureCalls as string[]);
      expect(
        calls.filter((command) =>
          [
            "server_metadata_update",
            "server_ssh_save",
            "ssh_terminal_spawn",
            "ssh_forward_start",
            "sftp_upload",
          ].includes(command),
        ),
      ).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 800, 1024, 1280, 1440]) {
    test(`Servers workspace sections and drafts ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/terminal/servers.html?sshFixture&sshKeys&filesFixture&terminalWorkspace&theme=${theme}`,
      );
      const folder = "temp/verification/2026-10-19-servers-complete";
      await page.screenshot({ path: `${folder}/inventory-${theme}-${width}.png` });
      await page.getByRole("button", { name: "SSH settings", exact: true }).click();
      const ssh = page.getByRole("dialog", { name: "SSH settings", exact: true });
      await ssh.getByRole("tab", { name: "Import SSH config", exact: true }).click();
      await ssh
        .getByRole("textbox", { name: "SSH config", exact: true })
        .fill("Host work\n HostName work.invalid");
      await ssh.getByRole("tab", { name: "Keys", exact: true }).click();
      await expect(ssh.getByText("id_ed25519_work", { exact: true })).toBeVisible();
      await ssh.getByRole("tab", { name: "Import SSH config", exact: true }).click();
      await expect(ssh.getByRole("textbox", { name: "SSH config", exact: true })).toHaveValue(
        "Host work\n HostName work.invalid",
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("list", { name: "Servers" })
        .getByRole("button", { name: /^Existing SSH target/ })
        .click();
      const details = page.getByRole("region", { name: "Server details", exact: true });
      const nav = details.getByRole("tablist", { name: "Server tools", exact: true });
      await nav.getByRole("tab", { name: "Port forwarding", exact: true }).click();
      await expect(details.getByText("No forwarding rules yet.", { exact: true })).toBeVisible();
      await details.locator("summary").filter({ hasText: "Add forwarding rule" }).click();
      await details.getByRole("spinbutton", { name: "Local port", exact: true }).fill("8088");
      await nav.getByRole("tab", { name: "Automation", exact: true }).click();
      const commands = details.getByRole("region", { name: "Saved SSH commands", exact: true });
      await commands.getByRole("textbox", { name: "Name", exact: true }).fill("Unfinished command");
      await commands.getByRole("textbox", { name: "Command preview", exact: true }).fill("pwd");
      await nav.getByRole("tab", { name: "Organization", exact: true }).click();
      await details.getByRole("combobox", { name: "Group", exact: true }).fill("Unfinished group");
      await nav.getByRole("tab", { name: "Automation", exact: true }).click();
      await expect(commands.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
        "Unfinished command",
      );
      await page.screenshot({ path: `${folder}/commands-${theme}-${width}.png` });
      await nav.getByRole("tab", { name: "Port forwarding", exact: true }).click();
      await expect(
        details.getByRole("spinbutton", { name: "Local port", exact: true }),
      ).toHaveValue("8088");
      await nav.getByRole("tab", { name: "Organization", exact: true }).click();
      await expect(details.getByRole("combobox", { name: "Group", exact: true })).toHaveValue(
        "Unfinished group",
      );
      await nav.getByRole("tab", { name: "Connection", exact: true }).click();
      await page.screenshot({ path: `${folder}/connection-${theme}-${width}.png` });
      await details.getByRole("button", { name: "Files", exact: true }).click();
      const files = page.getByRole("dialog", { name: "SFTP files", exact: true });
      await expect(
        files.getByText("Open a directory to browse files.", { exact: true }),
      ).toBeVisible();
      await files.getByRole("button", { name: "Open", exact: true }).click();
      await files.getByRole("textbox", { name: "Search remote files", exact: true }).fill("README");
      await expect(files.getByText("README.md", { exact: true })).toBeVisible();
      await expect(files.getByRole("button", { name: "deployments", exact: true })).toHaveCount(0);
      await page.screenshot({ path: `${folder}/files-${theme}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const calls = await page.evaluate(() => (window as any).serversFixtureCalls);
      expect(
        calls.some((command: string) =>
          [
            "server_metadata_update",
            "server_ssh_save",
            "ssh_terminal_spawn",
            "ssh_forward_start",
            "pty_write",
          ].includes(command),
        ),
      ).toBe(false);
    });
  }
}

test("SSH management is reachable before any server exists", async ({ page }) => {
  await page.goto("/tests/browser/terminal/servers.html?emptyServers&sshKeys");
  await expect(page.getByRole("list", { name: "Servers" }).getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "SSH settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "SSH settings", exact: true });
  await expect(dialog.getByText("id_ed25519_work", { exact: true })).toBeVisible();
  await dialog.getByRole("tab", { name: "Import SSH config", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "SSH config", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Assign key:/ })).toHaveCount(0);
});

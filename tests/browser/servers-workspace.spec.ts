import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`Servers workspace sections and drafts ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/servers.html?sshFixture&sshKeys&filesFixture&terminalWorkspace&theme=${theme}`,
      );
      const folder = "temp/verification/2026-10-19-servers-complete";
      await page.screenshot({ path: `${folder}/inventory-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Manage SSH", exact: true }).click();
      const ssh = page.getByRole("dialog", { name: "SSH settings", exact: true });
      await ssh.getByRole("button", { name: "Import SSH config", exact: true }).click();
      await ssh
        .getByRole("textbox", { name: "SSH config", exact: true })
        .fill("Host work\n HostName work.invalid");
      await ssh.getByRole("button", { name: "Keys", exact: true }).click();
      await expect(ssh.getByText("id_ed25519_work", { exact: true })).toBeVisible();
      await ssh.getByRole("button", { name: "Import SSH config", exact: true }).click();
      await expect(ssh.getByRole("textbox", { name: "SSH config", exact: true })).toHaveValue(
        "Host work\n HostName work.invalid",
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("list", { name: "Servers" })
        .getByRole("button", { name: /Existing SSH target/ })
        .click();
      const details = page.getByRole("region", { name: "Server details", exact: true });
      const nav = details.getByRole("navigation", { name: "Server tools", exact: true });
      await nav.getByRole("button", { name: "Port forwarding", exact: true }).click();
      await expect(details.getByText("No forwarding rules yet.", { exact: true })).toBeVisible();
      await details.locator("summary").filter({ hasText: "Add forwarding rule" }).click();
      await details.getByRole("spinbutton", { name: "Local port", exact: true }).fill("8088");
      await nav.getByRole("button", { name: "Automation", exact: true }).click();
      const commands = details.getByRole("region", { name: "Saved SSH commands", exact: true });
      await commands.getByRole("textbox", { name: "Name", exact: true }).fill("Unfinished command");
      await commands.getByRole("textbox", { name: "Command preview", exact: true }).fill("pwd");
      await nav.getByRole("button", { name: "Settings", exact: true }).click();
      await details.getByRole("textbox", { name: "Group", exact: true }).fill("Unfinished group");
      await nav.getByRole("button", { name: "Automation", exact: true }).click();
      await expect(commands.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
        "Unfinished command",
      );
      await page.screenshot({ path: `${folder}/commands-${theme}-${width}.png` });
      await nav.getByRole("button", { name: "Port forwarding", exact: true }).click();
      await expect(
        details.getByRole("spinbutton", { name: "Local port", exact: true }),
      ).toHaveValue("8088");
      await nav.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(details.getByRole("textbox", { name: "Group", exact: true })).toHaveValue(
        "Unfinished group",
      );
      await nav.getByRole("button", { name: "Connection", exact: true }).click();
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
  await page.goto("/tests/browser/servers.html?emptyServers&sshKeys");
  await expect(page.getByRole("list", { name: "Servers" }).getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Manage SSH", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "SSH settings", exact: true });
  await expect(dialog.getByText("id_ed25519_work", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Import SSH config", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "SSH config", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Assign key:/ })).toHaveCount(0);
});

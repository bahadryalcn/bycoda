import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1280]) {
    test(`saved SSH key is assigned once and reused ${theme} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/servers.html?sshFixture&sshKeys&terminalWorkspace&theme=${theme}`,
      );
      await page
        .getByRole("list", { name: "Servers" })
        .getByRole("button", { name: /Existing SSH target/ })
        .click();
      const details = page.getByRole("region", { name: "Server details" });
      await details
        .getByRole("navigation", { name: "Server tools" })
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      await details.getByRole("button", { name: "SSH settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "SSH settings", exact: true });
      const assign = dialog.getByRole("button", {
        name: "Assign key: C:/Users/fixture/.ssh/id_ed25519_work (Existing SSH target)",
        exact: true,
      });
      await assign.focus();
      await page.keyboard.press("Enter");
      await expect(assign).toBeDisabled();
      await expect(assign).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.getByRole("status")).toContainText(
        "C:/Users/fixture/.ssh/id_ed25519_work",
      );
      const folder = "temp/verification/2026-10-19-ssh-key-binding";
      await mkdir(folder, { recursive: true });
      await page.screenshot({ path: `${folder}/assigned-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      for (let attempt = 0; attempt < 2; attempt++) {
        await details.getByRole("button", { name: "Connect via SSH", exact: true }).click();
        await page.getByRole("button", { name: "Servers", exact: true }).click();
      }
      await details.getByRole("button", { name: "SSH settings", exact: true }).click();
      await expect(assign).toBeDisabled();
      const requests = await page.evaluate(() => (window as any).serversFixtureRequests);
      expect(
        requests.filter((request: any) => request.command === "server_ssh_identity_set"),
      ).toHaveLength(1);
      expect(
        requests
          .filter((request: any) => request.command === "ssh_terminal_spawn")
          .map((request: any) => request.input.connectionId),
      ).toEqual(["ssh-duplicate", "ssh-duplicate"]);
      expect(requests.some((request: any) => request.command === "server_ssh_save")).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

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
      const search = dialog.getByRole("searchbox", { name: "Search SSH keys…" });
      await search.fill("no-such-key");
      await expect(dialog.getByText("No matching SSH keys.", { exact: true })).toBeVisible();
      await search.fill("id_ed25519_work");
      await expect(
        dialog.getByRole("button", { name: /Assign key:.*a-long-descriptive/ }),
      ).toHaveCount(0);
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

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1280]) {
    test(`find and save a key directly from credentials ${theme} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/servers.html?sshFixture&sshKeys&terminalWorkspace&theme=${theme}`,
      );
      await page
        .getByRole("list", { name: "Servers" })
        .getByRole("button", { name: /Existing SSH target/ })
        .click();
      const details = page.getByRole("region", { name: "Server details" });
      const credentials = details.getByRole("region", { name: "Credentials" });
      await credentials.getByRole("button", { name: "Choose SSH key", exact: true }).click();
      const picker = credentials.getByRole("button", { name: /^Choose SSH key:/ });
      await picker.click();
      await page.getByPlaceholder("Search SSH keys…").fill("id_ed25519_work");
      await expect(page.getByRole("option")).toHaveCount(1);
      await page.getByRole("option").press("Enter");
      const writes = () =>
        page.evaluate(() =>
          (window as any).serversFixtureRequests.filter(
            (request: any) => request.command === "server_ssh_identity_set",
          ),
        );
      expect(await writes()).toHaveLength(0);
      await credentials.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        credentials.getByText(/SSH key: C:\/Users\/fixture\/\.ssh\/id_ed25519_work/),
      ).toBeVisible();
      expect(await writes()).toHaveLength(1);
      await expect(
        details.getByRole("button", { name: "Connect via SSH", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-10-19-servers-layout/details-${theme}-${width}.png`,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await details.getByRole("button", { name: "Edit SSH server", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit SSH server", exact: true });
      await expect(editor.getByRole("button", { name: /^Choose SSH key:/ })).toBeVisible();
      await expect(editor.getByText("Advanced SSH settings", { exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
      await page.screenshot({
        path: `temp/verification/2026-10-19-servers-layout/editor-${theme}-${width}.png`,
      });
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    });
  }
}

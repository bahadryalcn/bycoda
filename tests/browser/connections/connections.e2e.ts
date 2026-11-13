import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 800, 1280, 1440]) {
    test(`connections: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=connections&connections=1&theme=${theme}&lang=en`,
      );
      const root = page.locator("#setting-remote-machines");
      await expect(root.getByText("Studio Mac", { exact: true })).toBeVisible();
      await expect(root.getByRole("button", { name: "Start tunnel", exact: true })).toHaveCount(0);
      await expect(root.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
      // Adding is one entry point: the form offers SSH or a host URL.
      await root.getByRole("button", { name: "Add machine", exact: true }).click();
      await expect(root.getByText("Connect to an existing host by URL")).toHaveCount(0);
      await root
        .getByRole("radio", { name: "Host URL", exact: true })
        .locator("..")
        .locator('span[aria-hidden="true"]')
        .first()
        .click();
      await expect(root.getByRole("radio", { name: "Host URL", exact: true })).toBeChecked();
      const urlField = root.getByRole("textbox", { name: "Host URL", exact: true });
      await urlField.fill("https://saved.example.com");
      await root.getByText("SSH", { exact: true }).first().click();
      await root.getByText("Host URL", { exact: true }).click();
      await expect(urlField).toHaveValue("https://saved.example.com");
      await root.getByRole("button", { name: "Cancel", exact: true }).click();
      // Connection details stay hidden until requested from the machine's action menu.
      await expect(root.locator(".connection-details")).toHaveCount(0);
      await root.getByRole("button", { name: "Actions for Studio Mac", exact: true }).click();
      await page.getByRole("menuitem", { name: "Connection details", exact: true }).click();
      await expect(root.locator(".connection-details").last()).toContainText(
        "owner@studio-tailnet",
      );
      await root.getByRole("button", { name: "Add machine", exact: true }).click();
      await expect(root.getByRole("radio", { name: "SSH", exact: true })).toBeChecked();
      const address = root.getByRole("textbox", { name: "SSH address", exact: true });
      await address.fill("owner@new-machine");
      await expect(
        root.getByText("Installs bycoda Host over SSH so you can run agents on this machine.", {
          exact: true,
        }),
      ).toBeVisible();
      // Help sits behind an information control; the form keeps only what is needed to proceed.
      const help = root.getByRole("button", { name: "Connection help", exact: true });
      await expect(help).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("dialog", { name: "Connection help", exact: true })).toHaveCount(
        0,
      );
      await expect(
        root.getByRole("textbox", { name: "Other address (optional)", exact: true }),
      ).toBeVisible();
      const evidence = "temp/verification/2026-11-10-connections-redesign";
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/${theme}-${width}-add.png` });
      await help.click();
      const helpDialog = page.getByRole("dialog", { name: "Connection help", exact: true });
      await expect(helpDialog).toContainText("A hostname works too");
      await page.keyboard.press("Escape");
      await expect(helpDialog).toHaveCount(0);
      const machines = root.getByRole("tab", { name: "Machines", exact: true });
      await machines.focus();
      await page.keyboard.press("ArrowRight");
      const phone = root.getByRole("region", { name: "Connect your phone", exact: true });
      await expect(phone).toBeVisible();
      await expect(address).not.toBeVisible();
      // The phone tab pairs inline: the access check runs by itself and one action shows the code.
      await expect(phone.getByRole("group", { name: "Phone network" })).toBeVisible();
      await expect(phone.getByRole("radio", { name: "Same Wi-Fi", exact: true })).toBeChecked();
      const showCode = phone.getByRole("button", { name: "Show QR code", exact: true });
      await expect(showCode).toBeVisible();
      await page.screenshot({ path: `${evidence}/${theme}-${width}-phone.png` });
      await showCode.click();
      await expect(phone.locator("svg title")).toHaveText("Scan this code in bycoda on your phone");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `${evidence}/${theme}-${width}-phone-qr.png` });
      await root.getByRole("tab", { name: "Phone", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      const tunnels = root.getByRole("region", { name: "External tunnels", exact: true });
      await expect(
        tunnels.getByRole("button", { name: "Start tunnel", exact: true }),
      ).toBeEnabled();
      const computer = tunnels.getByRole("button", { name: /^Computer:/ });
      const controls = tunnels.locator(".external-tunnel-controls");
      const gap = await controls.evaluate(
        (node, bottom) => node.getBoundingClientRect().top - bottom,
        (await computer.boundingBox())!.y + (await computer.boundingBox())!.height,
      );
      expect(gap).toBeLessThan(40);
      await tunnels.getByRole("textbox", { name: "Local URL or port" }).fill("4567");
      await root.getByRole("tab", { name: "Machines", exact: true }).click();
      await expect(address).toHaveValue("owner@new-machine");
      await root.getByRole("tab", { name: "Sharing", exact: true }).click();
      await expect(tunnels.getByRole("textbox", { name: "Local URL or port" })).toHaveValue("4567");
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({
        path: `${evidence}/${theme}-${width}-tunnels.png`,
      });
      await root.getByRole("tab", { name: "Machines", exact: true }).click();
      await root.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.screenshot({
        path: `${evidence}/${theme}-${width}-machines.png`,
      });
    });
  }
}

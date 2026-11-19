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
      // Adding a computer happens in a dialog; the saved list stays uncluttered.
      const addComputer = root.getByRole("button", { name: "Add a computer", exact: true });
      await addComputer.click();
      const addDialog = page.getByRole("dialog", { name: "Add a computer", exact: true });
      await expect(addDialog).toBeVisible();
      await expect(addDialog.getByRole("tab", { name: "Found", exact: true })).toBeVisible();
      await addDialog.getByRole("tab", { name: "Enter address", exact: true }).click();
      await expect(addDialog.getByRole("radio", { name: "SSH", exact: true })).toBeChecked();
      await addDialog
        .getByRole("radio", { name: "Host URL", exact: true })
        .locator("..")
        .locator('span[aria-hidden="true"]')
        .first()
        .click();
      await expect(addDialog.getByRole("radio", { name: "Host URL", exact: true })).toBeChecked();
      const urlField = addDialog.getByRole("textbox", { name: "Host URL", exact: true });
      await urlField.fill("https://saved.example.com");
      await addDialog.getByText("SSH", { exact: true }).first().click();
      await addDialog.getByText("Host URL", { exact: true }).click();
      await expect(urlField).toHaveValue("https://saved.example.com");
      await addDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(addDialog).toHaveCount(0);
      // Connection details stay hidden until requested from the machine's action menu.
      await expect(root.locator(".connection-details")).toHaveCount(0);
      await root.getByRole("button", { name: "Actions for Studio Mac", exact: true }).click();
      await page.getByRole("menuitem", { name: "Connection details", exact: true }).click();
      await expect(root.locator(".connection-details").last()).toContainText(
        "owner@studio-tailnet",
      );
      await addComputer.click();
      // A reopened dialog starts on the found list and on SSH again.
      await addDialog.getByRole("tab", { name: "Enter address", exact: true }).click();
      await expect(addDialog.getByRole("radio", { name: "SSH", exact: true })).toBeChecked();
      const address = addDialog.getByRole("textbox", { name: "SSH address", exact: true });
      await address.fill("owner@new-machine");
      await expect(
        addDialog.getByText(
          "Installs bycoda Host over SSH so you can run agents on this computer.",
          { exact: true },
        ),
      ).toBeVisible();
      // Help sits behind an information control; the form keeps only what is needed to proceed.
      const help = addDialog.getByRole("button", { name: "Connection help", exact: true });
      await expect(help).toHaveAttribute("aria-expanded", "false");
      await addDialog.getByText("More options", { exact: true }).click();
      await expect(
        addDialog.getByRole("textbox", { name: "Other address (optional)", exact: true }),
      ).toBeVisible();
      const evidence = "temp/verification/2026-11-10-connections-redesign";
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/${theme}-${width}-add.png` });
      await help.click();
      await expect(page.getByText("A hostname works too", { exact: false })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByText("A hostname works too", { exact: false })).toHaveCount(0);
      // Closing keeps the typed address as a draft on the page.
      await addDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(addDialog).toHaveCount(0);

      // Devices: pairing a phone opens a dialog; the access check runs by itself.
      await root.getByRole("tab", { name: "Devices", exact: true }).click();
      await root.getByRole("button", { name: "Connect a phone", exact: true }).click();
      const phone = page.getByRole("dialog", { name: "Connect your phone", exact: true });
      await expect(phone).toBeVisible();
      await expect(phone.getByRole("group", { name: "Phone network" })).toBeVisible();
      await expect(phone.getByRole("radio", { name: "Same Wi-Fi", exact: true })).toBeChecked();
      const showCode = phone.getByRole("button", { name: "Show QR code", exact: true });
      await expect(showCode).toBeVisible();
      await page.screenshot({ path: `${evidence}/${theme}-${width}-phone.png` });
      await showCode.click();
      await expect(phone.locator("svg title")).toHaveText("Scan this code in bycoda on your phone");
      await page.screenshot({ path: `${evidence}/${theme}-${width}-phone-qr.png` });
      await page.keyboard.press("Escape");
      await expect(phone).toHaveCount(0);
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);

      await root.getByRole("tab", { name: "Sharing", exact: true }).click();
      const tunnels = root.getByRole("region", { name: "External tunnels", exact: true });
      await expect(root.getByRole("button", { name: "Start tunnel", exact: true })).toHaveCount(0);
      // Starting a link happens in a share dialog; its draft survives closing.
      await tunnels.getByRole("button", { name: "Share…", exact: true }).click();
      const share = page.getByRole("dialog", { name: /^Share from / });
      await expect(share).toBeVisible();
      await expect(share.getByRole("button", { name: "Start sharing", exact: true })).toBeEnabled();
      await share.getByRole("textbox", { name: "Local URL or port" }).fill("4567");
      await page.screenshot({ path: `${evidence}/${theme}-${width}-share.png` });
      await share.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(share).toHaveCount(0);
      await root.getByRole("tab", { name: "Computers", exact: true }).click();
      await root.getByRole("tab", { name: "Sharing", exact: true }).click();
      await tunnels.getByRole("button", { name: "Share…", exact: true }).click();
      await expect(share.getByRole("textbox", { name: "Local URL or port" })).toHaveValue("4567");
      await share.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({
        path: `${evidence}/${theme}-${width}-tunnels.png`,
      });
      await root.getByRole("tab", { name: "Computers", exact: true }).click();
      await page.screenshot({
        path: `${evidence}/${theme}-${width}-machines.png`,
      });
    });
  }
}

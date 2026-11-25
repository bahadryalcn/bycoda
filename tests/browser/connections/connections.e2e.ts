import { expect, test, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";

const actionPosition = (button: Locator) =>
  button.evaluate((element) => {
    const buttonBounds = element.getBoundingClientRect();
    const sectionBounds = element.closest("#setting-remote-machines")!.getBoundingClientRect();
    return {
      right: Math.round(sectionBounds.right - buttonBounds.right),
      top: Math.round(buttonBounds.top - sectionBounds.top),
    };
  });

for (const theme of ["light", "dark"]) {
  for (const width of [390, 800, 1280, 1440]) {
    test(`connections: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=connections&connections=1&theme=${theme}&lang=en`,
      );
      const root = page.locator("#setting-remote-machines");
      const evidence = "temp/verification/connections-redesign";
      mkdirSync(evidence, { recursive: true });
      await expect(root.getByText("Studio Mac", { exact: true })).toBeVisible();
      await expect(root.getByRole("button", { name: "Start tunnel", exact: true })).toHaveCount(0);
      await expect(root.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
      // Adding a computer happens in a dialog; the saved list stays uncluttered.
      const addComputer = root.getByRole("button", { name: "Add a computer", exact: true });
      const computersActionPosition = await actionPosition(addComputer);
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
      await expect(root.locator(".connection-details").last()).toContainText("100.97.82.4");
      await expect(root.getByText("In use", { exact: true })).toBeVisible();
      await page.screenshot({ path: `${evidence}/${theme}-${width}-machines.png` });
      await root.getByRole("button", { name: "Actions for Studio Mac", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit name and address…", exact: true }).click();
      const editDialog = page.getByRole("dialog", { name: "Edit Studio Mac", exact: true });
      const editAddress = editDialog.getByRole("textbox", { name: "SSH address", exact: true });
      await expect(editAddress).toBeFocused();
      await expect(root.getByRole("form", { name: "Edit Studio Mac" })).toHaveCount(0);
      await editAddress.fill("owner@new-studio");
      await expect(editDialog.getByRole("button", { name: "Save and reconnect" })).toBeEnabled();
      await page.screenshot({ path: `${evidence}/${theme}-${width}-edit.png` });
      await page.keyboard.press("Escape");
      await expect(editDialog).toHaveCount(0);
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
      const connectPhone = root.getByRole("button", { name: "Connect a phone", exact: true });
      expect(await actionPosition(connectPhone)).toEqual(computersActionPosition);
      await expect(root.getByRole("heading", { name: "Phone access", exact: true })).toBeVisible();
      const phoneRow = root.locator(".settings-row").filter({ hasText: "iPhone 16" });
      const phoneName = phoneRow.getByText("iPhone 16", { exact: true });
      await expect(phoneName).toBeVisible();
      await expect(root.getByText("Studio Mac desktop", { exact: true })).toHaveCount(0);
      await expect(root.getByText("This desktop", { exact: true })).toHaveCount(1);
      const activity = phoneRow.getByText(/^Paired /);
      await expect(activity).toHaveAttribute("data-tone", "muted");
      await expect(activity).not.toHaveCSS(
        "color",
        await phoneName.evaluate((name) => getComputedStyle(name).color),
      );
      await page.screenshot({ path: `${evidence}/${theme}-${width}-devices.png` });
      await connectPhone.click();
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
    });

    test(`sharing: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=connections&connections=1&sharing-history=1&theme=${theme}&lang=en`,
      );
      const root = page.locator("#setting-remote-machines");
      const evidence = "temp/verification/connections-redesign";
      mkdirSync(evidence, { recursive: true });
      const addComputer = root.getByRole("button", { name: "Add a computer", exact: true });
      const computersActionPosition = await actionPosition(addComputer);
      await root.getByRole("tab", { name: "Sharing", exact: true }).click();
      const tunnels = root.getByRole("region", { name: "External tunnels", exact: true });
      await expect(root.getByRole("button", { name: "Start tunnel", exact: true })).toHaveCount(0);
      const links = tunnels.getByRole("region", { name: "Tunnel status", exact: true });
      await expect(links.getByRole("status")).toHaveText(["Connected", "Stopped"]);
      await expect(links.getByRole("button", { name: "Copy URL", exact: true })).toBeVisible();
      // Starting a link happens in a share dialog; its draft survives closing.
      const createLink = tunnels.getByRole("button", { name: "Create link", exact: true });
      expect(await actionPosition(createLink)).toEqual(computersActionPosition);
      await createLink.click();
      const share = page.getByRole("dialog", { name: "Create link", exact: true });
      await expect(share).toBeVisible();
      await expect(share.getByRole("button", { name: "Start sharing", exact: true })).toBeEnabled();
      await share.getByRole("textbox", { name: "Local URL or port" }).fill("4567");
      await page.screenshot({ path: `${evidence}/${theme}-${width}-share.png` });
      await share.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(share).toHaveCount(0);
      await root.getByRole("tab", { name: "Computers", exact: true }).click();
      await root.getByRole("tab", { name: "Sharing", exact: true }).click();
      await createLink.click();
      await expect(share.getByRole("textbox", { name: "Local URL or port" })).toHaveValue("4567");
      await share.getByText("bycoda host", { exact: true }).click();
      const restart = share.getByRole("checkbox", { name: "Restart tunnel automatically" });
      await expect(restart).not.toBeChecked();
      await restart.check();
      await expect(share.getByRole("button", { name: "Start sharing", exact: true })).toBeEnabled();
      await page.screenshot({ path: `${evidence}/${theme}-${width}-host-share.png` });
      await share.getByRole("button", { name: "Cancel", exact: true }).click();
      await createLink.click();
      await expect(restart).not.toBeChecked();
      await share.getByText("ngrok", { exact: true }).click();
      await expect(
        share.getByRole("button", { name: "Start sharing", exact: true }),
      ).toBeDisabled();
      await page.screenshot({ path: `${evidence}/${theme}-${width}-ngrok-share.png` });
      await share.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({
        path: `${evidence}/${theme}-${width}-tunnels.png`,
      });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`project tunnel layout: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/connections/connection-dialogs.html?dialog=tunnel-rows&theme=${theme}`,
      );
      const dialog = page.getByRole("dialog", { name: "External tunnels", exact: true });
      await expect(dialog.getByRole("status")).toHaveText(["Error", "Starting", "Connected"]);
      await expect(dialog.getByRole("button", { name: "Copy URL", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Start tunnel", exact: true })).toBeEnabled();
      await dialog.getByRole("textbox", { name: "Local URL or port" }).focus();
      const evidence = "temp/verification/connections-redesign";
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/${theme}-${width}-project-tunnels.png` });
    });
  }
}

import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"]) {
  for (const width of [320, 768, 1440]) {
    test(`terminal search and completion: ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/terminal-tools.html?theme=${theme}`);
      const terminal = page.locator(".xterm-helper-textarea");
      await expect(
        page.getByRole("button", { name: "Command suggestions", exact: true }),
      ).toBeEnabled();
      await terminal.focus();
      await terminal.press("Control+f");
      const search = page.getByRole("textbox", { name: "Find in terminal" });
      await expect(search).toBeFocused();
      await search.fill("target");
      // Copy through the real terminal handler: selection is rendered on canvas
      // when WebGL is active, so DOM selection rectangles are not a contract.
      const selectedText = () =>
        page.locator(".bycoda-terminal-host").evaluate((host) => {
          const clipboardData = new DataTransfer();
          host.dispatchEvent(
            new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData }),
          );
          return clipboardData.getData("text/plain");
        });
      await expect.poll(selectedText).toBe("target");
      const first = await page.locator("html").getAttribute("data-terminal-position");
      await search.press("Enter");
      await expect.poll(selectedText).toBe("target");
      await expect(page.locator("html")).not.toHaveAttribute("data-terminal-position", first!);
      await search.press("Shift+Enter");
      await expect.poll(selectedText).toBe("target");
      await expect(page.locator("html")).toHaveAttribute("data-terminal-position", first!);
      await search.fill("missing-value");
      await expect(page.getByRole("status")).toHaveText("No matches");
      await search.press("Escape");
      await expect(terminal).toBeFocused();
      await terminal.press("Meta+f");
      await expect(search).toBeFocused();
      await search.press("Escape");
      await terminal.press("Control+Space");
      const command = page.getByRole("combobox", { name: "Command suggestions" });
      await expect(command).toBeFocused();
      await command.fill("git ");
      await command.press("ArrowDown");
      await command.press("Tab");
      await expect(command).toHaveValue("git diff");
      await command.fill("pnpm b");
      mkdirSync("temp/verification/2026-10-18-terminal-tools/captures", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-18-terminal-tools/captures/${theme}-${width}.png`,
      });
      await command.press("Tab");
      await expect(command).toHaveValue("pnpm build");
      await command.press("Enter");
      await expect(terminal).toBeFocused();
      await expect(page.locator("html")).toHaveAttribute(
        "data-last-pty-write",
        JSON.stringify("pnpm build"),
      );
      await terminal.press("Tab");
      await expect(page.locator("html")).toHaveAttribute(
        "data-last-pty-write",
        JSON.stringify("\t"),
      );
      // Switching to an interactive full-screen application disables insertion.
      await page.evaluate(() =>
        document.dispatchEvent(new CustomEvent("test-pty-output", { detail: "\x1b[?1049h" })),
      );
      await expect(
        page.getByRole("button", { name: "Command suggestions", exact: true }),
      ).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    });
  }
}

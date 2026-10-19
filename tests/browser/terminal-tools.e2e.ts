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
      await expect(page.getByRole("button", { name: "Terminal · More actions" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Find in terminal" })).toHaveCount(0);
      await expect(page.locator("[data-terminal-tools]")).toHaveCount(0);
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
      await terminal.type("git ");
      const list = page.getByRole("listbox", { name: "Command suggestions" });
      await expect(list).toBeVisible();
      await expect(terminal).toBeFocused();
      await terminal.press("ArrowDown");
      await expect(list.getByRole("option", { selected: true })).toHaveText("git diff");
      await terminal.press("Tab");
      await expect(list).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute(
        "data-last-pty-write",
        JSON.stringify("diff"),
      );
      // Acceptance inserts only; the following Enter reaches the shell.
      await terminal.press("Enter");
      await expect(page.locator("html")).toHaveAttribute(
        "data-last-pty-write",
        JSON.stringify("\r"),
      );
      await terminal.type("pnpm b");
      await expect(list).toBeVisible();
      const bounds = await list.boundingBox();
      const screen = await page.locator(".xterm-screen").boundingBox();
      expect(bounds!.y).toBeGreaterThan(screen!.y);
      mkdirSync("temp/verification/2026-10-19-terminal-completion/captures", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-19-terminal-completion/captures/${theme}-${width}.png`,
      });
      await terminal.press("Escape");
      await expect(list).toHaveCount(0);
      await terminal.press("Control+Space");
      await expect(list).toBeVisible();
      await terminal.press("Enter");
      await expect(page.locator("html")).toHaveAttribute(
        "data-last-pty-write",
        JSON.stringify("uild"),
      );
      await terminal.press("Tab");
      await expect(page.locator("html")).toHaveAttribute(
        "data-last-pty-write",
        JSON.stringify("\t"),
      );
      await page.evaluate(() =>
        document.dispatchEvent(new CustomEvent("test-pty-output", { detail: "\x1b[?1049h" })),
      );
      await terminal.type("git s");
      await expect(list).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    });
  }
}

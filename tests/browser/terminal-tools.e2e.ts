import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"]) {
  test(`terminal typography wheel zoom: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("bycoda.appearancePreferences.v1", JSON.stringify({
      terminalSize: 16, terminalFont: "Consolas", terminalWeight: 600, terminalLineHeight: 1.35,
    })));
    await page.goto(`/tests/browser/terminal-tools.html?theme=${theme}`);
    const typography = () => page.locator("html").getAttribute("data-terminal-typography").then((value) => JSON.parse(value ?? "{}"));
    await expect.poll(typography).toMatchObject({ fontSize: 16, fontFamily: '"Consolas", monospace', fontWeight: 600, lineHeight: 1.35 });
    await expect(page.locator("html")).toHaveAttribute("data-terminal-prompt", /^ready>\s*$/);
    await page.locator(".xterm-screen").hover();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(typography).toMatchObject({ fontSize: 17 });
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await expect.poll(typography).toMatchObject({ fontSize: 16 });
    await page.mouse.wheel(0, 100);
    await expect.poll(typography).toMatchObject({ fontSize: 16 });
    await expect(page.locator("html")).toHaveAttribute("data-terminal-prompt", /^ready>\s*$/);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [320, 768, 1440]) {
    test(`terminal search and completion: ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/terminal-tools.html?theme=${theme}`);
      const terminal = page.locator(".xterm-helper-textarea");
      await expect(page.locator("html")).toHaveAttribute("data-terminal-prompt", /^ready>\s*$/);
      await expect(page.getByRole("button", { name: "Find in terminal" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Find in terminal" })).toHaveCount(0);
      await expect(page.locator("[data-terminal-tools]")).toHaveCount(0);
      await page.getByRole("button", { name: "Find in terminal" }).click();
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
      const ghost = page
        .locator('.xterm-screen [aria-hidden="true"]')
        .filter({ hasText: "status" });
      await expect(ghost).toBeVisible();
      await expect(list).toHaveCount(0);
      await terminal.press("Control+Space");
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
      await terminal.press("Control+Space");
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

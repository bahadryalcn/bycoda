import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { WEBGL_IDLE_DROP_MS } from "../../../src/features/terminal/runtime/terminalWebgl";
import { terminalScrollbarWidth } from "../../../src/features/terminal/model/terminalLayout";

for (const theme of ["light", "dark"]) {
  test(`terminal returns from a hidden panel: ${theme}`, async ({ page }, info) => {
    test.setTimeout(WEBGL_IDLE_DROP_MS + 20_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(`/tests/browser/terminal/terminal-tools.html?theme=${theme}`);
    const panel = page.locator(".project-terminal-dock");
    const canvas = page.locator(".xterm-screen canvas");
    const root = page.locator("html");
    const calls = () =>
      page.evaluate(
        () =>
          JSON.parse(document.documentElement.dataset.terminalPtyCalls ?? "[]") as {
            op: string;
            id: string;
            cols?: number;
            rows?: number;
          }[],
      );
    const grid = async () => {
      const last = (await calls())
        .reverse()
        .find((call) => call.cols !== undefined && call.rows !== undefined);
      return { cols: last?.cols ?? 0, rows: last?.rows ?? 0 };
    };
    const geometry = async () => {
      const reported = await grid();
      return page.locator(".bycoda-terminal-host").evaluate(
        (host, data) => {
          const screen = host.querySelector(".xterm-screen")!.getBoundingClientRect();
          const cellWidth = screen.width / data.reported.cols;
          const rowHeight = screen.height / data.reported.rows;
          return {
            ...data.reported,
            cellWidth,
            rowHeight,
            availableWidth: host.clientWidth - data.gutter,
            availableHeight: host.clientHeight,
            screenWidth: screen.width,
            screenHeight: screen.height,
          };
        },
        { reported, gutter: terminalScrollbarWidth() },
      );
    };
    const fits = async () => {
      const actual = await geometry();
      const gapX = actual.availableWidth - actual.screenWidth;
      const gapY = actual.availableHeight - actual.screenHeight;
      return (
        actual.cols > 0 &&
        actual.rows > 0 &&
        Number.isFinite(actual.cellWidth) &&
        actual.cellWidth > 0 &&
        Number.isFinite(actual.rowHeight) &&
        actual.rowHeight > 0 &&
        gapX >= -1 &&
        gapX < actual.cellWidth + 1 &&
        gapY >= -1 &&
        gapY < actual.rowHeight + 1
      );
    };
    await expect(page.locator("html")).toHaveAttribute("data-terminal-prompt", /^ready>\s*$/);
    await expect(canvas.first()).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect.poll(async () => (await grid()).cols).toBeGreaterThan(0);
    let wideGrid = await grid();
    let wideSpace = { width: 0, height: 0 };
    let narrowCols = 0;
    for (const [index, width] of [1000, 390, 1000].entries()) {
      if (index === 2 && theme === "dark") {
        const before = await geometry();
        const fontSize = await root
          .getAttribute("data-terminal-typography")
          .then((value) => JSON.parse(value!).fontSize as number);
        await page.locator(".xterm-screen").hover();
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -100);
        await page.keyboard.up("Control");
        await expect
          .poll(() =>
            root
              .getAttribute("data-terminal-typography")
              .then((value) => JSON.parse(value!).fontSize),
          )
          .toBe(fontSize + 1);
        await expect
          .poll(async () => (await geometry()).cellWidth)
          .toBeGreaterThan(before.cellWidth);
        expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
      }
      const retained = await canvas.elementHandles();
      const previousPrompt = await root.getAttribute("data-terminal-prompt");
      await panel.evaluate((element) => {
        element.style.display = "none";
      });
      // Observe actual PTY visibility delivery, independently of the renderer's
      // grace period. Quick dock toggles keep these same render resources.
      await expect(root).toHaveAttribute(
        "data-terminal-pty-visibility",
        JSON.stringify({ id: "fixture", visible: false }),
      );
      await expect(canvas.first()).toBeHidden();
      await expect(canvas).toHaveCount(retained.length);
      for (const node of retained)
        expect(await node.evaluate((element) => element.isConnected)).toBe(true);
      await page.evaluate(() =>
        document.dispatchEvent(
          new CustomEvent("test-pty-output", {
            detail: `\r\n${"background output ".repeat(20)}\r\nreturned> `,
          }),
        ),
      );
      if (index === 2) {
        // One genuinely idle hide must reclaim the renderer after its canonical
        // grace period, without retiring the PTY or parsing its held output.
        await expect(canvas).toHaveCount(0, { timeout: WEBGL_IDLE_DROP_MS + 3_000 });
        for (const node of retained)
          expect(await node.evaluate((element) => element.isConnected)).toBe(false);
        await expect(root).toHaveAttribute("data-terminal-prompt", previousPrompt!);
      }
      await page.setViewportSize({ width, height: 800 });
      await panel.evaluate((element) => {
        element.style.display = "";
      });
      await expect(root).toHaveAttribute(
        "data-terminal-pty-visibility",
        JSON.stringify({ id: "fixture", visible: true }),
      );
      await expect(canvas.first()).toBeVisible();
      if (index < 2) {
        await expect(canvas).toHaveCount(retained.length);
        for (const node of retained)
          expect(await node.evaluate((element) => element.isConnected)).toBe(true);
      }
      try {
        await expect.poll(fits).toBe(true);
      } finally {
        await info.attach(`return-grid-${index}`, {
          body: JSON.stringify(await geometry()),
          contentType: "application/json",
        });
      }
      // Restoring the viewport restores physical space, not a cached column
      // count: current font metrics can legitimately change between returns.
      if (index === 0) {
        wideGrid = await grid();
        const actual = await geometry();
        wideSpace = { width: actual.availableWidth, height: actual.availableHeight };
      } else if (width === 390) {
        await expect.poll(async () => (await grid()).cols).toBeLessThan(wideGrid.cols);
        expect((await geometry()).availableWidth).toBeLessThan(wideSpace.width);
        narrowCols = (await grid()).cols;
      } else {
        await expect.poll(async () => (await grid()).cols).toBeGreaterThan(narrowCols);
        const actual = await geometry();
        expect({ width: actual.availableWidth, height: actual.availableHeight }).toEqual(wideSpace);
      }
      await expect(page.locator("html")).toHaveAttribute("data-terminal-prompt", /^returned>\s*$/);
      await page.locator(".xterm-helper-textarea").pressSequentially("ok");
      await expect(page.locator("html")).toHaveAttribute("data-terminal-prompt", /^returned> ok$/);
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`returned-${index}-${width}.png`),
      });
      for (const node of retained) await node.dispose();
    }
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(fits).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: info.outputPath("returned-800.png"),
    });
    const traffic = await calls();
    expect(traffic.filter((call) => call.op === "spawn")).toHaveLength(1);
    expect(traffic.filter((call) => call.op === "kill")).toHaveLength(0);
    expect(traffic.every((call) => call.id === "fixture")).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1440]) {
    test(`remote suggestion list: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/terminal/terminal-tools.html?remote&theme=${theme}`);
      const terminal = page.locator(".xterm-helper-textarea");
      await terminal.pressSequentially("cl");
      const list = page.getByRole("listbox", { name: "Remote command suggestions" });
      await expect(list).toBeVisible();
      await expect(list.getByRole("option")).toHaveCount(3);
      await expect(terminal).toBeFocused();
      await terminal.press("Alt+ArrowDown");
      await expect(list.locator('[aria-selected="true"]')).toHaveText("clear previous");
      await expect(
        page.locator('.xterm-screen [aria-hidden="true"]').filter({ hasText: "ear previous" }),
      ).toBeVisible();
      const box = await list.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await terminal.press("Tab");
      await expect(page.locator("html")).not.toHaveAttribute("data-remote-executed");
      await terminal.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("data-remote-executed", "clear previous");
      await terminal.pressSequentially("cl");
      await terminal.press("Control+Space");
      const selection = page.getByLabel("Remote suggestion selection", { exact: true });
      await expect(selection).toBeFocused();
      await selection.press("ArrowDown");
      await selection.press("Enter");
      await expect(terminal).toBeFocused();
      await expect(page.locator("html")).toHaveAttribute("data-remote-executed", "clear previous");
      const directory = "temp/verification/2026-10-21-server-autocomplete";
      mkdirSync(directory, { recursive: true });
      await terminal.press("Enter");
      await terminal.pressSequentially("cl");
      await expect(list).toBeVisible();
      await page.screenshot({ path: `${directory}/remote-${theme}-${width}.png` });
    });
  }
}

for (const theme of ["light", "dark"]) {
  test(`terminal typography wheel zoom: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() =>
      localStorage.setItem(
        "bycoda.appearancePreferences.v1",
        JSON.stringify({
          terminalSize: 16,
          terminalFont: "Consolas",
          terminalWeight: 600,
          terminalLineHeight: 1.35,
        }),
      ),
    );
    await page.goto(`/tests/browser/terminal/terminal-tools.html?theme=${theme}`);
    const typography = () =>
      page
        .locator("html")
        .getAttribute("data-terminal-typography")
        .then((value) => JSON.parse(value ?? "{}"));
    await expect.poll(typography).toMatchObject({
      fontSize: 16,
      fontFamily: '"Consolas", monospace',
      fontWeight: 600,
      lineHeight: 1.35,
    });
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
      await page.goto(`/tests/browser/terminal/terminal-tools.html?theme=${theme}`);
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

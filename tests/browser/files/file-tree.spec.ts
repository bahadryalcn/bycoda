import { expect, test } from "@playwright/test";

test("file tree preserves selection, inline rename, windowing and native external drop at both densities and themes", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/files/file-tree.html");
  const row = (path: string) => page.locator(`[role="treeitem"][title="/fixture/${path}"]`);
  await expect(row("a.ts")).toBeVisible();
  await row("a.ts").click();
  await row("b.ts").click({ modifiers: ["Control"] });
  await expect(row("a.ts")).toHaveAttribute("aria-selected", "true");
  await expect(row("b.ts")).toHaveAttribute("aria-selected", "true");
  await row("a.ts").click();
  await row("a.ts").press("F2");
  const rename = page.getByRole("textbox", {
    name: "Type file name. Press Enter to confirm or Escape to cancel.",
  });
  await expect(rename).toBeFocused();
  expect(
    await rename.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([0, 1]);
  await rename.fill("renamed.ts");
  await rename.press("Enter");
  await expect(row("renamed.ts")).toBeVisible();
  await row("renamed.ts").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  await expect(rename).toBeFocused();
  await rename.press("Escape");
  await row("src").click();
  await expect(row("src/deep.ts")).toBeVisible();
  await row("src").press("ArrowRight");
  await expect(row("src/deep.ts")).toHaveAttribute("aria-selected", "true");
  await row("bulk").click();
  await expect(row("bulk/item199.ts")).toBeAttached();
  await expect(row("bulk/item249.ts")).toHaveCount(0);
  await page.getByRole("button", { name: "Show 150 more…", exact: true }).click();
  await expect(row("bulk/item249.ts")).toBeAttached();
  await row("bulk").click();
  await row("dest").scrollIntoViewIfNeeded();
  const target = await row("dest").boundingBox();
  const point = { x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 };
  await page.evaluate(
    (point) =>
      (
        window as unknown as { treeNativeEmit: (name: string, payload: unknown) => void }
      ).treeNativeEmit("tauri://drag-over", { position: point }),
    point,
  );
  // The shared mark and badge replace the row's own external-drop highlight.
  await expect(row("dest")).toHaveAttribute("data-drop-indicator", "inside");
  await expect(row("dest")).not.toHaveAttribute("data-tree-drop-target", "true");
  await expect(page.locator(".pointer-drop-hint")).toHaveText("Copy files into dest");
  await page.evaluate(
    (point) =>
      (
        window as unknown as { treeNativeEmit: (name: string, payload: unknown) => void }
      ).treeNativeEmit("tauri://drag-drop", { position: point, paths: ["/external/dropped.txt"] }),
    point,
  );
  await expect(row("dest")).toHaveAttribute("aria-expanded", "true");
  await expect(row("dest/dropped.txt")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { treeOperations: { command: string }[] }).treeOperations.map(
        (x) => x.command,
      ),
    ),
  ).toEqual(["rename_path", "copy_path"]);
  for (const density of ["compact", "comfortable", "touch"])
    for (const light of [false, true])
      for (const width of [390, 1024]) {
        await page.evaluate(
          (density) => (document.documentElement.dataset.controlDensity = density),
          density,
        );
        await page.setViewportSize({ width, height: 700 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          light,
        );
        await expect(row("renamed.ts")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: info.outputPath("file-tree-narrow-light.png") });
});

test("preview find paints match/current highlights with shared theme roles and keeps keyboard navigation", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/files/file-tree.html?preview");
  await page.getByLabel("Markdown preview", { exact: true }).focus();
  await page.keyboard.press("Control+f");
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await find.fill("needle");
  await expect(page.getByLabel("Find in preview", { exact: true })).toContainText("1 of 2");
  await find.press("Enter");
  await expect(page.getByLabel("Find in preview", { exact: true })).toContainText("2 of 2");
  for (const light of [false, true]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      light,
    );
    const colors = await page
      .locator("p")
      .first()
      .evaluate((node) => [
        getComputedStyle(node, "::highlight(bycoda-file-preview-search-match)").backgroundColor,
        getComputedStyle(node, "::highlight(bycoda-file-preview-search-current)").backgroundColor,
      ]);
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[0]).not.toBe("rgba(0, 0, 0, 0)");
    await page.screenshot({
      path: info.outputPath(`preview-highlights-${light ? "light" : "dark"}.png`),
    });
  }
  await find.press("Escape");
  await expect(find).toHaveCount(0);
});

const shotDir = "temp/verification/vis-dnd-3";

for (const theme of ["dark", "light"] as const) {
  test(`explorer drag shows one move/copy badge, an inside mark, a blocked reason and cleans up (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tests/browser/files/file-tree.html?theme=${theme}`);
    const row = (path: string) => page.locator(`[role="treeitem"][title="/fixture/${path}"]`);
    const badge = page.locator(".pointer-drop-hint");
    const marks = page.locator("[data-drop-indicator]");
    await expect(row("a.ts")).toBeVisible();
    const from = (await row("a.ts").boundingBox())!;
    const dest = (await row("dest").boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(dest.x + 60, dest.y + dest.height / 2, { steps: 8 });
    await expect(badge).toHaveText("Move to dest");
    await expect(row("dest")).toHaveAttribute("data-drop-indicator", "inside");
    await expect(marks).toHaveCount(1);
    await expect(badge).toHaveCount(1);
    await page.screenshot({ path: `${shotDir}/explorer-drag-move-${theme}-1280x800.png` });
    await page.keyboard.down("Control");
    await expect(badge).toHaveText("Copy to dest");
    await page.screenshot({ path: `${shotDir}/explorer-drag-copy-${theme}-1280x800.png` });
    await page.keyboard.up("Control");
    await page.keyboard.press("Escape");
    await expect(badge).toHaveCount(0);
    await expect(marks).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.classList.contains("is-grabbing")),
    ).toBe(false);
    await page.mouse.up();
    expect(
      await page.evaluate(
        () => (window as unknown as { treeOperations: unknown[] }).treeOperations.length,
      ),
    ).toBe(0);

    // A folder cannot go into itself: blocked mark and the reason, in the same single badge.
    const src = (await row("src").boundingBox())!;
    await page.mouse.move(src.x + 40, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 90, src.y + src.height / 2, { steps: 6 });
    await expect(badge).toHaveText("Cannot drop a folder into itself");
    await expect(row("src")).toHaveAttribute("data-drop-indicator", "blocked");
    await page.screenshot({ path: `${shotDir}/explorer-drag-blocked-${theme}-1280x800.png` });
    // Losing the window mid-drag cleans up the same way.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(badge).toHaveCount(0);
    await expect(marks).toHaveCount(0);
    await page.mouse.up();
  });

  test(`explorer disables creating with a visible reason while the machine is unreachable (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tests/browser/files/file-tree.html?theme=${theme}&remote=down`);
    const newFile = page.locator('[data-explorer-action="new-file"]');
    const newFolder = page.locator('[data-explorer-action="new-folder"]');
    await expect(newFile).toBeDisabled();
    await expect(newFolder).toBeDisabled();
    await expect(newFile).toHaveAttribute("aria-label", /This machine is unreachable/);
    // The shared tooltip (not a native title bubble) shows the reason to pointer users.
    await newFile.hover();
    await expect(page.getByRole("tooltip")).toContainText("This machine is unreachable");
    await page.screenshot({
      path: `${shotDir}/explorer-create-disabled-header-${theme}-1280x800.png`,
      clip: { x: 0, y: 0, width: 640, height: 200 },
    });
    await page.locator("[data-explorer-root]").click({ button: "right" });
    const item = page.getByRole("menuitem", { name: /^New File/ });
    await expect(item).toContainText("This machine is unreachable");
    await expect(item).toBeDisabled();
    await page.screenshot({
      path: `${shotDir}/explorer-create-disabled-menu-${theme}-1280x800.png`,
    });
  });
}

const imeShotDir = "temp/verification/vis-explorer-2";
type ImeWindow = Window & {
  imeLog: string[];
  treeOperations: { command: string; args: Record<string, unknown> }[];
};

test("inline name editor keeps IME composition: Enter and Escape during composition neither commit nor cancel", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "IME key events are dispatched through a Chromium CDP session",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/tests/browser/files/file-tree.html?theme=dark");
  const cdp = await page.context().newCDPSession(page);
  const press = async (key: string, code: string, keyCode: number) => {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  };
  const operations = () => page.evaluate(() => (window as unknown as ImeWindow).treeOperations);
  await expect(page.locator(`[role="treeitem"][title="/fixture/a.ts"]`)).toBeVisible();
  await page.locator('[data-explorer-action="new-file"]').click();
  const input = page.getByRole("textbox", { name: /^Type file name/ });
  await expect(input).toBeFocused();
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as ImeWindow).imeLog = log;
    const field = document.activeElement as HTMLInputElement;
    for (const type of ["compositionstart", "compositionupdate", "compositionend"])
      field.addEventListener(type, () => log.push(type));
    field.addEventListener("keydown", (e) =>
      log.push(`keydown:${e.key}:${e.isComposing}:${e.keyCode}`),
    );
  });

  // Composition in progress: the candidate text is pending, not part of the name yet.
  await cdp.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 });
  await expect(input).toHaveValue("にほん");
  // Enter confirms the candidate in the IME (the editor does not commit) ...
  await press("Enter", "Enter", 13);
  await expect(input).toBeVisible();
  expect(await operations()).toEqual([]);
  // ... and Escape dismisses the candidate list (the editor does not cancel the whole edit).
  await press("Escape", "Escape", 27);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  expect(await operations()).toEqual([]);

  // Committing the composed text ends composition; the name keeps what the IME produced.
  await cdp.send("Input.insertText", { text: "日本語.ts" });
  await expect(input).toHaveValue(/日本語\.ts$/);
  const log = await page.evaluate(() => (window as unknown as ImeWindow).imeLog);
  expect(log).toContain("compositionstart");
  expect(log.some((entry) => /^keydown:(Enter|Escape):true:/.test(entry))).toBe(true);
  expect(await operations()).toEqual([]);

  // After composition has ended, Enter commits exactly once with the composed name.
  const name = await input.inputValue();
  await press("Enter", "Enter", 13);
  await expect(input).toHaveCount(0);
  const done = await operations();
  expect(done).toHaveLength(1);
  expect(done[0].args.name).toBe(name);

  // WebKit ends composition before the confirming keydown (isComposing false, keyCode 229).
  await page.locator('[data-explorer-action="new-file"]').click();
  const second = page.getByRole("textbox", { name: /^Type file name/ });
  await second.fill("safari.ts");
  await second.evaluate((field) => {
    field.dispatchEvent(new CompositionEvent("compositionend", { data: "", bubbles: true }));
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        isComposing: false,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(second).toBeVisible();
  expect(await operations()).toHaveLength(1);
  await page.screenshot({ path: `${imeShotDir}/ime-composition-1280x800.png` });
  await second.press("Escape");
  await expect(second).toHaveCount(0);
});

type RowGeometry = {
  label: string;
  density: string;
  theme: string;
  referenceRow: number;
  nameRow: number;
  input: {
    width: number;
    height: number;
    topInset: number;
    bottomInset: number;
    centerOffset: number;
  };
  iconCenterOffset: number;
  messageGap: number | null;
  messageToNext: number | null;
  messageInsetMatchesInput: boolean | null;
  textClipped: boolean;
  horizontalOverflow: boolean;
};

const measureNameRow = ({
  label,
  density,
  theme,
}: {
  label: string;
  density: string;
  theme: string;
}): RowGeometry => {
  const wrapper = document.querySelector<HTMLElement>("[data-name-row]")!;
  const line = wrapper.firstElementChild as HTMLElement;
  const input = wrapper.querySelector<HTMLInputElement>("input")!;
  const icon =
    line.querySelector<SVGElement>("svg:not(.lucide-chevron-right)") ??
    line.querySelectorAll("svg")[1];
  const reference = document.querySelector<HTMLElement>(
    '[role="treeitem"][title$="/logo.svg"], [role="treeitem"][title$="/a.ts"]',
  )!;
  const lineRect = line.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  const message = wrapper.querySelector<HTMLElement>('[role="alert"], [role="status"]');
  const messageRect = message?.getBoundingClientRect();
  const next = wrapper.nextElementSibling as HTMLElement | null;
  const nextRect = next?.getBoundingClientRect();
  const iconRect = icon?.getBoundingClientRect();
  const scroller = wrapper.closest<HTMLElement>(".overflow-y-auto") ?? document.documentElement;
  return {
    label,
    density,
    theme,
    referenceRow: reference.getBoundingClientRect().height,
    nameRow: lineRect.height,
    input: {
      width: inputRect.width,
      height: inputRect.height,
      topInset: inputRect.top - lineRect.top,
      bottomInset: lineRect.bottom - inputRect.bottom,
      centerOffset: inputRect.top + inputRect.height / 2 - (lineRect.top + lineRect.height / 2),
    },
    iconCenterOffset: iconRect
      ? iconRect.top + iconRect.height / 2 - (inputRect.top + inputRect.height / 2)
      : NaN,
    messageGap: messageRect ? messageRect.top - lineRect.bottom : null,
    messageToNext: messageRect && nextRect ? nextRect.top - messageRect.bottom : null,
    messageInsetMatchesInput: messageRect
      ? Math.abs(
          parseFloat(getComputedStyle(message!).paddingInlineStart) +
            messageRect.left -
            inputRect.left,
        ) < 1.5
      : null,
    textClipped: input.scrollHeight > input.clientHeight + 1,
    horizontalOverflow:
      inputRect.right > scroller.getBoundingClientRect().right + 0.5 ||
      (messageRect ? messageRect.right > scroller.getBoundingClientRect().right + 0.5 : false) ||
      scroller.scrollWidth > scroller.clientWidth + 1,
  };
};

for (const theme of ["dark", "light"] as const)
  test(`inline create/rename/validation rows stay aligned at every control density (${theme})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const results: RowGeometry[] = [];
    for (const density of ["compact", "comfortable", "touch"] as const) {
      await page.goto(`/tests/browser/files/file-tree.html?theme=${theme}`);
      await page.evaluate(
        (density) => (document.documentElement.dataset.controlDensity = density),
        density,
      );
      const row = (path: string) => page.locator(`[role="treeitem"][title="/fixture/${path}"]`);
      const field = page.getByRole("textbox", { name: /^Type file name/ });
      const shot = (name: string) =>
        page.screenshot({
          path: `${imeShotDir}/density-${density}-${name}-${theme}-1280x800.png`,
          clip: { x: 0, y: 0, width: 420, height: 480 },
        });
      const measure = async (label: string) => {
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        results.push(await page.evaluate(measureNameRow, { label, density, theme }));
      };
      await row("assets").click();
      await expect(row("assets/logo.svg")).toBeVisible();
      // Create: empty, then a colliding name (validation), then a rejected submit.
      await page.locator('[data-explorer-action="new-file"]').click();
      await expect(field).toBeFocused();
      await measure("create");
      await shot("create");
      await field.fill("logo.svg");
      await expect(page.locator('[data-name-row] [role="alert"]')).toBeVisible();
      await measure("create-validation");
      await shot("create-validation");
      await field.fill("denied.ts");
      await field.press("Enter");
      await expect(page.locator('[data-name-row] [role="alert"]')).toContainText(
        "Permission denied",
      );
      await measure("create-submit-error");
      await shot("create-submit-error");
      await field.press("Escape");
      await expect(field).toHaveCount(0);
      // Folder create and rename of a folder (toggle chevron slot is drawn).
      await page.locator('[data-explorer-action="new-folder"]').click();
      await expect(field).toBeFocused();
      await measure("create-folder");
      await field.press("Escape");
      await row("assets/logo.svg").click();
      await row("assets/logo.svg").press("F2");
      await expect(field).toBeFocused();
      await measure("rename");
      await shot("rename");
      await field.fill("images");
      await expect(page.locator('[data-name-row] [role="alert"]')).toBeVisible();
      await measure("rename-validation");
      await shot("rename-validation");
      await field.press("Escape");
    }
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${imeShotDir}/density-metrics-${theme}.json`, JSON.stringify(results, null, 2));
    for (const r of results) {
      const where = `${r.density}/${r.label}/${r.theme}`;
      expect(r.nameRow, `${where} row height equals tree row`).toBeCloseTo(r.referenceRow, 0);
      expect(r.input.height, `${where} input fits row`).toBeLessThanOrEqual(r.nameRow);
      expect(r.input.topInset, `${where} top inset`).toBeGreaterThanOrEqual(0);
      expect(r.input.bottomInset, `${where} bottom inset`).toBeGreaterThanOrEqual(0);
      expect(Math.abs(r.input.centerOffset), `${where} input centered`).toBeLessThanOrEqual(0.5);
      if (!Number.isNaN(r.iconCenterOffset))
        expect(Math.abs(r.iconCenterOffset), `${where} icon centered on input`).toBeLessThanOrEqual(
          1,
        );
      if (r.messageGap !== null)
        expect(r.messageGap, `${where} message under row`).toBeGreaterThanOrEqual(-0.5);
      if (r.messageToNext !== null)
        expect(r.messageToNext, `${where} message above next row`).toBeGreaterThanOrEqual(-0.5);
      expect(r.textClipped, `${where} text not clipped`).toBe(false);
      expect(r.horizontalOverflow, `${where} no horizontal overflow`).toBe(false);
    }
  });

for (const theme of ["light", "dark"] as const) {
  test(`external drop: the tree marks the receiving folder and says how many items are copied into it ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/files/file-tree.html?theme=${theme}`);
    const row = (path: string) => page.locator(`[role="treeitem"][title="/fixture/${path}"]`);
    const badge = page.locator(".pointer-drop-hint");
    const marks = page.locator("[data-drop-indicator]");
    await expect(row("src")).toBeVisible();
    const emit = (name: string, payload: unknown) =>
      page.evaluate(
        ([name, payload]) =>
          (
            window as unknown as { treeNativeEmit: (name: string, payload: unknown) => void }
          ).treeNativeEmit(name as string, payload),
        [name, payload] as const,
      );
    const centre = async (path: string) => {
      const box = (await row(path).boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const paths = ["/external/a.txt", "/external/b.txt", "/external/c.txt"];

    // Synthesized tauri://drag-* events through the fixture's event bus (the native handler, not a
    // real OS drag). A folder row is the target itself.
    await emit("tauri://drag-enter", { paths, position: await centre("src") });
    await expect(row("src")).toHaveAttribute("data-drop-indicator", "inside");
    await expect(badge).toHaveText("Copy 3 items into src");
    await expect(marks).toHaveCount(1);
    await expect(page.locator("[data-drag-announcer]")).toHaveText("Copy 3 items into src");
    await page.screenshot({ path: `temp/verification/vis-dnd-4/tree-copy-3-${theme}.png` });

    // A file row targets its parent: the project root, marked on the tree itself.
    await emit("tauri://drag-over", { position: await centre("a.ts") });
    await expect(badge).toHaveText("Copy 3 items into fixture");
    await expect(marks).toHaveCount(1);
    await expect(marks.first()).not.toHaveAttribute("role", "treeitem");
    await page.screenshot({ path: `temp/verification/vis-dnd-4/tree-copy-root-${theme}.png` });

    // Leave, Escape and window blur each clear both marks.
    await emit("tauri://drag-leave", {});
    await expect(marks).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await emit("tauri://drag-enter", { paths: paths.slice(0, 1), position: await centre("src") });
    await expect(badge).toHaveText("Copy 1 item into src");
    await page.keyboard.press("Escape");
    await expect(badge).toHaveCount(0);
    await emit("tauri://drag-enter", { paths: paths.slice(0, 1), position: await centre("src") });
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(marks).toHaveCount(0);

    // Dropping copies once (the operation owner is unchanged) and clears the feedback.
    await emit("tauri://drag-enter", { paths: paths.slice(0, 2), position: await centre("dest") });
    await expect(badge).toHaveText("Copy 2 items into dest");
    await emit("tauri://drag-drop", { paths: paths.slice(0, 2), position: await centre("dest") });
    await expect(badge).toHaveCount(0);
    await expect(marks).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { treeOperations: { command: string }[] }).treeOperations.filter(
              (item) => item.command === "copy_path",
            ).length,
        ),
      )
      .toBe(2);
  });
}

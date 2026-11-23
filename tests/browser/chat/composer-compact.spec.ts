import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PANE_MATRIX, expectLayoutContracts, openPane } from "../support/uiLayoutAssertions";

// Fixture evidence for the composer reading mode (V2-001). Captures are written
// only when V2_CAPTURE is set; the assertions always run.
const captureDir = process.env.V2_CAPTURE_DIR ?? "temp/verification/v2-001";
if (process.env.V2_CAPTURE) mkdirSync(captureDir, { recursive: true });
async function capture(page: Page, name: string) {
  if (process.env.V2_CAPTURE) {
    const folder = process.env.V2_CAPTURE_DIR
      ? `${captureDir}/${test.info().project.name}`
      : captureDir;
    mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${name}.png` });
  }
}

type Fixture = { events: { sends: number; stops: number } };
const fixtureEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { compactFixture: Fixture }).compactFixture.events);
const stream = (page: Page, chunks: number) =>
  page.evaluate(
    (count) =>
      (
        window as unknown as { compactFixture: { stream: (chunks: number) => void } }
      ).compactFixture.stream(count),
    chunks,
  );
const finish = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { compactFixture: { finish: () => void } }).compactFixture.finish(),
  );

const url = (query: Record<string, string> = {}, light = false) => {
  const params = new URLSearchParams(query);
  if (light) params.set("light", "");
  return `/tests/browser/chat/composer-compact.html?${params}`;
};
const scroller = (page: Page) => page.locator(".agent-transcript");
const reading = (page: Page) => page.locator("[data-composer][data-composer-reading]");
const field = (page: Page) => page.locator("[data-composer] textarea");

for (const [width, light] of [
  [800, false],
  [800, true],
  [1280, false],
  [1280, true],
] as const) {
  const surface = `${light ? "light" : "dark"}-${width}`;
  test(`Markdown stays formatted after the inline editor activates (${surface})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(url({ inlineExamples: "repeated-pdf" }, light));
    const editor = page.locator("[data-composer-inline-input]");
    await expect(editor.locator('[data-inline-reference="attachment"]')).toHaveCount(2);
    const source =
      "## İş teklifleri\n\n**Eksik kalanlar:** Spam araması boş döndü. [file1]\n\n- `Takip` notu";
    await field(page).evaluate((input: HTMLTextAreaElement) => {
      input.focus();
      input.select();
    });
    await page.keyboard.insertText(source);
    await expect(field(page)).toHaveValue(source);
    await expect(editor.locator('[data-inline-reference="attachment"]')).toHaveCount(1);
    await expect(editor.locator('[data-draft-markdown="strong"]')).toContainText("Eksik kalanlar:");
    await expect(editor.locator('[data-draft-markdown="heading"]')).toContainText("İş teklifleri");
    await expect(editor.locator('[data-draft-markdown="code"]')).toContainText("Takip");
    const marker = editor
      .locator('[data-draft-markdown="strong"] [data-draft-markdown="mark"]')
      .first();
    await expect(marker).toHaveCSS("color", "rgba(0, 0, 0, 0)");
    await field(page).evaluate((input: HTMLTextAreaElement) => {
      const start = input.value.indexOf("**");
      input.setSelectionRange(start + 1, start + 1);
    });
    await expect(marker).toHaveAttribute("data-editing-mark", "");
    await expect(marker).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
    await editor.blur();
    await expect(marker).toHaveCSS("color", "rgba(0, 0, 0, 0)");
    await editor.focus();
    const scroller = page.locator(".cm-scroller");
    const shortHeight = await scroller.evaluate((element) => element.clientHeight);
    expect(shortHeight).toBeLessThan(180);
    await field(page).evaluate((input: HTMLTextAreaElement) => {
      input.setSelectionRange(input.value.length, input.value.length);
    });
    await page.keyboard.insertText(`\n${"\nBir satır daha.".repeat(15)}`);
    await expect.poll(() => scroller.evaluate((element) => element.clientHeight)).toBe(180);
    expect(await scroller.evaluate((element) => element.scrollHeight)).toBeGreaterThan(180);
    await scroller.evaluate((element) => (element.scrollTop = 0));
    await capture(page, `markdown-${surface}`);
  });
}

test("selecting all with an inline skill keeps suggestions closed", async ({ page }) => {
  for (const light of [false, true]) {
    await page.goto(url({ inlineExamples: "repeated-pdf" }, light));
    const editor = page.locator("[data-composer-inline-input]");
    const picker = page.locator("[data-skill-picker]");
    await expect(editor.locator('[data-inline-reference="skill"]')).toHaveText("ui-ux-pro-max");
    const original = await field(page).inputValue();
    await expect(picker).toBeHidden();

    await editor.press("ControlOrMeta+a");
    await expect
      .poll(() =>
        field(page).evaluate((input: HTMLTextAreaElement) => [
          input.selectionStart,
          input.selectionEnd,
        ]),
      )
      .toEqual([0, original.length]);
    await expect(picker).toBeHidden();
    await expect(field(page)).toHaveValue(original);
    await capture(page, `select-all-skill-${light ? "light" : "dark"}`);
  }
});

test("cut and paste restores a PNG attachment inside the sentence", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are required");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(url({ clipboardRoundTrip: "" }));
  const image = page.locator('[data-composer-inline-input] [data-inline-reference="attachment"]');
  await expect(image).toHaveAccessibleName("Open image.png");
  const original = await field(page).inputValue();
  await field(page).evaluate((input: HTMLTextAreaElement) => {
    input.focus();
    input.select();
  });
  await page.keyboard.press("ControlOrMeta+x");
  await expect(field(page)).toHaveValue("");
  await expect(image).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(field(page)).toHaveValue(original);
  await expect(image).toHaveAccessibleName("Open image.png");
  await expect(page.locator("html")).toHaveAttribute("data-clipboard-image-bytes", "68");
});

// The copy handler writes the clipboard once, asynchronously (the formats wait for the file
// bytes). Chromium rejects a read that overlaps that write with an InvalidStateError ("Clipboard
// data has changed"); a read started right after the key press can land inside it. That is the
// writer arriving, not a failure: report no HTML yet so the poll reads again, and let any other
// error through.
const clipboardHtml = (page: Page) =>
  page.evaluate(async () => {
    try {
      const [item] = await navigator.clipboard.read();
      return item?.types.includes("text/html")
        ? await (await item.getType("text/html")).text()
        : "";
    } catch (error) {
      if (error instanceof DOMException && error.name === "InvalidStateError") return "";
      throw error;
    }
  });

test("inline composer cuts real file bytes and restores the reference on undo", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are required");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(url({ inlineExamples: "" }));
  const editor = page.locator("[data-composer-inline-input]");
  const csv = editor.locator("[data-inline-reference]").filter({ hasText: "bycoda-usage.csv" });
  await expect(csv).toBeVisible();
  const original = await field(page).inputValue();
  await field(page).evaluate((input: HTMLTextAreaElement) => {
    const token = /\[[^\]]*bycoda-usage\.csv[^\]]*\]/.exec(input.value)!;
    input.focus();
    input.setSelectionRange(token.index, token.index + token[0].length);
  });
  await page.keyboard.press("ControlOrMeta+c");
  let html = "";
  await expect
    .poll(async () => (html = await clipboardHtml(page)))
    .toContain('data-bycoda-file="bycoda-usage.csv"');
  expect(html).toContain("data:text/csv;base64,ZmVhdHVyZSxldmVudHMKY29tcG9zZXIsMTI4");
  await expect(csv).toBeVisible();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(csv).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(field(page)).toHaveValue(original);
  await expect(csv).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
  await expect(csv).toHaveCount(0);
});

test("the session composer renders all eight compact references in the editable line", async ({
  page,
  browserName,
}) => {
  const evidence = "temp/verification/composer-compact-references";
  mkdirSync(evidence, { recursive: true });
  for (const [width, light] of [
    [800, false],
    [800, true],
    [1280, false],
    [1280, true],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(url({ inlineExamples: "" }, light));
    const box = page.locator("[data-composer]");
    const editor = box.locator("[data-composer-inline-input]");
    const references = editor.locator("[data-inline-reference]");
    await expect(references).toHaveCount(8);
    await expect(editor.locator('[data-inline-reference="skill"]')).toHaveAttribute(
      "spellcheck",
      "false",
    );
    await expect(editor.locator('[data-inline-reference="group"]')).toHaveAttribute(
      "spellcheck",
      "false",
    );
    await expect(editor).toHaveAttribute("spellcheck", "true");
    await expect(editor).toHaveCSS("font-family", /sans-serif/);
    await expect(box.locator("[data-attachment-chip]")).toHaveCount(4);
    await expect(
      box.locator('[data-attachment-chip="image"]').getByText("158 KB", { exact: true }),
    ).toBeVisible();
    await expect(references.locator(":scope > span")).toHaveText([
      "image.png",
      "Bahadir-Halay.pdf",
      "bycoda-usage.csv",
      "bycoda-export.json",
      "PreviewTunnel.ts",
      "github.com · project",
      "ui-ux-pro-max",
      "Design and polish interfaces",
    ]);
    expect(
      await references.evaluateAll((chips) =>
        chips.every((chip) => {
          const style = getComputedStyle(chip);
          const first = chip.firstElementChild!.getBoundingClientRect();
          const last = chip.lastElementChild!.getBoundingClientRect();
          const rect = chip.getBoundingClientRect();
          return style.paddingInline === "5px" && rect.width - (last.right - first.left) <= 12.5;
        }),
      ),
    ).toBe(true);
    await box.screenshot({
      path: `${evidence}/${light ? "light" : "dark"}-${width}.png`,
      animations: "disabled",
    });

    if (width !== 800 || light) continue;
    await editor.getByRole("button", { name: "Open PreviewTunnel.ts" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-composer-opened-file",
      "/fixture/src/PreviewTunnel.ts",
    );
    await editor.getByRole("link", { name: "https://github.com/example/project" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-composer-opened-url",
      "https://github.com/example/project",
    );
    await editor.getByRole("link", { name: "https://github.com/example/project" }).press("F2");
    await expect(editor).toContainText("https://github.com/example/project");
    await page.keyboard.press("Control+End");
    await expect(references).toHaveCount(8);

    await editor.getByRole("button", { name: "Open image.png" }).click();
    await expect(page.getByRole("dialog").locator("img")).toBeVisible();
    await page.keyboard.press("Escape");

    await editor.getByRole("button", { name: "Open bycoda-usage.csv" }).click();
    await expect(page.getByRole("dialog").getByText("composer", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await editor.getByRole("button", { name: "Design and polish interfaces" }).click();
    await expect(page.getByRole("dialog", { name: "Design and polish interfaces" })).toBeVisible();
    await page.keyboard.press("Escape");
    await editor.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type("Not: ");
    await expect(field(page)).toHaveValue(/^Not: Önce /);
    await page.keyboard.press("Control+z");
    await expect(field(page)).toHaveValue(/^Önce /);
    await expect(references).toHaveCount(8);

    if (browserName === "chromium") {
      const client = await page.context().newCDPSession(page);
      await page.keyboard.press("Control+End");
      await client.send("Input.imeSetComposition", {
        text: "入力",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await client.send("Input.insertText", { text: "入力" });
      await expect(field(page)).toHaveValue(/入力$/);
      await expect(references).toHaveCount(8);
      await client.detach();
    }
    await editor
      .getByRole("button", { name: "Open bycoda-export.json" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove bycoda-export.json" }).click();
    await expect(references).toHaveCount(7);
    await expect(field(page)).not.toHaveValue(/bycoda-export\.json/);
  }
});
test("repeated PDF references use their intrinsic width with small padding", async ({ page }) => {
  const evidence = "temp/verification/composer-repeat-pdf";
  mkdirSync(evidence, { recursive: true });
  for (const width of [800, 1280]) {
    for (const light of [false, true]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({ inlineExamples: "repeated-pdf" }, light));
      const box = page.locator("[data-composer]");
      const editor = box.locator("[data-composer-inline-input]");
      const pdfs = editor.getByRole("button", { name: "Open Detailed-project-report-tr (1).pdf" });
      await expect(pdfs).toHaveCount(2);
      await expect(editor.locator('[data-inline-reference="skill"]')).toHaveText("ui-ux-pro-max");
      await expect(box.locator("[data-attachment-chip]")).toHaveCount(1);
      for (const pdf of await pdfs.all()) {
        await expect(pdf).toHaveText("Detailed-project-report-tr (1).pdf71 KB");
        await expect(pdf).toHaveCSS("padding-inline", "5px");
        const extraWidth = await pdf.evaluate((chip) => {
          const icon = chip.firstElementChild!.getBoundingClientRect();
          const size = chip.lastElementChild!.getBoundingClientRect();
          return chip.getBoundingClientRect().width - (size.right - icon.left);
        });
        expect(extraWidth).toBeCloseTo(12, 0);
      }
      await box.screenshot({ path: `${evidence}/${light ? "light" : "dark"}-${width}.png` });
    }
  }
});
test("shows the complete attached filename in the card and inline while writing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto(url({ attach: "" }));
  const input = field(page);
  await input.fill("I wrote this first. Review ");
  const box = page.locator("[data-composer]");
  const name = box
    .locator('[data-attachment-chip="file"]')
    .getByText("draft-context.txt", { exact: true });
  await expect(name).toBeVisible();
  expect(await name.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await name.click({ button: "right" });
  const insert = page.getByRole("menuitem", { name: /^Insert .* into the message$/ });
  await insert.click();
  const editor = box.locator("[data-composer-inline-input]");
  const label = editor.locator('[data-inline-reference="attachment"] > span');
  await expect(label).toBeVisible();
  await expect(label).toHaveText("draft-context.txt");
  await expect(box.locator("[data-attachment-chip]")).toHaveCount(1);
  expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(editor).toBeFocused();
  await editor.pressSequentially(" and reply.");
  await expect(input).toHaveValue(/and reply\.$/);
  await name.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(insert).toHaveCount(0);
  await page.keyboard.press("Escape");
});
test("wraps a long attached filename on narrow layouts without losing characters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const filename = `${"very-long-export-".repeat(10)}report.txt`;
  await page.goto(url({ attach: filename, draft: "legacyFile" }));
  const box = page.locator("[data-composer]");
  const label = box.locator('[data-inline-reference="attachment"] > span');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(filename);
  expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await box.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(
    box.getByRole("button", { name: `Open ${filename}`, exact: true }).first(),
  ).toBeVisible();
});
test("skill panels match the composer and keep their actions visible", async ({ page }) => {
  for (const light of [false, true]) {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({ inlineExamples: "skill-panels" }, light));
      const box = page.locator("[data-composer-box]");
      const editor = box.locator("[data-composer-inline-input]");
      const composerMaterial = await box.evaluate((element) => {
        const style = getComputedStyle(element);
        return { fill: style.backgroundColor, filter: style.backdropFilter };
      });
      const checkMaterial = async (panel: Locator) => {
        const surface = panel.locator(':scope > [aria-hidden="true"]');
        await expect(surface).toHaveCSS("background-color", composerMaterial.fill);
        await expect(surface).toHaveCSS("backdrop-filter", composerMaterial.filter);
      };
      await editor.getByRole("button", { name: "ui-ux-pro-max", exact: true }).click();
      const details = page.getByRole("dialog", { name: "ui-ux-pro-max" });
      const openFile = details.getByRole("button", { name: "Open SKILL.md" });
      await expect(openFile).toBeVisible();
      await capture(page, `skill-details-${light ? "light" : "dark"}-${width}`);
      await expect(openFile).toHaveAttribute("data-button-variant", "secondary");
      await checkMaterial(details.locator(".."));
      await openFile.click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-composer-opened-file",
        "/fixture/.claude/skills/ui-ux-pro-max/SKILL.md",
      );
      await editor.focus();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" /");
      const list = page.getByRole("listbox", { name: "Commands and skills" });
      const create = page.getByRole("button", { name: "New skill", exact: true });
      await expect(list).toBeVisible();
      await expect(create).toBeVisible();
      await capture(page, `skill-picker-${light ? "light" : "dark"}-${width}`);
      await expect(create).toHaveAttribute("data-button-variant", "secondary");
      const panel = list.locator("xpath=ancestor::*[@data-popover-side][last()]");
      await checkMaterial(panel);
      await expect
        .poll(async () => {
          const panelBounds = await panel.boundingBox();
          const boxBounds = await box.boundingBox();
          if (!panelBounds || !boxBounds) return Infinity;
          return Math.max(
            Math.abs(panelBounds.width - boxBounds.width),
            Math.abs(panelBounds.x - boxBounds.x),
          );
        })
        .toBeLessThanOrEqual(1);
      await list.getByRole("option").last().scrollIntoViewIfNeeded();
      await expect(create).toBeInViewport({ ratio: 1 });
    }
  }
});

test("opens references from the real session composer in both themes and widths", async ({
  page,
}) => {
  const evidence = "temp/verification/composer-compact-references";
  mkdirSync(evidence, { recursive: true });
  for (const light of [true, false]) {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({ attach: "", draft: "legacyFile" }, light));
      const input = field(page);
      const draft =
        "I wrote this first. Review [File\u00a01\u00a0·\u00a0draft-context.txt\u00a0·\u00a07\u00a0B] and https://example.com/design";
      await expect(input).toHaveValue(draft);
      const references = page.locator("[data-composer-inline-input]");
      const file = references.getByRole("button", { name: "Open draft-context.txt" });
      await expect(file).toHaveCSS("cursor", "pointer");
      await expect(
        references.getByRole("link", { name: "https://example.com/design" }),
      ).toBeVisible();
      await file.click();
      await expect(page.getByRole("dialog").getByText("context", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(file).toBeFocused();
      await expect(input).toHaveValue(draft);
      await page.mouse.move(0, 0);
      await page.locator("[data-composer]").screenshot({
        path: `${evidence}/session-${light ? "light" : "dark"}-${width}.png`,
        animations: "disabled",
      });
    }
  }
});
const expectedMessageFill = (node: Locator, opacity: number, opaque = false) =>
  node.evaluate(
    (element, { opacity, opaque }) => {
      const sample = document.createElement("span");
      sample.style.background = opaque
        ? "var(--ui-chat-message-color)"
        : `color-mix(in oklab, var(--ui-chat-message-color) ${opacity}%, transparent)`;
      element.append(sample);
      const fill = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return fill;
    },
    { opacity, opaque },
  );

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`chat message surfaces and Working ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({ goal: "" }, light));
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.add(
          "has-chat-background",
          "chat-background-effect-ready",
          "has-user-accent",
        );
        root.style.setProperty(
          "--chat-background-image",
          "radial-gradient(currentColor 1px, transparent 1px), linear-gradient(120deg, #234368, #284c46)",
        );
        root.style.setProperty("--chat-background-session-opacity", "0.65");
      });
      const box = page.locator("[data-composer-box]");
      const dock = page.locator('[data-activity-dock="working"]');
      const message = page.locator('[data-prompt-anchor="user-39"] .user-message-bubble');
      const reply = page.locator('[data-selectable-agent-response="reply-39"]');
      await expect(dock).toBeVisible();
      await expect(box).toBeVisible();
      await expect(message).toBeInViewport();
      await expect(reply).toBeInViewport();
      await capture(page, `user-message-working-${light ? "light" : "dark"}-${width}`);

      for (const mode of ["glass", "no-blur", "streaming", "forced-colors"] as const) {
        await page.emulateMedia({ forcedColors: mode === "forced-colors" ? "active" : "none" });
        await page.evaluate((state) => {
          document.documentElement.toggleAttribute("data-performance-no-blur", state === "no-blur");
          const pane = document.querySelector(".chat-pane-background")!;
          if (state === "streaming") pane.setAttribute("data-session-streaming", "true");
          else pane.removeAttribute("data-session-streaming");
        }, mode);
        const working = await dock.evaluate((element) => {
          const style = getComputedStyle(element);
          return { fill: style.backgroundColor, filter: style.backdropFilter };
        });
        await expect(box).toHaveCSS("background-color", working.fill);
        await expect(box).toHaveCSS("backdrop-filter", working.filter);
        for (const [node, opacity] of [
          [message, 42],
          [page.locator("[data-transcript-reply]").last(), 90],
        ] as const) {
          // The reading surface blurs only by the Transcript surface blur setting (0 by default), not by the dock glass.
          await expect(node).toHaveCSS("backdrop-filter", "none");
          await expect(node).toHaveCSS(
            "background-color",
            await expectedMessageFill(node, opacity, mode === "forced-colors"),
          );
        }
      }
    });

for (const light of [true, false])
  test(`a flat transcript glass drops only the per-message blur ${light ? "light" : "dark"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url({ goal: "" }, light));
    // Turn the Transcript surface blur on so each message opens its own backdrop layer.
    await page.evaluate(() => {
      const root = document.documentElement;
      root.classList.add("has-chat-background");
      root.toggleAttribute("data-transcript-blur", true);
      root.style.setProperty("--appearance-transcript-surface-blur", "12px");
    });
    const pane = page.locator(".chat-pane-background");
    const box = page.locator("[data-composer-box]");
    const message = page.locator('[data-prompt-anchor="user-39"] .user-message-bubble');
    const reply = page.locator("[data-transcript-reply]").last();
    const glass = await box.evaluate((element) => getComputedStyle(element).backdropFilter);
    expect(glass).not.toBe("none");
    const fills = async () =>
      Promise.all(
        [message, reply, box].map((node) =>
          node.evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.backgroundColor, style.borderColor, style.boxShadow, style.borderRadius];
          }),
        ),
      );
    const before = await fills();
    // Without the marker every message carries the blur; with it, only the repeated blur is gone.
    if ((await pane.getAttribute("data-transcript-glass")) !== "flat") {
      await expect(message).toHaveCSS("backdrop-filter", "blur(12px)");
      await expect(reply).toHaveCSS("backdrop-filter", "blur(12px)");
      await pane.evaluate((element) => element.setAttribute("data-transcript-glass", "flat"));
    }
    await expect(message).toHaveCSS("backdrop-filter", "none");
    await expect(reply).toHaveCSS("backdrop-filter", "none");
    await expect(box).toHaveCSS("backdrop-filter", glass);
    expect(await fills()).toEqual(before);
    await pane.evaluate((element) => element.removeAttribute("data-transcript-glass"));
  });

test("saved chat message appearance reaches the real transcript", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "bycoda.appearancePreferences.v1",
      JSON.stringify({
        userMessageOpacity: 100,
        transcriptSurface: "off",
        messageColor: "neutral",
      }),
    );
  });
  await page.goto(url());
  const root = page.locator("html");
  const message = page.locator('[data-prompt-anchor="user-39"] .user-message-bubble');
  const reply = page.locator(
    '[data-transcript-reply]:has([data-selectable-agent-response="reply-39"])',
  );
  await expect(root).toHaveAttribute("data-chat-message-color", "neutral");
  await expect(root).toHaveAttribute("data-transcript-surface", "off");
  await expect(reply).toHaveCSS("backdrop-filter", "none");
  await expect(message).toHaveCSS("background-color", await expectedMessageFill(message, 100));
  await expect(reply).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`composer workspace stays transparent ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({}, light));
      const workspace = page.locator("[data-composer-workspace]");
      await expect(workspace).toBeVisible();
      await expect(workspace).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(workspace).toHaveCSS("background-image", "none");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/composer-workspace-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`composer and question translucency ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url({ "docked-question": "" }, light));
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.add("has-chat-background", "chat-background-effect-ready");
        root.style.setProperty(
          "--chat-background-image",
          "linear-gradient(120deg, oklch(55% 0.18 255), oklch(70% 0.17 170))",
        );
        root.style.setProperty("--chat-background-session-opacity", "0.65");
      });
      const box = page.locator("[data-composer-box]");
      const question = page.locator("[data-question-form] > form");
      await expect(question).toBeVisible();
      await field(page).fill("Retained composer draft");
      for (const mode of ["glass", "no-blur", "streaming", "forced-colors"] as const) {
        await page.emulateMedia({ forcedColors: mode === "forced-colors" ? "active" : "none" });
        await page.evaluate((state) => {
          document.documentElement.toggleAttribute("data-performance-no-blur", state === "no-blur");
          const session = document.querySelector(".chat-pane-background");
          session?.removeAttribute("data-session-streaming");
          if (state === "streaming") session?.setAttribute("data-session-streaming", "true");
        }, mode);
        for (const node of [box, question]) {
          const actual = await node.evaluate((element) => {
            const s = getComputedStyle(element);
            const sample = document.createElement("canvas").getContext("2d")!;
            sample.fillStyle = s.backgroundColor;
            sample.fillRect(0, 0, 1, 1);
            return { alpha: sample.getImageData(0, 0, 1, 1).data[3]!, filter: s.backdropFilter };
          });
          expect(actual.alpha).toBeGreaterThan(0);
          if (mode === "glass") {
            expect(actual.alpha).toBeLessThan(255);
            expect(actual.filter).toContain("blur(");
          } else {
            expect(actual.alpha).toBe(255);
            expect(actual.filter).toBe("none");
          }
        }
        await expect(field(page)).toHaveValue("Retained composer draft");
        await page.screenshot({
          animations: "disabled",
          path: `temp/verification/composer-translucency/${test.info().project.name}/composer-question-${mode}-${light ? "light" : "dark"}-${width}.png`,
        });
      }
    });

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`context section dividers ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({ "context-sections": "" }, light));
      await page.getByRole("button").first().click();
      const dialog = page.getByRole("dialog", { name: "Context usage" });
      await expect(dialog.getByText("18%", { exact: true })).toBeVisible();
      await expect(dialog.getByText("184K / 1M tokens")).toBeVisible();
      await expect(dialog.getByText("70.0 TPS")).toBeVisible();
      const rows = dialog.locator(".context-meter-metrics > div");
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) {
        const { term, value } = await row.evaluate((node) => ({
          term: node.querySelector("dt")!.getBoundingClientRect().toJSON(),
          value: node.querySelector("dd")!.getBoundingClientRect().toJSON(),
        }));
        expect(value.top).toBeCloseTo(term.top, 0);
        expect(value.left).toBeGreaterThan(term.right);
      }
      for (const section of ["agents", "stats", "actions"]) {
        const node = dialog.locator(`.context-meter-${section}`);
        await expect(node).toBeVisible();
        const actual = await node.evaluate((element) => {
          const s = getComputedStyle(element);
          const probe = document.createElement("span");
          probe.style.borderTop = "1px solid var(--ui-pane-border)";
          element.appendChild(probe);
          const expected = getComputedStyle(probe).borderTopColor;
          probe.remove();
          return { width: s.borderTopWidth, color: s.borderTopColor, expected };
        });
        expect(actual.width).toBe("1px");
        expect(actual.color).toBe(actual.expected);
      }
      await dialog.screenshot({
        animations: "disabled",
        path: `temp/verification/context-meter/${test.info().project.name}-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const light of [true, false])
  for (const width of [480, 800, 1280])
    test(`session notes responsive divider ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({ notes: "" }, light));
      const panel = page.locator("[data-notes-panel]");
      await expect(panel).toBeVisible();
      const values = await panel.evaluate((node) => {
        const style = getComputedStyle(node);
        const probe = document.createElement("span");
        node.appendChild(probe);
        probe.style.borderTop = "1px solid var(--ui-pane-border)";
        const stroke = getComputedStyle(probe).borderTopColor;
        probe.style.borderTop = "1px solid var(--ui-pane-border)";
        const pane = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return {
          topWidth: style.borderTopWidth,
          leftWidth: style.borderLeftWidth,
          topColor: style.borderTopColor,
          leftColor: style.borderLeftColor,
          stroke,
          pane,
        };
      });
      console.log("NOTES_DIVIDER", light, width, JSON.stringify(values));
      if (width < 600) {
        expect(values.topWidth).toBe("1px");
        expect(values.leftWidth).toBe("0px");
        expect(values.topColor).toBe(values.pane);
      } else {
        expect(values.topWidth).toBe("0px");
        expect(values.leftWidth).toBe("1px");
        expect(values.leftColor).toBe(values.pane);
      }
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/notes-divider-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`split session header divider ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url({ split: "" }, light));
      const header = page.locator("[data-session-header]");
      await expect(header).toBeVisible();
      await expect(page.getByText("Cannot read properties of null (reading 'files')")).toHaveCount(
        0,
      );
      const result = await header.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.borderBottom = "1px solid var(--ui-pane-border)";
        node.appendChild(probe);
        const expected = getComputedStyle(probe).borderBottomColor;
        probe.remove();
        const style = getComputedStyle(node);
        return { width: style.borderBottomWidth, color: style.borderBottomColor, expected };
      });
      expect(result.width).toBe("1px");
      expect(result.color).toBe(result.expected);
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/session-header-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const turns of [0, 2]) {
  test(`saved draft opens in composer with ${turns} history turns`, async ({ page }) => {
    await page.goto(url({ savedDraft: "", turns: String(turns) }));
    await expect(field(page)).toHaveValue("Saved draft for editing");
    await expect(field(page)).toBeEditable();
    if (turns)
      await expect(page.getByText("Question 1: what should happen with item 1?")).toBeVisible();
    expect((await fixtureEvents(page)).sends).toBe(0);
  });
}
const state = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".agent-transcript")!;
    const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
    const input = document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")!;
    return {
      top: el.scrollTop,
      distance: el.scrollHeight - el.scrollTop - el.clientHeight,
      viewport: el.clientHeight,
      dock: dock.getBoundingClientRect().height,
      field: input.getBoundingClientRect().height,
      fieldScrolls: input.scrollHeight > input.clientHeight + 1,
      reading: !!document.querySelector("[data-composer][data-composer-reading]"),
    };
  });
// Upper bound for waits on work that the browser paces. The transcript paints a few turns and
// grows to its 20-turn window in a low-priority transition (about 1 s on a free machine), and
// WebKit animates a long wheel delta frame by frame: on a starved CI runner (a Linux WebKit under
// load sat idle for 4-7 s before reaching the end) either takes longer than the 5 s default. It only
// bounds the wait; every expected value stays as it was.
const SETTLE_WAIT = 20_000;
async function wheel(page: Page, deltaY: number) {
  const box = (await scroller(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(120);
}
async function readHistory(page: Page, deltaY = -1800) {
  const start = await state(page);
  await wheel(page, deltaY);
  await expect(reading(page)).toHaveCount(1, { timeout: SETTLE_WAIT });
  // WebKit may only have applied the first wheel increment when reading mode
  // appears. Prepending older turns can change absolute offsets on Chromium.
  const travel = Math.min(start.top, -deltaY);
  let lastTop: number | undefined;
  await expect
    .poll(
      async () => {
        const current = await state(page);
        const moved = current.distance - start.distance + current.viewport - start.viewport;
        const settled = current.top === lastTop && moved >= travel - 80;
        lastTop = current.top;
        return settled;
      },
      { timeout: SETTLE_WAIT },
    )
    .toBe(true);
  // Let the dock motion settle before measuring.
  await page.waitForTimeout(350);
}
async function open(page: Page, query: Record<string, string> = {}, light = false) {
  await page.goto(url(query, light));
  await expect(field(page)).toBeVisible({ timeout: SETTLE_WAIT });
  // The fixture has 40 turns. Wait for the full initial 20-turn window. The
  // first, shorter paint can also hold the same scroll height for two samples.
  await expect(scroller(page).locator('[data-transcript-turn="user-20"]')).toBeAttached({
    timeout: SETTLE_WAIT,
  });
  await expect
    .poll(async () => (await state(page)).distance, { timeout: SETTLE_WAIT })
    .toBeLessThan(2);
}

for (const light of [false, true]) {
  const theme = light ? "light" : "dark";
  test.describe(theme, () => {
    test("normal at the end, compact while reading history, normal on focus and at the end", async ({
      page,
    }) => {
      // The settle waits above can each take seconds on a starved runner (see SETTLE_WAIT).
      test.slow();
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, {}, light);
      const normal = await state(page);
      expect(normal.reading).toBe(false);
      await capture(page, `${theme}-1280-1-bottom-normal`);

      await readHistory(page);
      const compact = await state(page);
      expect(compact.field).toBeLessThan(normal.field);
      expect(compact.dock).toBeLessThan(normal.dock - 30);
      expect(compact.viewport).toBeGreaterThan(normal.viewport + 30);
      await capture(page, `${theme}-1280-2-reading-compact-empty`);

      // Focus restores the normal layout without moving the reading position.
      const before = (await state(page)).top;
      await field(page).click();
      await expect(reading(page)).toHaveCount(0, { timeout: SETTLE_WAIT });
      await page.waitForTimeout(350);
      const focused = await state(page);
      expect(Math.abs(focused.top - before)).toBeLessThanOrEqual(1);
      expect(focused.dock).toBeGreaterThan(compact.dock + 30);
      await capture(page, `${theme}-1280-3-focused-normal`);

      // Leaving focus while still reading history compacts again.
      await page.locator(".agent-transcript").click({ position: { x: 40, y: 40 } });
      await expect(reading(page)).toHaveCount(1, { timeout: SETTLE_WAIT });
      await page.waitForTimeout(350);
      expect(Math.abs((await state(page)).top - before)).toBeLessThanOrEqual(1);

      // Returning to the end restores the normal layout and following. The wheel's animated
      // scroll reaches the end first; the layout and the pinned end follow it.
      await wheel(page, 20000);
      await expect(reading(page)).toHaveCount(0, { timeout: SETTLE_WAIT });
      await expect
        .poll(async () => (await state(page)).distance, { timeout: SETTLE_WAIT })
        .toBeLessThan(2);
      await page.waitForTimeout(350);
      const end = await state(page);
      expect(end.distance).toBeLessThan(2);
      expect(Math.abs(end.dock - normal.dock)).toBeLessThanOrEqual(1);
    });

    test("one mounted textarea keeps its draft, caret and size to its content", async ({
      page,
    }) => {
      // Four full page loads, each about 2.3 s on a free machine (see SETTLE_WAIT, plus the
      // reading-mode dock motion). The 30 s default left no margin on a CI runner that is 2-3x
      // slower, which timed out inside open(). The expectations are unchanged.
      test.slow();
      await page.setViewportSize({ width: 1280, height: 800 });
      const heights: Record<string, number> = {};
      let long: Awaited<ReturnType<typeof state>> | undefined;
      for (const draft of ["none", "short", "multi", "long"]) {
        await open(page, { draft }, light);
        await page.evaluate(() => {
          const input = document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")!;
          (window as unknown as { mounted: HTMLTextAreaElement }).mounted = input;
          input.setSelectionRange(2, Math.min(7, input.value.length));
        });
        const full = await state(page);
        await readHistory(page);
        const compact = await state(page);
        heights[draft] = compact.field;
        if (draft === "long") long = compact;
        expect(compact.field).toBeLessThanOrEqual(full.field);
        await capture(page, `${theme}-1280-4-reading-draft-${draft}`);
        await field(page).focus();
        await expect(reading(page)).toHaveCount(0);
        const kept = await page.evaluate(() => {
          const input = document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")!;
          const mounted = (window as unknown as { mounted: HTMLTextAreaElement }).mounted;
          return {
            same: input === mounted,
            start: input.selectionStart,
            end: input.selectionEnd,
            length: input.value.length,
            textareas: document.querySelectorAll("textarea").length,
          };
        });
        expect(kept.same).toBe(true);
        expect(kept.textareas).toBe(1);
        expect(kept.start).toBe(Math.min(2, kept.length));
        expect(kept.end).toBe(Math.min(7, kept.length));
      }
      // Empty and short drafts share one readable row; more text gets more room.
      expect(heights.none).toBe(heights.short);
      expect(heights.multi).toBeGreaterThan(heights.short + 20);
      expect(heights.long).toBeGreaterThanOrEqual(heights.multi);
      // A very long draft is capped and scrolls inside the field. Its compact state was read in
      // the loop above after the same fresh load and history read.
      expect(long!.field).toBeLessThanOrEqual(132 + 2);
      expect(long!.fieldScrolls).toBe(true);
    });

    test("does not toggle back and forth after compacting", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, { draft: "short" }, light);
      await page.evaluate(() => {
        const toggles: boolean[] = [];
        (window as unknown as { toggles: boolean[] }).toggles = toggles;
        new MutationObserver(() => {
          toggles.push(!!document.querySelector("[data-composer][data-composer-reading]"));
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["data-composer-reading"],
        });
      });
      // A gentle upward scroll that ends just past the entry distance.
      await wheel(page, -230);
      await page.waitForTimeout(800);
      const toggles = await page.evaluate(
        () => (window as unknown as { toggles: boolean[] }).toggles,
      );
      expect(toggles.length).toBeLessThanOrEqual(1);
    });
  });
}

test("the first click on a compact control opens its menu and the layout stays normal while open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await readHistory(page);
  const compact = await state(page);

  // First click on a compact control opens it; nothing is sent or switched.
  await page.locator("[data-composer-model-controls] button").first().click();
  await expect(reading(page)).toHaveCount(0);
  // Shared tooltips also use popover frames; the pointer may rest on a hinted control.
  const menu = page
    .locator("[data-popover-side]:not([role='tooltip']):not(:has([role='tooltip']))")
    .first();
  await expect(menu).toBeVisible();
  await page.waitForTimeout(350);
  // The menu stays attached to its trigger after the layout swap.
  const trigger = await page.locator("[data-composer-model-controls] button").first().boundingBox();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(trigger!.y + 2);
  expect(trigger!.y - (menuBox.y + menuBox.height)).toBeLessThan(40);
  await capture(page, "dark-1280-5-model-menu-from-reading");
  expect((await fixtureEvents(page)).sends).toBe(0);

  // Focus inside the menu is still the composer: no compacting while it is open.
  await page.waitForTimeout(250);
  await expect(reading(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(reading(page)).toHaveCount(0);
  expect((await state(page)).dock).toBeGreaterThan(compact.dock + 30);
  expect((await fixtureEvents(page)).sends).toBe(0);
});

test("keyboard Tab through the composer and its add menu never compacts it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await readHistory(page);
  await field(page).focus();
  await expect(reading(page)).toHaveCount(0);
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    await expect(reading(page)).toHaveCount(0);
  }
  const add = page.getByRole("button", { name: "Add files or skills", exact: true });
  await add.focus();
  await add.press("ArrowDown");
  await expect(page.getByRole("menu", { name: "Add files or skills", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await expect(reading(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await expect(reading(page)).toHaveCount(0);
  // Focus leaving the composer while still reading history compacts it again.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(reading(page)).toHaveCount(1);
});

test("a click on the compact box focuses the input without sending", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await readHistory(page);
  const box = (await page.locator("[data-composer-box]").boundingBox())!;
  // The box edge above the text, outside any control.
  await page.mouse.click(box.x + box.width / 2, box.y + 2);
  await expect(field(page)).toBeFocused();
  await expect(reading(page)).toHaveCount(0);
  expect((await fixtureEvents(page)).sends).toBe(0);
});

for (const light of [false, true])
  test(`streaming does not move a reader of history; at the end it keeps following (${light ? "light" : "dark"})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, {}, light);
    // Following the end while a reply streams.
    await stream(page, 30);
    await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
    await stream(page, 30);
    await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
    // Reading history while it continues.
    await readHistory(page);
    const reader = (await state(page)).top;
    for (let index = 0; index < 5; index++) {
      await stream(page, 20);
      await page.waitForTimeout(80);
    }
    expect(Math.abs((await state(page)).top - reader)).toBeLessThanOrEqual(1);
    await expect(reading(page)).toHaveCount(1);
    // The stop control stays reachable while the turn runs.
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await finish(page);
    // Back at the end: the normal layout returns and following resumes.
    await wheel(page, 20000);
    await expect(reading(page)).toHaveCount(0);
    // A dispatched wheel and normal composer alone do not prove its off-thread
    // scroll reached the end. Verify that precondition with the same strict bound.
    await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
    await stream(page, 40);
    await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
    await testInfo.attach("following-geometry", {
      body: JSON.stringify(await state(page)),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("streaming-following-end.png") });
  });

test("reduced motion swaps the layout without an animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
    (window as unknown as { animations: number }).animations = 0;
    const animate = dock.animate.bind(dock);
    dock.animate = (...args: Parameters<typeof animate>) => {
      (window as unknown as { animations: number }).animations++;
      return animate(...args);
    };
  });
  await wheel(page, -1800);
  await expect(reading(page)).toHaveCount(1);
  await field(page).focus();
  await expect(reading(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { animations: number }).animations)).toBe(
    0,
  );
});

for (const size of [
  { width: 800, height: 800, label: "800" },
  { width: 1280, height: 560, label: "1280x560" },
]) {
  for (const light of [false, true]) {
    test(`narrow and short windows keep the composer usable (${size.label}, ${light ? "light" : "dark"})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page, { draft: "wrap", attach: "" }, light);
      const theme = light ? "light" : "dark";
      await capture(page, `${theme}-${size.label}-1-bottom-normal`);
      await readHistory(page);
      const compact = await state(page);
      expect(compact.dock).toBeLessThan(size.height / 2);
      expect(compact.field).toBeLessThanOrEqual(132 + 2);
      await capture(page, `${theme}-${size.label}-2-reading-compact-wrapped-draft`);
      await field(page).focus();
      await expect(reading(page)).toHaveCount(0);
      await capture(page, `${theme}-${size.label}-3-focused-normal`);
      // Send and the model control stay reachable while reading.
      await page.locator(".agent-transcript").click({ position: { x: 30, y: 30 } });
      await expect(reading(page)).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
      await expect(page.locator("[data-composer-model-controls] button").first()).toBeVisible();
    });
  }
}

test("a real Chromium IME composition keeps the full layout and commits into the same draft", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Input.imeSetComposition is a Chromium DevTools protocol command",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await readHistory(page);
  await field(page).click();
  await expect(reading(page)).toHaveCount(0);
  await page.waitForTimeout(350);
  const before = await state(page);
  await page.evaluate(() => {
    (window as unknown as { imeNode: Element }).imeNode = document.querySelector(
      "[data-composer] textarea",
    )!;
  });
  // Chromium's input-method path (compositionstart/update), not synthetic events.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
  await expect(field(page)).toHaveValue(/かな/);
  await page.waitForTimeout(200);
  expect((await state(page)).reading).toBe(false);
  await cdp.send("Input.insertText", { text: "仮名" });
  await expect(field(page)).toHaveValue(/仮名/);
  const after = await state(page);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { imeNode: Element }).imeNode ===
        document.querySelector("[data-composer] textarea"),
    ),
  ).toBe(true);
  // Leaving the composer while still reading compacts it again with the committed text.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(reading(page)).toHaveCount(1);
  await expect(field(page)).toHaveValue(/仮名/);
});

test("a file dragged over the compact composer gets the full drop target until it leaves", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await readHistory(page);
  const drag = (type: string) =>
    page.evaluate((name) => {
      const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
      const data = new DataTransfer();
      data.items.add(new File(["x"], "note.txt", { type: "text/plain" }));
      dock.dispatchEvent(
        new DragEvent(name, { bubbles: true, cancelable: true, dataTransfer: data }),
      );
    }, type);
  await drag("dragenter");
  await expect(reading(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(reading(page)).toHaveCount(0);
  await drag("dragleave");
  await expect(reading(page)).toHaveCount(1);
});

// Reading mode under every supported control density (compact | comfortable | touch).
// Density changes shared control heights; the dock must still shrink while reading,
// stay one row when empty, return to the normal layout on focus and keep its controls.
const overflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
    const bounds = dock.getBoundingClientRect();
    const clipped = [...dock.querySelectorAll<HTMLElement>("button, textarea")].filter((el) => {
      const box = el.getBoundingClientRect();
      return (
        box.width > 0 &&
        (box.right > bounds.right + 1 || box.left < bounds.left - 1 || box.right > innerWidth + 1)
      );
    });
    return {
      page: root.scrollWidth - root.clientWidth,
      dock: dock.scrollWidth - dock.clientWidth,
      clipped: clipped.map((el) => el.getAttribute("aria-label") ?? el.tagName),
    };
  });
for (const density of ["compact", "comfortable", "touch"]) {
  for (const light of [false, true]) {
    const theme = light ? "light" : "dark";
    for (const draft of ["none", "short"]) {
      test(`density ${density}: bottom normal, reading compact, focus normal (${theme}, ${draft} draft)`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await open(page, { density, draft }, light);
        expect(await page.evaluate(() => document.documentElement.dataset.controlDensity)).toBe(
          density,
        );
        const normal = await state(page);
        expect(normal.reading).toBe(false);
        expect(await overflow(page)).toEqual({ page: 0, dock: 0, clipped: [] });
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
        await expect(page.locator("[data-composer-model-controls] button").first()).toBeVisible();
        await capture(page, `density-${density}-${theme}-${draft}-1-bottom-normal`);

        await readHistory(page);
        const compact = await state(page);
        expect(compact.dock).toBeLessThan(normal.dock - (draft === "none" ? 30 : 20));
        expect(compact.viewport).toBeGreaterThan(normal.viewport + 20);
        expect(compact.field).toBeLessThan(normal.field);
        if (draft === "none") {
          // One row when empty: no taller than a single line plus the field padding.
          expect(await field(page).getAttribute("rows")).toBe("1");
          expect(compact.field).toBeLessThanOrEqual(48);
          expect(compact.fieldScrolls).toBe(false);
        }
        expect(await overflow(page)).toEqual({ page: 0, dock: 0, clipped: [] });
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
        await expect(page.locator("[data-composer-model-controls] button").first()).toBeVisible();
        await capture(page, `density-${density}-${theme}-${draft}-2-reading-compact`);

        const before = (await state(page)).top;
        await field(page).click();
        await expect(reading(page)).toHaveCount(0);
        await page.waitForTimeout(350);
        const focused = await state(page);
        expect(Math.abs(focused.top - before)).toBeLessThanOrEqual(1);
        expect(Math.abs(focused.dock - normal.dock)).toBeLessThanOrEqual(2);
        expect(await overflow(page)).toEqual({ page: 0, dock: 0, clipped: [] });
        await capture(page, `density-${density}-${theme}-${draft}-3-focused-normal`);
      });
    }
  }
}

test.describe("touch input", () => {
  test.use({ hasTouch: true });
  test("a tap on the compact composer focuses the same draft without sending", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await open(page, { draft: "short" });
    await readHistory(page);
    const before = await field(page).inputValue();
    const box = (await page.locator("[data-composer-box]").boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 2);
    await expect(reading(page)).toHaveCount(0);
    await expect(field(page)).toHaveValue(before);
    expect((await fixtureEvents(page)).sends).toBe(0);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  });
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`shared pane drag affordance ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/chat/composer-compact.html?split&pane-grab${theme === "light" ? "&light" : ""}`,
      );
      const header = page.locator("[data-session-header]").first();
      await expect(header).toHaveCSS("cursor", "grab");
      const box = await header.boundingBox();
      if (!box) throw new Error("Missing pane header");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
      await page.mouse.down();
      await expect(header).toHaveCSS("cursor", "grabbing");
      await expect.poll(() => page.evaluate(() => window.compactFixture.events.paneDrags)).toBe(1);
      await page.mouse.up();
      await page.screenshot({
        path: `temp/verification/session-last-interactions/pane-${theme}-${width}.png`,
      });
    });

// Runtime layout contracts for the composer in a real 320 px pane, in both themes at both window
// sizes. The session pane becomes the 320 px pane; the dock must fit it without clipping.
for (const { theme, width } of PANE_MATRIX)
  test(`composer dock keeps its layout contracts in a 320px pane ${theme} ${width}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url({}, theme === "light"));
    await expect(field(page)).toBeVisible();
    await openPane(page, { theme, width, pane: "main[data-integrated-session]" });
    await expectLayoutContracts(page, {
      surface: "composer dock (320px pane)",
      root: "[data-session-composer]",
      allow: {
        overflow: [
          {
            selector: ".cm-scroller, textarea",
            reason: "The draft field scrolls its own long text vertically inside the editor.",
          },
        ],
      },
    });
  });

// Composer contract: at 800 px the machine, checkout and branch chips show readable labels, and the
// access shield is icon-only for every mode. Chips are the buttons of the workspace controls.
for (const { theme, width } of PANE_MATRIX.filter((entry) => entry.width === 800))
  test(`composer workspace chips show readable labels at 800px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(url({ workspaceChips: "1" }, theme === "light"));
    const controls = page.locator("[data-composer-workspace-controls]");
    await expect(controls).toBeVisible();
    await expect(controls.getByRole("button", { name: /^Run on:/ })).toHaveText("This computer");
    await expect(
      controls.getByRole("button", { name: "Workspace Current checkout" }),
    ).toBeVisible();
    await expect(controls.getByRole("button", { name: "Branch main", exact: true })).toBeVisible();
    const chips = await controls.locator("button, [role='combobox']").evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getBoundingClientRect().width > 0)
        .map((node) => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text = "";
          for (let n = walker.nextNode(); n; n = walker.nextNode()) text += n.textContent ?? "";
          const label = text.replace(/\s+/g, " ").trim();
          const box = node.getBoundingClientRect();
          return {
            name: node.getAttribute("aria-label") ?? label,
            label,
            width: box.width,
            clipped: node.scrollWidth > node.clientWidth + 1,
          };
        }),
    );
    expect(chips.length, "workspace controls render their chips").toBeGreaterThanOrEqual(3);
    for (const chip of chips) {
      expect(
        chip.label.length,
        `chip "${chip.name}" shows a readable label, not an icon alone`,
      ).toBeGreaterThan(0);
      expect(chip.clipped, `chip "${chip.name}" label is not clipped`).toBe(false);
    }
  });

test("the access shield stays icon-only for every mode", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto(url());
  const trigger = page.locator("[data-access-picker-trigger]");
  await expect(trigger).toBeVisible();
  const iconOnly = () =>
    trigger.evaluate((node) => ({
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
      glyphs: node.querySelectorAll("svg").length,
      name: node.getAttribute("aria-label") ?? "",
    }));
  const check = async (mode: string) => {
    const state = await iconOnly();
    expect(state.text, `access shield (${mode}) shows no text`).toBe("");
    expect(state.glyphs, `access shield (${mode}) shows its icon`).toBeGreaterThan(0);
    expect(state.name.length, `access shield (${mode}) keeps an accessible name`).toBeGreaterThan(
      0,
    );
  };
  await check("initial");
  await trigger.click();
  const options = page.locator("[data-access-picker]").getByRole("option");
  const count = await options.count();
  expect(count, "the access menu lists every mode").toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  const selectedNames = new Set<string>();
  for (let index = 0; index < count; index++) {
    await trigger.click();
    const option = page.locator("[data-access-picker]").getByRole("option").nth(index);
    const mode = (await option.textContent())?.trim() ?? String(index);
    if (await option.isDisabled()) {
      await page.keyboard.press("Escape");
      continue;
    }
    await option.click();
    await check(mode);
    selectedNames.add((await trigger.getAttribute("aria-label")) ?? "");
    await trigger.click();
    await expect(options.nth(index)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
  }
  expect(selectedNames.size).toBeGreaterThan(1);
});

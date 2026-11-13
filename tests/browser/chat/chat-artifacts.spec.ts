import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`tool wrap selected indicator ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/chat/transcript.html?artifacts", {
        waitUntil: "domcontentloaded",
      });
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: /^Show output for/ }).click();
      const wrap = page.getByRole("button", { name: "Wrap lines" });
      await expect(wrap).toBeVisible();
      if ((await wrap.getAttribute("aria-pressed")) !== "true") await wrap.click();
      await expect(wrap).toHaveAttribute("aria-pressed", "true");
      await expect(wrap).toHaveAttribute("data-selection-indicator", "dot");
      await page.mouse.move(0, 0);
      for (const state of ["rest", "hover", "focus"] as const) {
        if (state === "hover") await wrap.hover();
        if (state === "focus") {
          await page.keyboard.press("Tab");
          await wrap.focus();
        }
        const actual = await wrap.evaluate((element) => {
          const s = getComputedStyle(element);
          const dot = getComputedStyle(element, "::after");
          const probe = document.createElement("span");
          probe.style.background = "var(--ui-tone-accent-fg)";
          element.appendChild(probe);
          const accent = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            background: s.backgroundColor,
            border: s.borderTopColor,
            dot: dot.backgroundColor,
            dotWidth: dot.width,
            dotHeight: dot.height,
            accent,
          };
        });
        expect(["rgba(0, 0, 0, 0)", "oklab(0 0 0 / 0)"]).toContain(actual.background);
        expect(["rgba(0, 0, 0, 0)", "oklab(0 0 0 / 0)"]).toContain(actual.border);
        expect(actual.dot).toBe(actual.accent);
        expect(actual.dotWidth).toBe("3px");
        expect(actual.dotHeight).toBe("3px");
        await page.screenshot({
          animations: "disabled",
          path: `temp/verification/feature-controls/tool-wrap-${state}-${theme}-${width}.png`,
        });
      }
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`tool output keyboard focus ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/chat/transcript.html?artifacts", {
        waitUntil: "domcontentloaded",
      });
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: /^Show output for/ }).click();
      const output = page.locator("[data-tool-inspection] pre[tabindex='0']").last();
      await expect(output).toContainText("output-marker");
      await page.keyboard.press("Tab");
      await output.focus();
      const outline = await output.evaluate((node) => {
        const s = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.style.outline = "2px solid var(--ui-focus-ring-color)";
        node.appendChild(probe);
        const expected = getComputedStyle(probe).outlineColor;
        probe.remove();
        return { width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor, expected };
      });
      expect(outline).toEqual({
        width: "2px",
        offset: "-2px",
        color: outline.expected,
        expected: outline.expected,
      });
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/tool-output-focus-${theme}-${width}.png`,
      });
    });

test("background commands wrap without losing their start and remain separate", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/chat/transcript.html?chat-layout&background-work");
  const dock = page.getByRole("region", { name: "Turn activity", exact: true });
  // The counts info button also reports aria-expanded; open the list toggle itself.
  await dock.locator("button[data-dock-toggle]").click();
  const rows = dock.locator("[data-dock-agent]");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toHaveAttribute("data-dock-agent", "layout-command-9");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await dock.evaluate((node) => {
        const list = node.querySelector(".activity-dock-list")!;
        const rows = [...node.querySelectorAll<HTMLElement>("[data-dock-agent]")];
        return {
          fits: list.scrollWidth <= list.clientWidth,
          startsVisible: rows.every((row) => {
            const text = row.querySelector(".whitespace-pre-wrap")!;
            const range = document.createRange();
            range.selectNodeContents(text);
            return [...range.getClientRects()].every(
              (rect) =>
                rect.left >= list.getBoundingClientRect().left &&
                rect.right <= list.getBoundingClientRect().right,
            );
          }),
          wraps: rows.every(
            (row) => row.querySelector(".whitespace-pre-wrap")!.getBoundingClientRect().height > 30,
          ),
          separated: rows
            .slice(1)
            .every(
              (row, i) => row.getBoundingClientRect().top >= rows[i].getBoundingClientRect().bottom,
            ),
          // Rows are separated by spacing, not rules: the list has no frame.
          frame: getComputedStyle(rows[1].parentElement!).borderTopWidth,
        };
      });
      expect(geometry).toEqual({
        fits: true,
        startsVisible: true,
        wraps: true,
        separated: true,
        frame: "0px",
      });
      await expect(
        dock.getByRole("button", { name: "Stop all background work", exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.setViewportSize({ width: 768, height: 900 });
    await dock.screenshot({ path: info.outputPath(`background-work-${theme}.png`) });
  }
  await rows.first().focus();
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dock.getByRole("button", { name: /^Stop cd / })).toBeFocused();
});

for (const layout of ["chat", "full"] as const) {
  test(`${layout} layout keeps short user messages compact and right aligned`, async ({
    page,
  }, info) => {
    await page.goto(
      `/tests/browser/chat/transcript.html?message-bubbles${layout === "full" ? "&full-width" : ""}`,
    );
    const short = page.locator('[data-prompt-anchor="short-user"] .user-message-bubble');
    const long = page.locator('[data-prompt-anchor="long-user"] .user-message-bubble');
    const draft = page.locator('[data-prompt-anchor="draft-user"] .user-message-bubble');
    await expect(short).toBeVisible();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["dark", "light"]) {
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        const shortBox = (await short.boundingBox())!;
        const longBox = (await long.boundingBox())!;
        const row = (await page.locator('[data-prompt-anchor="short-user"]').boundingBox())!;
        expect(shortBox.width).toBeLessThan(130);
        await short.hover();
        const actions = page.locator('[data-prompt-anchor="short-user"] .user-message-actions');
        await expect(actions).toHaveCSS("opacity", "1");
        const geometry = await actions.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          const children = [...node.children].map((child) => child.getBoundingClientRect());
          return {
            left: bounds.left,
            right: bounds.right,
            oneLine: children.every(
              (child) => child.top < children[0].bottom && child.bottom > children[0].top,
            ),
          };
        });
        expect(geometry.oneLine).toBe(true);
        expect(geometry.left).toBeGreaterThanOrEqual(row.x);
        expect(geometry.right).toBeLessThanOrEqual(row.x + row.width);
        expect(shortBox.x + shortBox.width).toBeCloseTo(row.x + row.width - 16, 0);
        expect(longBox.x + longBox.width).toBeCloseTo(shortBox.x + shortBox.width, 0);
        expect(longBox.width).toBeGreaterThan(shortBox.width);
        expect(longBox.width).toBeLessThanOrEqual(row.width - 70);
        // One bubble shape for every message length; a draft differs by fill.
        await expect(short).toHaveCSS("border-radius", "12px");
        await expect(long).toHaveCSS("border-radius", "12px");
        const fill = (locator: typeof short) =>
          locator.evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(await fill(draft)).not.toBe(await fill(short));
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      }
    }
    await page.screenshot({ path: info.outputPath(`${layout}-message-bubbles.png`) });
  });
}

test("a saved draft offers edit, remove and send on one row", async ({ page }, info) => {
  await page.goto("/tests/browser/chat/transcript.html?message-bubbles");
  const draft = page.locator('[data-prompt-anchor="draft-user"] .user-message-bubble');
  const actions = [
    draft.getByRole("button", { name: "Edit draft", exact: true }),
    draft.getByRole("button", { name: "Remove draft", exact: true }),
    draft.getByRole("button", { name: "Send draft", exact: true }),
  ];
  for (const width of [800, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const bubble = (await draft.boundingBox())!;
      const boxes = await Promise.all(actions.map(async (action) => (await action.boundingBox())!));
      for (const box of boxes) {
        expect(box.y).toBeCloseTo(boxes[0].y, 0);
        expect(box.x).toBeGreaterThanOrEqual(bubble.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bubble.x + bubble.width);
      }
      expect(boxes[0].x).toBeLessThan(boxes[1].x);
      expect(boxes[1].x).toBeLessThan(boxes[2].x);
      await draft.screenshot({ path: info.outputPath(`draft-actions-${width}-${theme}.png`) });
    }
  }
  await actions[0].focus();
  await page.keyboard.press("Tab");
  await expect(actions[1]).toBeFocused();
});

test("chat messages, attachment references and running work keep a readable hierarchy", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/chat/transcript.html?chat-layout");
  const bubble = page.locator(".user-message-bubble");
  const group = page.locator(".transcript-activity-group").last();
  const dock = page.getByRole("region", { name: "Turn activity", exact: true });
  await expect(bubble).toBeVisible();
  await expect(bubble.locator('[data-attachment-chip="image"]')).toHaveCount(7);
  await expect(page.locator(".agent-transcript")).not.toContainText(/working for/i);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await bubble.scrollIntoViewIfNeeded();
      expect(await bubble.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const image = bubble.locator('[data-attachment-chip="image"] button').first();
      expect((await image.boundingBox())!.width).toBeGreaterThanOrEqual(56);
      const rail = bubble.getByRole("group", { name: "Attachments", exact: true });
      const thumbnailTops = await rail
        .locator('[data-attachment-chip="image"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
      expect(new Set(thumbnailTops).size).toBe(1);
      const card = rail.locator('[data-attachment-chip="image"]').first();
      // Compact image cards contain only a thumbnail. File identity remains on
      // the preview action and tooltip; size sits beside the copied text token.
      await expect(image).toHaveAccessibleName("Open screenshot-1.png full screen");
      await image.hover();
      await expect(page.getByRole("tooltip")).toContainText("image1 · screenshot-1.png · 42 B");
      await page.mouse.move(0, 0);
      const cardBox = (await card.boundingBox())!;
      expect(cardBox.width).toBe(88);
      expect(cardBox.height).toBe(64);
      expect((await image.boundingBox())!.height).toBe(
        await card.evaluate((node) => node.clientHeight),
      );
      const railContent = await rail.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          height:
            node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
          tallestCard: Math.max(
            ...Array.from(node.querySelectorAll('[data-attachment-chip="image"]')).map(
              (card) => card.getBoundingClientRect().height,
            ),
          ),
        };
      });
      // clientHeight is integer-rounded while card rectangles can be fractional.
      expect(Math.abs(railContent.height - railContent.tallestCard)).toBeLessThanOrEqual(1);
      const token = bubble.getByRole("button", {
        name: "Open [image1] (screenshot-1.png) full screen",
        exact: true,
      });
      await expect(token.locator("[data-size]")).toHaveAttribute("data-size", "42 B");
      expect((await token.boundingBox())!.height).toBeLessThan(26);
      const track = dock.locator('[data-pacing-track="reserved"]');
      const summary = dock.locator(".activity-dock-summary");
      const trackBox = (await track.boundingBox())!;
      const summaryBox = (await summary.boundingBox())!;
      // Wide docks keep the pacing track beside the summary; a narrow dock gives the
      // summary its own line and the track wraps below it. Never overlapping.
      expect(
        trackBox.x >= summaryBox.x + summaryBox.width - 0.5 ||
          trackBox.y >= summaryBox.y + summaryBox.height - 0.5,
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1440) await page.screenshot({ path: info.outputPath(`chat-${theme}.png`) });
    }
  }
  const preview = group.locator(".zen-phase-summary");
  expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(120);
  await group.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(group.locator(".zen-phase-summary")).toHaveCount(0);
  await expect(group.getByText(/very-long-command-path-0/).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  // Trail rows keep one line height; a long command ends in an ellipsis inside its row
  // while the row's name and overflow hint keep the full command.
  const row = group.getByLabel(/^Tool call: .*very-long-command-path-0\.tsx$/).first();
  const command = row.getByText(/very-long-command-path-0\.tsx/).first();
  await expect(command).toContainText("very-long-command-path-0.tsx");
  expect(
    await command.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        inside: box.left >= 0 && box.right <= innerWidth + 1,
        oneLine: box.height <= parseFloat(style.lineHeight) * 1.5,
        ellipsis: style.textOverflow === "ellipsis",
      };
    }),
  ).toEqual({ inside: true, oneLine: true, ellipsis: true });
  const lastImage = bubble.getByRole("button", {
    name: "Open screenshot-7.png full screen",
    exact: true,
  });
  await lastImage.focus();
  await expect(lastImage).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lastImage).toBeFocused();
  await bubble
    .getByRole("button", { name: "Open screenshot-1.png full screen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("chat code and command results remain compact until explicitly opened", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/chat/transcript.html?artifacts", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-tool-inspection]")).toHaveCount(0);
  await page.getByRole("button", { name: /^Show changes for/ }).click();
  const code = page.locator("[data-tool-inspection]").first();
  await expect(code).toContainText("saved-code-marker");
  await expect(code.locator("pre")).toHaveCSS("user-select", "text");
  await page.getByRole("button", { name: /^Show output for/ }).click();
  await expect(page.locator("[data-tool-inspection]").last()).toContainText("output-marker");
  await page.setViewportSize({ width: 420, height: 800 });
  await expect(code).toBeVisible();
  let previousGeometry = "";
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const geometry = await code.evaluate((node) => {
        const panel = node.getBoundingClientRect();
        const header = node.querySelector("button")!.getBoundingClientRect();
        return JSON.stringify([
          panel.x,
          panel.y,
          panel.width,
          panel.height,
          header.y,
          header.height,
        ]);
      });
      stableSamples = geometry === previousGeometry ? stableSamples + 1 : 0;
      previousGeometry = geometry;
      return stableSamples;
    })
    .toBeGreaterThanOrEqual(2);
  const copy = code.getByRole("button", { name: "Copy", exact: true });
  // Visibility alone allows a partly clipped button inside the pinned live phase.
  // Both edges must be hit-testable after the responsive layout has settled.
  await expect
    .poll(() =>
      copy.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.top + 1, rect.bottom - 1].every((y) =>
          node.contains(document.elementFromPoint(rect.left + rect.width / 2, y)),
        );
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: /^Hide output for/ }).first()).toBeInViewport({
    ratio: 1,
  });
  const box = await code.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(420);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("chat-code-details.png") });
  await page
    .getByRole("button", { name: /^Hide output for/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Hide output for/ }).click();
  await expect(page.locator("[data-tool-inspection]")).toHaveCount(0);
  await expect
    .poll(() => page.locator(".zen-phase-live").evaluate((node) => node.clientHeight))
    .toBeLessThanOrEqual(120);
});

test("a chat CSV opens an actual worker-backed table and returns focus after Escape", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/chat/transcript.html?artifacts", {
    waitUntil: "domcontentloaded",
  });
  const trigger = page.getByRole("button", { name: "Open results.csv full screen", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("passed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Build", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("chat-csv-preview.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

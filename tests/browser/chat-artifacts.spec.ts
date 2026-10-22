import { expect, test } from "@playwright/test";

test("background commands wrap without losing their start and remain separate", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/transcript.html?chat-layout&background-work");
  const dock = page.getByRole("region", { name: "Turn activity", exact: true });
  await dock.locator("button[aria-expanded]").click();
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
          divider: getComputedStyle(rows[1].parentElement!).borderTopWidth,
        };
      });
      expect(geometry).toEqual({
        fits: true,
        startsVisible: true,
        wraps: true,
        separated: true,
        divider: "1px",
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
      `/tests/browser/transcript.html?message-bubbles${layout === "full" ? "&full-width" : ""}`,
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
        expect(
          await short.evaluate((node) => parseFloat(getComputedStyle(node).borderRadius)),
        ).toBeGreaterThan(shortBox.height / 2);
        await expect(long).toHaveCSS("border-radius", "12px");
        await expect(draft).toHaveCSS("border-style", "dashed");
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      }
    }
    await page.screenshot({ path: info.outputPath(`${layout}-message-bubbles.png`) });
  });
}

test("chat messages, attachment references and running work keep a readable hierarchy", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/transcript.html?chat-layout");
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
      expect((await rail.boundingBox())!.height).toBeLessThan(85);
      const token = bubble.getByRole("button", {
        name: "Open [image1] (screenshot-1.png) full screen",
        exact: true,
      });
      expect((await token.boundingBox())!.height).toBeLessThan(26);
      const track = dock.locator('[data-pacing-track="reserved"]');
      const summary = dock.locator(".activity-dock-summary");
      const trackBox = (await track.boundingBox())!;
      const summaryBox = (await summary.boundingBox())!;
      expect(trackBox.x).toBeGreaterThanOrEqual(summaryBox.x + summaryBox.width);
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
  const command = group.locator(".tool-command-label").first();
  await expect(command).toContainText("very-long-command-path-0.tsx");
  expect(
    await command.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].every(
        (rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1,
      );
    }),
  ).toBe(true);
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
  await page.goto("/tests/browser/transcript.html?artifacts", { waitUntil: "domcontentloaded" });
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
  await page.goto("/tests/browser/transcript.html?artifacts", { waitUntil: "domcontentloaded" });
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

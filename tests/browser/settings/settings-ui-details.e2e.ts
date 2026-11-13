import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`MCP enable and disable preserve connection identity: ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=mcp&mcp=1&theme=${theme}&lang=en`,
      );
      const connections = page.locator("#setting-mcp-servers");
      // Enable/disable is the row switch; the actions menu keeps config and removal only.
      const toggle = connections.getByRole("switch", {
        name: "server-01 · Codex · Global",
        exact: true,
      });
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`mcp-enable-${theme}-${width}.png`) });
      await toggle.click();
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-mcp-toggle") ?? "null")),
        )
        .toMatchObject({
          provider: "codex",
          name: "server-01",
          scope: "user",
          enabled: true,
          expectedEnabled: false,
        });
      await expect(toggle).toBeChecked();
      await expect(toggle).toBeEnabled();
      await toggle.click();
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-mcp-toggle") ?? "null")),
        )
        .toMatchObject({
          provider: "codex",
          name: "server-01",
          scope: "user",
          enabled: false,
          expectedEnabled: true,
        });
      await expect(toggle).not.toBeChecked();
      await page.screenshot({ path: info.outputPath(`mcp-disabled-${theme}-${width}.png`) });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const lang of ["en", "tr"]) {
    test(`narrow provider search preserves selection across resize: ${theme} ${lang}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=providers&theme=${theme}&lang=${lang}`,
      );
      const picker = page.locator(".provider-cli-select").getByRole("button");
      await expect(picker).toBeVisible();
      await expect(page.locator(".provider-cli-selector")).toBeHidden();
      await picker.click();
      const search = page.getByRole("combobox", {
        name: lang === "tr" ? "Sağlayıcı ara…" : "Search providers…",
        exact: true,
      });
      await expect(search).toBeFocused();
      await search.fill("Codex");
      const option = page.getByRole("option", { name: /^Codex/ });
      await expect(option).toBeVisible();
      await option.click();
      await expect(picker).toContainText("Codex");
      await expect(picker).toBeFocused();
      await expect(page.locator(".provider-cli-detail .provider-detail-header")).toContainText(
        "Codex",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath("provider-narrow.png") });
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(picker).toBeHidden();
      const selected = page
        .locator(".provider-cli-selector")
        .getByRole("button", { name: /^Codex,/ });
      await expect(selected).toHaveAttribute("aria-current", "true");
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(picker).toContainText("Codex");
      await picker.click();
      await page.keyboard.press("Escape");
      await expect(picker).toBeFocused();
    });
  }

  test(`general settings keep short cards fitted to their content: ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    // Close to tray is a Windows capability; exercise it deterministically
    // even when the browser fixture runs on a Linux CI worker.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    });
    await page.goto(`/tests/browser/settings/settings.html?section=general&theme=${theme}&lang=en`);
    const row = page.locator('[data-setting-id="close-to-tray"]');
    await expect(row).toBeVisible();
    const card = page
      .locator(".general-settings > .settings-group > .settings-group-content")
      .filter({ has: row });
    const rowBounds = (await row.boundingBox())!;
    const cardBounds = (await card.boundingBox())!;
    expect(cardBounds.height - rowBounds.height).toBeLessThan(4);
    await expect(row.getByRole("switch")).toBeVisible();
    await page.screenshot({ path: info.outputPath("general-compact-card.png") });
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`MCP compact scope and add form ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=mcp&mcp=1&theme=${theme}&lang=en`,
      );
      const connections = page.locator("#setting-mcp-servers");
      await expect(connections.getByRole("radio", { name: "Global", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(connections.getByRole("button", { name: /^Switch project/ })).toHaveCount(0);
      await expect(connections.getByText("arc", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-10-mcp/global-${theme}-${width}.png`,
      });
      await connections.getByRole("radio", { name: "Project", exact: true }).click();
      await expect(connections.getByRole("button", { name: /^Switch project/ })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-10-mcp/project-${theme}-${width}.png`,
      });
      await connections.getByRole("button", { name: "Add MCP server", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "Add MCP server", exact: true });
      await expect(modal).toBeVisible();
      await expect(modal.getByText(/Advanced/)).toHaveCount(0);
      await expect(modal.getByText(/Selected project:/)).toHaveCount(0);
      await expect(modal.getByRole("button", { name: "Add server", exact: true })).toBeVisible();
      await page.screenshot({ path: `temp/verification/2026-11-10-mcp/add-${theme}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

test("MCP rows keep scroll, filtered first edge and actions", async ({ page }) => {
  await page.goto("/tests/browser/settings/settings.html?section=mcp&mcp=1&theme=light&lang=en");
  const connections = page.locator("#setting-mcp-servers");
  const list = connections.locator("[data-continuous-list]");
  await expect(list.locator("[data-collection-key]")).toHaveCount(25);
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await connections.getByRole("searchbox", { name: "Search MCP servers" }).fill("server-24");
  const row = list.locator("[data-collection-key]");
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveAttribute("data-row-divider", "");
  await expect(row).toHaveCSS("border-block-start-width", "0px");
  await row.getByRole("button", { name: "Actions for server-24" }).click();
  const menu = page.getByRole("menu", { name: "Actions for server-24" });
  await expect(menu.getByRole("menuitem", { name: "Show config" })).toBeEnabled();
  await page.keyboard.press("Escape");
});

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`settings group frame ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=general&theme=${theme}&lang=en`,
      );
      const frame = page
        .locator(".general-settings > .settings-group > .settings-group-content")
        .first();
      await expect(frame).toBeVisible();
      await expect(frame).toHaveAttribute("data-surface-variant", "card");
      await expect(frame).toHaveAttribute("data-surface-frame", "card");
      const row = frame.locator(".settings-row").first();
      await expect(row).toHaveAttribute("data-variant", "settings");
      await row.hover();
      await frame.screenshot({
        path: info.outputPath(`group-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`provider account row appearance ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=providers&providersFixture=1&theme=${theme}&lang=en`,
      );
      const row = page.locator(".provider-account-row[data-action-host]:visible").first();
      await expect(row).toBeVisible();
      await row.hover();
      await row.screenshot({
        path: info.outputPath(`provider-row-${theme}-${width}.png`),
        animations: "disabled",
      });
      const actions = row.getByRole("button", { name: /^Actions for / });
      await actions.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`messaging form action divider ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=integrations&collectionMessaging=1&theme=${theme}&lang=en`,
      );
      await page.getByRole("tab", { name: "Email", exact: true }).click();
      const panel = page.getByRole("tabpanel", { name: "Email" });
      const account = panel.getByRole("listitem").filter({ hasText: "Work email" });
      await account.getByRole("button", { name: "Edit" }).click();
      const actions = panel.locator('.integration-actions[data-surface-frame="settings"]');
      await expect(actions).toBeVisible();
      await expect(actions).toHaveCSS("border-block-start-width", "1px");
      await actions.scrollIntoViewIfNeeded();
      await panel.screenshot({
        path: info.outputPath(`messaging-actions-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`appearance sticky border ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      const header = page.locator(".appearance-generator");
      await expect(header).toBeVisible();
      await expect(header).not.toHaveAttribute("data-stuck", "");
      await expect(header).toHaveAttribute("data-surface-frame", "transparent");
      await expect(header).toHaveCSS("border-block-end-width", "1px");
      await header.screenshot({
        path: info.outputPath(`appearance-unstuck-${theme}-${width}.png`),
        animations: "disabled",
      });
      const scroller = page.locator("[data-settings-scroller]");
      await scroller.evaluate((node) => {
        node.scrollTop = 600;
      });
      await expect(header).toHaveAttribute("data-stuck", "");
      await expect(header).toHaveAttribute("data-surface-frame", "pane");
      await expect(header).toHaveCSS("border-block-end-width", "1px");
      await header.screenshot({
        path: info.outputPath(`appearance-sticky-${theme}-${width}.png`),
        animations: "disabled",
      });
      await scroller.evaluate((node) => {
        node.scrollTop = 0;
      });
      await expect(header).not.toHaveAttribute("data-stuck", "");
      await expect(header).toHaveAttribute("data-surface-frame", "transparent");
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`antigravity disclosure surface ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?antigravityVisual=1&theme=${theme}&lang=en`,
      );
      const card = page.locator("#setting-antigravity-account");
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-surface-variant", "card");
      await card.screenshot({
        path: info.outputPath(`antigravity-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`responsive settings pane borders ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/settings/settings.html?section=chat&theme=${theme}&lang=en`);
      await page.getByRole("button", { name: "Add template", exact: true }).click();
      const editor = page.locator(".template-manager-editor");
      await expect(editor).toBeVisible();
      const edgeValues = (node: Element) => {
        const style = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.style.color = "var(--color-stroke)";
        node.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return {
          block: style.borderBlockStartWidth,
          inline: style.borderInlineStartWidth,
          blockColor: style.borderBlockStartColor,
          inlineColor: style.borderInlineStartColor,
          expected,
        };
      };
      const chatEdges = await editor.evaluate(edgeValues);
      expect([chatEdges.block, chatEdges.inline]).toEqual(
        width === 800 ? ["1px", "0px"] : ["0px", "1px"],
      );
      expect(width === 800 ? chatEdges.blockColor : chatEdges.inlineColor).toBe(chatEdges.expected);
      await editor.screenshot({ path: info.outputPath(`template-edge-${theme}-${width}.png`) });
      await page.goto(
        `/tests/browser/settings/settings.html?section=policies&theme=${theme}&lang=en`,
      );
      const reader = page.locator(".policy-reader");
      await expect(reader).toBeVisible();
      const policyEdges = await reader.evaluate(edgeValues);
      expect([policyEdges.block, policyEdges.inline]).toEqual(
        width === 800 ? ["1px", "0px"] : ["0px", "1px"],
      );
      expect(width === 800 ? policyEdges.blockColor : policyEdges.inlineColor).toBe(
        policyEdges.expected,
      );
      await page.screenshot({ path: info.outputPath(`policy-edge-${theme}-${width}.png`) });
    });
  }
}

test("appearance sticky mask computed probe", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.goto(
      `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
    );
    const header = page.locator(".appearance-generator");
    await expect(header).toBeVisible();
    console.log(
      JSON.stringify({
        theme,
        shadow: await header.evaluate((node) => getComputedStyle(node).boxShadow),
      }),
    );
  }
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`appearance selected controls ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("bycoda.chatBackgroundLibraryId.v1", "fixture-image");
        localStorage.setItem(
          "bycoda.savedThemes.v1",
          JSON.stringify([
            { id: "fixture-look", name: "Fixture look", createdAt: 1, updatedAt: 1, look: {} },
          ]),
        );
      });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en&libraryProbe`,
      );
      const palette = page.getByRole("radiogroup", { name: "Theme palettes" });
      await palette.getByRole("radio").first().click();
      const selected = palette.getByRole("radio", { checked: true });
      await expect(selected).toBeVisible();
      await selected.blur();
      await expect(selected).toHaveCSS("box-shadow", /2px/);
      const paletteStyle = await selected.evaluate((element) => ({
        shadow: getComputedStyle(element).boxShadow,
        border: getComputedStyle(element).borderColor,
        background: getComputedStyle(element).backgroundColor,
      }));
      console.log(JSON.stringify({ theme, width, paletteStyle }));
      await palette.screenshot({ path: info.outputPath(`palette-${theme}-${width}.png`) });
      const saved = page.locator(".theme-saved-card").filter({ hasText: "Fixture look" });
      await expect(saved).toHaveCSS("border-top-left-radius", "9px");
      const savedActions = saved.locator(".theme-saved-actions");
      await page.mouse.move(0, 0);
      await expect(savedActions).toHaveCSS("opacity", "0");
      const savedBox = await savedActions.boundingBox();
      await saved
        .getByRole("button")
        .first()
        .click({ position: { x: 10, y: 10 } });
      await expect(savedActions).toHaveCSS("opacity", "1");
      expect(await savedActions.boundingBox()).toEqual(savedBox);
      await saved.getByRole("button", { name: "Rename" }).focus();
      await expect(savedActions).toHaveCSS("opacity", "1");
      await saved.screenshot({ path: info.outputPath(`saved-actions-${theme}-${width}.png`) });
      await selected.hover();
      await expect(selected).toHaveCSS("box-shadow", paletteStyle.shadow);
      await selected.focus();
      await selected.press("ArrowRight");
      await expect(palette.getByRole("radio").nth(1)).toBeChecked();
      await expect(palette.getByRole("radio").nth(1)).toBeFocused();
      await page.getByRole("tab", { name: "Background", exact: true }).click();
      await page.getByRole("button", { name: /Image Picture behind chat panes/ }).click();
      const tile = page.getByRole("button", { name: "Added image", exact: true });
      await expect(tile).toBeVisible();
      const tileStyle = await tile.evaluate((element) => ({
        shadow: getComputedStyle(element).boxShadow,
        background: getComputedStyle(element).backgroundColor,
      }));
      console.log(JSON.stringify({ theme, width, tileStyle }));
      await tile.screenshot({ path: info.outputPath(`library-${theme}-${width}.png`) });
      const remove = page.getByRole("button", { name: "Delete image" });
      await page.mouse.move(0, 0);
      await page.getByRole("tab", { name: "Background", exact: true }).focus();
      await expect(remove).toHaveCSS("opacity", "0");
      await tile.hover();
      await expect(tile).toHaveCSS("box-shadow", tileStyle.shadow);
      await tile.focus();
      await expect(remove).toHaveCSS("opacity", "1");
      await tile
        .locator("..")
        .screenshot({ path: info.outputPath(`library-actions-${theme}-${width}.png`) });
      await page.keyboard.press("Tab");
      await expect(remove).toBeFocused();
    });
  }

test("appearance selection controls respond to touch", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 800, height: 900 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("bycoda.chatBackgroundLibraryId.v1", "fixture-image");
    localStorage.setItem(
      "bycoda.savedThemes.v1",
      JSON.stringify([
        { id: "fixture-look", name: "Fixture look", createdAt: 1, updatedAt: 1, look: {} },
      ]),
    );
  });
  await page.goto(
    "/tests/browser/settings/settings.html?section=appearance&theme=dark&lang=en&libraryProbe",
  );
  await expect(
    page
      .locator(".theme-saved-card")
      .filter({ hasText: "Fixture look" })
      .locator(".theme-saved-actions"),
  ).toHaveCSS("opacity", "1");
  const palettes = page.getByRole("radiogroup", { name: "Theme palettes" });
  const option = palettes.getByRole("radio").nth(1);
  await option.tap();
  await expect(option).toBeChecked();
  await expect(option).toHaveCSS("box-shadow", /2px/);
  await page.getByRole("tab", { name: "Background", exact: true }).tap();
  await page.getByRole("button", { name: /Image Picture behind chat panes/ }).tap();
  const image = page.getByRole("button", { name: "Added image", exact: true });
  const remove = page.getByRole("button", { name: "Delete image" });
  await expect(remove).toHaveCSS("opacity", "0");
  await image.tap();
  await expect(remove).toHaveCSS("opacity", "1");
  await expect(image).toHaveCSS("box-shadow", /2px/);
  await context.close();
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`settings nested group surface ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/settings/settings.html?section=chat&theme=${theme}&lang=en`);
      const advanced = page
        .locator(".settings-advanced")
        .filter({ has: page.getByRole("button", { name: "Advanced conversation settings" }) });
      await expect(advanced).toBeVisible();
      const toggle = advanced.getByRole("button", { name: "Advanced conversation settings" });
      await expect(toggle).toHaveCSS("border-top-left-radius", "0px");
      await toggle.focus();
      await toggle.press("Space");
      const data = await advanced.evaluate((node) => {
        const group = node.closest(".settings-group-content")!;
        const describe = (element: Element | null) => {
          if (!element) return null;
          const s = getComputedStyle(element);
          return {
            border: s.borderTopWidth,
            color: s.borderTopColor,
            radius: s.borderTopLeftRadius,
            background: s.backgroundColor,
            box: element.getBoundingClientRect().toJSON(),
          };
        };
        return {
          group: describe(group),
          first: describe(group.firstElementChild),
          last: describe(group.lastElementChild),
          advanced: describe(node),
          row: describe(node.querySelector(".settings-row")),
        };
      });
      expect(data.group?.border).toBe("1px");
      expect(data.group?.radius).toBe("8px");
      expect(data.first?.border).toBe("0px");
      expect(data.first?.radius).toBe("7px");
      expect(data.advanced?.border).toBe("1px");
      expect(data.advanced?.radius).toBe("0px");
      expect(data.row?.border).toBe("1px");
      expect(data.row?.radius).toBe("0px");
      console.log("NESTED_BASELINE", JSON.stringify(data));
      await advanced.screenshot({ path: info.outputPath(`nested-${theme}-${width}.png`) });
    });
  }

test("settings email advanced surface computed baseline", async ({ page }, info) => {
  await page.goto(
    "/tests/browser/settings/settings.html?section=integrations&collectionMessaging=1&theme=light&lang=en",
  );
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Email" });
  await panel
    .getByRole("listitem")
    .filter({ hasText: "Work email" })
    .getByRole("button", { name: "Edit" })
    .click();
  const advanced = panel.locator(".settings-advanced");
  await expect(advanced).toBeVisible();
  const styles = await advanced.evaluate((node) => {
    const s = getComputedStyle(node);
    return {
      border: s.borderTopWidth,
      color: s.borderTopColor,
      radius: s.borderTopLeftRadius,
      background: s.backgroundColor,
      parent: node.parentElement?.className,
    };
  });
  expect(styles.border).toBe("1px");
  expect(styles.radius).toBe("0px");
  console.log("EMAIL_ADVANCED_BASELINE", JSON.stringify(styles));
  await advanced.screenshot({ path: info.outputPath("email-advanced-baseline.png") });
});

test("standalone advanced settings retain frame and draft", async ({ page }, info) => {
  await page.goto(
    "/tests/browser/settings/settings.html?standaloneAdvancedProbe&theme=light&lang=en",
  );
  const advanced = page.locator(".settings-advanced");
  await expect(advanced).toHaveCSS("border-top-width", "1px");
  await expect(advanced).toHaveCSS("border-top-left-radius", "8px");
  await expect(advanced.locator(".settings-row")).toHaveCSS("border-top-width", "1px");
  const draft = page.getByRole("textbox", { name: "Standalone draft" });
  await draft.fill("unsaved");
  const identity = await draft.evaluate((el) => {
    (window as any).draftElement = el;
    return true;
  });
  expect(identity).toBe(true);
  await page.getByRole("button", { name: "Standalone advanced" }).click();
  await page.getByRole("button", { name: "Standalone advanced" }).click();
  await expect(draft).toHaveValue("unsaved");
  expect(await draft.evaluate((el) => el === (window as any).draftElement)).toBe(true);
  await advanced.screenshot({ path: info.outputPath("standalone-advanced.png") });
});

test("archived collection frame computed baseline", async ({ page }, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "bycoda.archivedProjects",
      JSON.stringify([{ path: "/fixture/archive", archivedAt: 1 }]),
    ),
  );
  await page.goto("/tests/browser/settings/settings.html?section=archive&theme=light&lang=en");
  const collection = page.locator(".settings-group-content > .settings-collection").first();
  await expect(collection).toBeVisible();
  const value = await collection.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopWidth, radius: s.borderTopLeftRadius, color: s.borderTopColor };
  });
  expect(value.border).toBe("0px");
  expect(value.radius).toBe("7px");
  console.log("ARCHIVE_BASELINE", JSON.stringify(value));
  await collection.screenshot({ path: info.outputPath("archive-frame-baseline.png") });
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`terminal nested collection ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=terminal&terminal=1&theme=${theme}&lang=en`,
      );
      const frame = page.locator(".settings-group-content > .terminal-host-list");
      await expect(frame).toHaveCSS("border-top-width", "0px");
      await expect(frame).toHaveCSS("border-top-left-radius", "7px");
      await frame.screenshot({
        path: info.outputPath(`terminal-collection-${theme}-${width}.png`),
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`empty privacy collections ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=groupLock&theme=${theme}&lang=en`,
      );
      const frames = page.locator(".settings-group-content > .settings-collection");
      await expect(frames.first()).toBeVisible();
      await expect(page.getByText("No hidden groups", { exact: true })).toBeVisible();
      const count = await frames.count();
      expect(count).toBe(2);
      for (let i = 0; i < count; i++) {
        await expect(frames.nth(i)).toHaveCSS("border-top-width", "0px");
        await expect(frames.nth(i)).toHaveCSS("border-top-left-radius", "7px");
      }
      await frames
        .first()
        .screenshot({ path: info.outputPath(`privacy-empty-${theme}-${width}.png`) });
      await frames
        .nth(1)
        .screenshot({ path: info.outputPath(`hidden-empty-${theme}-${width}.png`) });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`background layer embedded settings ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      await page.getByRole("tab", { name: "Background", exact: true }).click();
      for (const name of ["Glass", "Color", "Image", "Live"]) {
        const toggle = page.getByRole("button", { name: new RegExp(`^${name} `) });
        const id = await toggle.getAttribute("aria-controls");
        await toggle.click();
        const nested = page.locator(`[id="${id}"] .settings-group-content`);
        await expect(nested).toHaveAttribute("data-surface-layout", "settings-group-flat");
        await expect(nested).toHaveCSS("border-top-width", "0px");
        await expect(nested).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(nested.locator(":scope > :first-child")).toHaveCSS(
          "border-top-left-radius",
          "7px",
        );
        const row = nested.locator("[data-settings-part=row]");
        for (let i = 0; i < (await row.count()); i++)
          await expect(row.nth(i)).toHaveCSS("border-top-width", "0px");
        await nested.screenshot({ path: info.outputPath(`layer-${name}-${theme}-${width}.png`) });
      }
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`managed workspace row action states ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?collectionWorktrees=1&theme=${theme}&lang=en`,
      );
      const row = page.getByRole("listitem").filter({ hasText: "Managed workspace" });
      const actions = row.locator(".settings-collection-actions");
      const caption = row.locator("[data-size=caption]").first();
      console.log("MANAGED_FONT", await caption.evaluate((el) => getComputedStyle(el).fontFamily));
      await expect(actions).toHaveCSS("opacity", "0.6");
      const box = await actions.boundingBox();
      await row.hover();
      await expect(actions).toHaveCSS("opacity", "1");
      await page.mouse.move(0, 0);
      await row.getByRole("button", { name: "Review changes" }).focus();
      await expect(actions).toHaveCSS("opacity", "1");
      await row.getByRole("button", { name: "Review changes" }).blur();
      await row.locator("summary").click();
      await page.mouse.move(0, 0);
      await expect(actions).toHaveCSS("opacity", "1");
      expect(await actions.boundingBox()).toEqual(box);
      await row.screenshot({ path: info.outputPath(`managed-workspace-${theme}-${width}.png`) });
    });
  }
test("managed workspace actions remain visible on coarse pointer", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 800, height: 900 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/tests/browser/settings/settings.html?collectionWorktrees=1&theme=dark&lang=en");
  const row = page.getByRole("listitem").filter({ hasText: "Managed workspace" });
  await expect(row.locator(".settings-collection-actions")).toHaveCSS("opacity", "1");
  await context.close();
});

test("settings heading responsive visibility baseline", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/browser/settings/settings.html?section=chat&theme=light&lang=en");
    const title = page.locator(".settings-page-bar .settings-page-title");
    const style = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        position: s.position,
        width: s.width,
        height: s.height,
        overflow: s.overflow,
        margin: s.marginTop,
        clip: s.clipPath,
      };
    });
    expect(await title.evaluate((el) => el.tagName)).toBe("H1");
    if (width === 390)
      expect(style).toEqual({
        position: "absolute",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        margin: "-1px",
        clip: "inset(50%)",
      });
    else expect(style.position).toBe("static");
  }
});

test("background layer row interaction baseline", async ({ page }) => {
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en");
  await page.getByRole("tab", { name: "Background", exact: true }).click();
  await page.getByRole("button", { name: /Image Picture behind chat panes/ }).click();
  const toggle = page.getByRole("switch", { name: "Chat background layer" });
  const row = toggle.locator("xpath=ancestor::*[@data-settings-part='row'][1]");
  const read = () =>
    row.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, border: s.borderTopWidth };
    });
  const rest = await read();
  await row.hover();
  const hover = await read();
  await toggle.focus();
  const focus = await read();
  expect(rest).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px" });
  expect(hover).toEqual(rest);
  expect(focus).toEqual(rest);
  const checked = await toggle.getAttribute("aria-checked");
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", checked === "true" ? "false" : "true");
});

test("advanced settings toggle surface baseline", async ({ page }) => {
  await page.goto("/tests/browser/settings/settings.html?section=chat&theme=light&lang=en");
  const toggle = page.getByRole("button", { name: "Advanced conversation settings" });
  const read = () =>
    toggle.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderTopLeftRadius, height: s.height, background: s.backgroundColor };
    });
  const rest = await read();
  await toggle.hover();
  const hover = await read();
  await toggle.focus();
  const focus = await read();
  console.log("ADVANCED_TOGGLE_BASELINE", JSON.stringify({ rest, hover, focus }));
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    for (const empty of [false, true]) {
      test(`provider account divider ${empty ? "empty" : "populated"} ${theme} ${width}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `/tests/browser/settings/settings.html?section=providers&providersFixture=1${empty ? "&emptyProvider" : ""}&theme=${theme}&lang=en`,
        );
        const group = page.locator("#setting-provider-accounts");
        const body = group.locator(".provider-accounts-body:visible");
        if (empty) await expect(body.locator(".provider-account-empty")).toBeVisible();
        else await expect(body.locator(".provider-account-row")).toHaveCount(1);
        await group.getByRole("button", { name: "Add account" }).click();
        const editor = body.locator(".provider-account-editor");
        await expect(editor).toBeVisible();
        await expect(editor).toHaveCSS("border-top-width", empty ? "0px" : "1px");
        const draft = editor.getByRole("textbox", { name: /New .* account/ });
        await draft.fill("Unsaved test account");
        await expect(draft).toHaveValue("Unsaved test account");
        await group.screenshot({
          path: info.outputPath(`provider-${empty ? "empty" : "populated"}-${theme}-${width}.png`),
        });
        await editor.getByRole("button", { name: "Cancel" }).click();
        await expect(editor).toHaveCount(0);
      });
    }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`image dropzone states ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings/settings.html?dropzoneProbe&theme=${theme}&lang=en`);
      const buttons = page.locator("main button");
      await expect(buttons).toHaveCount(3);
      const read = (i: number) =>
        buttons.nth(i).evaluate((el) => {
          const s = getComputedStyle(el),
            r = el.getBoundingClientRect();
          return {
            border: s.borderTopWidth,
            style: s.borderTopStyle,
            color: s.borderTopColor,
            radius: s.borderTopLeftRadius,
            width: r.width,
            height: r.height,
          };
        });
      const empty = await read(0),
        filled = await read(1),
        disabled = await read(2);
      expect(empty).toMatchObject({
        border: "1px",
        style: "dashed",
        radius: "10px",
        width: 176,
        height: 110,
      });
      expect(filled).toMatchObject({
        border: "1px",
        style: "solid",
        radius: "10px",
        width: 176,
        height: 110,
      });
      expect(disabled).toMatchObject({
        border: "1px",
        style: "dashed",
        radius: "10px",
        width: 176,
        height: 110,
        color: "rgba(0, 0, 0, 0)",
      });
      await expect(buttons.nth(2)).toBeDisabled();
      await buttons
        .nth(0)
        .locator("..")
        .evaluate((el) => el.setAttribute("data-over", ""));
      await expect.poll(async () => (await read(0)).color).not.toBe(empty.color);
      expect(await read(0)).toMatchObject({
        border: "1px",
        style: "dashed",
        radius: "10px",
        width: 176,
        height: 110,
      });
      await page
        .locator("main")
        .screenshot({ path: info.outputPath(`dropzone-${theme}-${width}.png`) });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`gradient controls ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      await page.getByRole("tab", { name: "Background", exact: true }).click();
      await page.getByRole("button", { name: /^Color Gradient/ }).click();
      const button = page.getByRole("button", { name: "Color 1", exact: true });
      const swatch = button.locator("span[aria-hidden]");
      await expect(swatch).toHaveCSS("border-top-width", "2px");
      await expect(swatch).toHaveCSS("border-top-left-radius", "50%");
      const dial = page.getByRole("slider", { name: "Gradient angle", exact: true });
      await expect(dial).toHaveCSS("width", "32px");
      await expect(dial).toHaveCSS("border-top-left-radius", "50%");
      await page.keyboard.press("Tab");
      await dial.focus();
      expect(await dial.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
      await expect(dial).toHaveCSS("outline-width", "1px");
      await expect(dial).toHaveCSS("outline-offset", "2px");
      const value = Number(await dial.getAttribute("aria-valuenow"));
      await dial.press("ArrowRight");
      await expect(dial).toHaveAttribute("aria-valuenow", String(value + 1));
      await dial.screenshot({ path: info.outputPath(`gradient-dial-${theme}-${width}.png`) });
      await button.click();
      await expect(page.getByRole("textbox", { name: "Hex color" })).toBeVisible();
      await page.keyboard.press("Escape");
    });
  }

test("library tile surface baseline", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("bycoda.chatBackgroundLibraryId.v1", "fixture-image"),
  );
  await page.goto(
    "/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en&libraryProbe",
  );
  await page.getByRole("tab", { name: "Background", exact: true }).click();
  await page.getByRole("button", { name: /Image Picture behind chat panes/ }).click();
  const tile = page.getByRole("button", { name: "Added image", exact: true });
  const read = () =>
    tile.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, radius: s.borderTopLeftRadius };
    });
  const rest = await read();
  await tile.hover();
  const hover = await read();
  console.log("LIBRARY_BASELINE", JSON.stringify({ rest, hover }));
});

test("library remove surface baseline", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("bycoda.chatBackgroundLibraryId.v1", "fixture-image"),
  );
  await page.goto(
    "/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en&libraryProbe",
  );
  await page.getByRole("tab", { name: "Background", exact: true }).click();
  await page.getByRole("button", { name: /Image Picture behind chat panes/ }).click();
  const remove = page.getByRole("button", { name: "Delete image" });
  const read = () =>
    remove.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, border: s.borderTopColor };
    });
  const rest = await read();
  await remove.hover();
  const hover = await read();
  await remove.focus();
  const focus = await read();
  console.log("LIBRARY_REMOVE_BASELINE", JSON.stringify({ rest, hover, focus }));
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`scrollbar settings dividers ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      await page.getByRole("tab", { name: "Interface", exact: true }).click();
      const controls = page.locator(".interface-scrollbar-controls");
      const rows = controls.locator(":scope > .settings-row");
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0)).toHaveCSS("border-top-width", "0px");
      for (let i = 1; i < 4; i++) await expect(rows.nth(i)).toHaveCSS("border-top-width", "1px");
      await controls.screenshot({
        path: info.outputPath(`scrollbar-settings-${theme}-${width}.png`),
      });
    });
  }

test("palette card surface baseline", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en");
  const cards = page.getByRole("radiogroup", { name: "Theme palettes" }).getByRole("radio");
  const target = cards.nth(1);
  const read = () =>
    target.evaluate((el) => {
      const s = getComputedStyle(el),
        r = el.getBoundingClientRect();
      return {
        border: s.borderTopWidth,
        color: s.borderTopColor,
        radius: s.borderTopLeftRadius,
        background: s.backgroundColor,
        shadow: s.boxShadow,
        width: r.width,
        height: r.height,
      };
    });
  const rest = await read();
  await target.hover();
  const hover = await read();
  await target.click();
  await page.keyboard.press("Tab");
  await target.focus();
  const selected = await read();
  console.log("PALETTE_CARD_BASELINE", JSON.stringify({ rest, hover, selected }));
});
for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`settings reveal and provider separators ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      await page.getByRole("button", { name: "Search settings", exact: true }).click();
      const search = page.getByRole("combobox", { name: "Search settings", exact: true });
      await search.fill("Saturation");
      await expect(page.getByRole("option").first()).toContainText("Saturation");
      await search.press("Enter");
      const row = page.locator('[data-setting-id="saturation"]');
      await expect(row).toHaveAttribute("data-revealed", "true");
      await expect(row).toHaveCSS("animation-name", "none");
      expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        "rgba(0, 0, 0, 0)",
      );
      await row.screenshot({ path: info.outputPath(`reveal-${theme}-${width}.png`) });
      await page.goto(
        `/tests/browser/settings/settings.html?section=providers&providersFixture=1&theme=${theme}&lang=en`,
      );
      const selectProvider = async (name: string) => {
        const picker = page.locator(".provider-cli-select").getByRole("button");
        if (await picker.isVisible()) {
          await picker.click();
          await page.getByRole("combobox", { name: "Search providers…" }).fill(name);
          await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
        } else {
          await page.locator(".provider-cli-option").filter({ hasText: name }).click();
        }
      };
      await selectProvider("Claude");
      const hooks = page.locator('[data-setting-id="claude-hooks"]');
      await expect(hooks).toBeVisible();
      await expect(hooks).toHaveCSS("border-top-width", "1px");
      await hooks.screenshot({ path: info.outputPath(`hooks-${theme}-${width}.png`) });
      await selectProvider("Cursor");
      const standalone = page.locator(
        "#setting-provider-accounts > .settings-group-content > .settings-row",
      );
      await expect(standalone).toBeVisible();
      await expect(standalone).toHaveCSS("border-top-width", "0px");
      await standalone.screenshot({ path: info.outputPath(`standalone-${theme}-${width}.png`) });
    });
  }
test("settings search reveal normal motion settles", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en");
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("Saturation");
  await expect(page.getByRole("option").first()).toContainText("Saturation");
  await search.press("Enter");
  const row = page.locator('[data-setting-id="saturation"]');
  await expect(row).toHaveAttribute("data-revealed", "true");
  expect(await row.evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
  await expect
    .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 5000 })
    .toMatch(/^(rgba\(0, 0, 0, 0\)|oklab\(0 0 0 \/ 0\))$/);
});
for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`generated suggestion and group reveal ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&generatorSuggestions&theme=${theme}&lang=en`,
      );
      const suggestion = page
        .getByRole("group", { name: "Suggested themes" })
        .getByRole("button", { name: /Fixture meadow/ });
      await expect(suggestion).toBeVisible();
      await expect(suggestion.locator(".theme-swatch-strip > span")).toHaveCount(4);
      await suggestion.screenshot({ path: info.outputPath(`suggestion-${theme}-${width}.png`) });
      await page.getByRole("button", { name: "Search settings", exact: true }).click();
      const search = page.getByRole("combobox", { name: "Search settings", exact: true });
      await search.fill("Interface font");
      await expect(page.getByRole("option").first()).toContainText("Interface font");
      await search.press("Enter");
      const group = page.locator('[data-setting-id="interface-font"]');
      await expect(group).toHaveAttribute("data-revealed", "true");
      const content = group.locator('[data-surface-reveal="group"]');
      expect(await content.evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
      await content.screenshot({ path: info.outputPath(`group-reveal-${theme}-${width}.png`) });
      await expect
        .poll(() => content.evaluate((el) => getComputedStyle(el).backgroundColor), {
          timeout: 5000,
        })
        .toMatch(/^(rgba\(0, 0, 0, 0\)|oklab\(0 0 0 \/ 0\))$/);
    });
  }

import { test, expect } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`open appearance previews ${theme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=tr`,
      );
      const appearance = page.locator(".appearance-settings");
      await expect(appearance.locator("details, summary")).toHaveCount(0);
      // One topic per inner tab (Theme, Background, Interface, Typography, Motion); panels stay mounted.
      await expect(appearance.locator(".appearance-section")).toHaveCount(5);
      const topics = appearance.getByRole("tablist", { name: "Görünüm", exact: true });
      await expect(topics.getByRole("tab")).toHaveCount(5);
      const openTopic = (name: string) => topics.getByRole("tab", { name, exact: true }).click();
      // The dark-mode depth slider is always visible in the Theme tab, next to hue and saturation.
      for (const id of ["hue", "saturation", "dark-lightness"]) {
        await expect(appearance.locator(`[data-setting-id="${id}"]`)).toBeVisible();
      }
      await openTopic("Tipografi");
      await expect(appearance.locator('[data-setting-id="code-font-size"]')).toBeVisible();
      // Sidebar opacity lives in the Glass background layer, whose editor opens from its row.
      await openTopic("Arka plan");
      const glass = appearance.getByRole("button", {
        name: /Kenar çubuğu ve ana panel saydamlığı/,
      });
      await expect(glass).toHaveAttribute("aria-expanded", "false");
      await glass.click();
      await expect(glass).toHaveAttribute("aria-expanded", "true");
      await expect(appearance.locator('[data-setting-id="sidebar-opacity"]')).toBeVisible();
      await openTopic("Hareket");
      await expect(appearance.locator('[data-setting-id="tab-animations"]')).toBeVisible();
      await openTopic("Tema");
      await expect(
        appearance.getByRole("radiogroup", { name: "Renk şeması" }).getByRole("radio"),
      ).toHaveCount(3);
      await expect(appearance.locator(".theme-palette-card")).toHaveCount(6);
      const tide = appearance.locator(".theme-palette-card").filter({ hasText: "Tide" });
      await tide.focus();
      await page.keyboard.press("Enter");
      await expect(tide).toHaveAttribute("aria-checked", "true");
      await page.reload();
      await expect(tide).toHaveAttribute("aria-checked", "true");
      // Open rows outset their hover surface by 12px into the form's padding, so the measured
      // boundary is the padded form and the scroller, not the inner appearance wrapper.
      expect(
        await page
          .locator(".bycoda-settings-form")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      expect(
        await page
          .locator("[data-settings-scroller]")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      const overflow = await appearance
        .locator(".settings-row, .settings-group-heading, .appearance-scheme-options")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => node.className),
        );
      expect(overflow).toEqual([]);
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({ path: testInfo.outputPath(`appearance-${theme}-${width}.png`) });
      await openTopic("Tipografi");
      await appearance.locator('[data-setting-id="interface-font"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`typography-${theme}-${width}.png`) });
    });
  }
}

test("settings expose advanced controls without opening a menu", async ({ page }) => {
  for (const section of [
    "general",
    "chat",
    "workspace",
    "terminal",
    "providers",
    "mcp",
    "groupLock",
    "connections",
    "policies",
    "archive",
  ]) {
    await page.goto(`/tests/browser/settings/settings.html?section=${section}&theme=dark&lang=en`);
    const form = page.locator(".bycoda-settings-form");
    // Build provenance and provider setup/discovery are intentionally disclosed.
    // Keep this inventory exact so ordinary settings cannot silently move behind disclosures.
    const optionalDisclosures: Record<string, string[]> = {
      general: ["Build details"],
      providers: [
        "#setting-antigravity-account",
        ".provider-cli-more",
        "#setting-acp-registry > details",
      ],
    };
    await expect
      .poll(async () =>
        form.locator("details > summary").evaluateAll((summaries) =>
          summaries
            .map((summary) => {
              const details = summary.parentElement!;
              // Identify only these setup disclosures; their counts and subtitles can vary.
              const providerSetup = [
                "#setting-antigravity-account",
                ".provider-cli-more",
                "#setting-acp-registry > details",
              ].find((selector) => details.matches(selector));
              return providerSetup ?? summary.textContent!.trim();
            })
            .sort(),
        ),
      )
      .toEqual((optionalDisclosures[section] ?? []).slice().sort());
    if (section === "connections") {
      const recovery = form.locator('[data-setting-id="remote-auto-reconnect"]');
      await expect(
        recovery.getByRole("switch", {
          name: "Automatically reconnect to remote machines",
          exact: true,
        }),
      ).toBeVisible();
      await recovery.getByRole("button", { name: "Help", exact: true }).click();
      await expect(
        page.getByText("You can still reconnect manually when this is off.", {
          exact: false,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      // Manual URL setup shares the inline Add machine form instead of a separate disclosure.
      // The empty list repeats this action; both buttons open the same inline form.
      await form.getByRole("button", { name: "Add machine", exact: true }).first().click();
      const machineForm = form.getByRole("form", { name: "Add a new machine", exact: true });
      const hostUrl = machineForm.getByRole("radio", { name: "Host URL", exact: true });
      await hostUrl.focus();
      await hostUrl.press("Space");
      await expect(hostUrl).toBeChecked();
      await expect(
        machineForm.getByRole("textbox", { name: "Host URL", exact: true }),
      ).toBeVisible();
      await expect(machineForm.getByLabel("Device token", { exact: true })).toBeVisible();
      await machineForm.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(machineForm).toHaveCount(0);
    }
    if (section === "general") {
      const buildDetails = form.getByTestId("build-identity-details");
      await buildDetails.locator("summary").click();
      await expect(
        buildDetails.getByRole("button", { name: "Copy build details", exact: true }),
      ).toBeVisible();
      await expect(buildDetails).toContainText("Source comparison");
    }
    expect(await form.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
});

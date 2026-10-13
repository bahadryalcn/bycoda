import { test, expect } from "@playwright/test";

async function seedWorkflow(page: import("@playwright/test").Page) {
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() => {
    const fixture = window as unknown as {
      socialFixtureSeed: () => void;
      socialFixtureWorkflow: () => void;
    };
    fixture.socialFixtureSeed();
    fixture.socialFixtureWorkflow();
  });
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
}

test("bounded pages search archived rows and preserve selected detail history", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() => {
    const fixture = window as unknown as {
      socialFixtureSeed: () => void;
      socialFixtureLargeHistory: () => void;
    };
    fixture.socialFixtureSeed();
    fixture.socialFixtureLargeHistory();
  });
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Sosyal Medya bölümleri" });
  await nav.getByRole("button", { name: "Gelen Kutusu", exact: true }).click();
  await expect(page.locator(".social-row:visible")).toHaveCount(50);
  const pages = page.getByRole("group", { name: "Konuşmalar sayfaları", exact: true });
  await pages.getByRole("button", { name: "Sonraki sayfa", exact: true }).click();
  await expect(pages).toContainText("51–100 / 125");
  await page.getByLabel("Konuşma ara", { exact: true }).fill("Archived message needle");
  await page.clock.fastForward(250);
  await expect(page.locator(".social-row:visible")).toHaveCount(1);
  await page.locator(".social-row:visible").click();
  await expect(page.locator(".social-conversation:visible .social-message")).toHaveCount(20);
  await expect(page.locator(".social-conversation:visible")).toContainText(
    "Archived message needle 74",
  );
  const history = page.getByRole("navigation", { name: "Konuşma geçmişi sayfaları", exact: true });
  await history.getByRole("button", { name: "Önceki kayıtlar", exact: true }).click();
  await expect(history).toContainText("36–55 / 75");
  await expect(page.locator(".social-conversation:visible")).toContainText(
    "Archived message needle 35",
  );
  await nav.getByRole("button", { name: "Hedef Kitle", exact: true }).click();
  await expect(page.locator(".social-row:visible")).toHaveCount(50);
  await page.getByLabel("Kişi veya etiket ara", { exact: true }).fill("Archived contact needle");
  await page.clock.fastForward(250);
  await expect(page.locator(".social-row:visible")).toHaveCount(1);
  await page.locator(".social-row:visible").click();
  const contactHistory = page.getByRole("navigation", {
    name: "Kişi etkileşim geçmişi sayfaları",
    exact: true,
  });
  await expect(contactHistory).toContainText("56–75 / 75");
  await contactHistory.getByRole("button", { name: "Önceki kayıtlar", exact: true }).click();
  await expect(contactHistory).toContainText("36–55 / 75");
  await nav.getByRole("button", { name: "Hesaplar", exact: true }).click();
  await page.getByRole("button", { name: "İşlem geçmişini aç", exact: true }).click();
  await expect(page.locator(".social-history-record:visible")).toHaveCount(50);
  await page.getByRole("combobox", { name: "Gönderim durumu", exact: true }).selectOption("failed");
  await page.clock.fastForward(250);
  await expect(page.locator(".social-history-record:visible")).toHaveCount(1);
  await expect(page.locator(".social-history-record:visible")).toContainText("Archived job needle");
  await page.clock.fastForward(15000);
  const calls = await page.evaluate(() =>
    (
      window as unknown as {
        socialFixtureCalls: {
          args: {
            method?: string;
            params?: {
              action?: string;
              input?: { cursor?: string; filters?: unknown; offsets?: unknown };
            };
          };
        }[];
      }
    ).socialFixtureCalls.filter((call) => call.args.params?.action === "workspace.snapshot"),
  );
  expect(calls[calls.length - 1].args.params?.input?.cursor).toMatch(/^fixture-/);
  expect(
    calls.some(
      (call) =>
        call.args.params?.input?.filters &&
        JSON.stringify(call.args.params.input.filters).includes("Archived message needle"),
    ),
  ).toBe(true);
});

test("history shows distinct outcomes, filters and keeps state after leaving Social", async ({
  page,
}, testInfo) => {
  await seedWorkflow(page);
  await expect(
    page
      .getByRole("navigation", { name: "Sosyal Medya bölümleri" })
      .getByRole("button", { name: "Geçmiş", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "İşlem geçmişini aç", exact: true }).click();
  await expect(page.locator(".social-history-record")).toHaveCount(5);
  const colors = await page
    .locator(".social-history-record .social-status-badge")
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
  expect(new Set(colors).size).toBe(5);
  const hasDecorativeRails = await page
    .locator(".social-history-record, .social-notice")
    .evaluateAll((elements) =>
      elements.some((element) => {
        const style = getComputedStyle(element);
        return (
          style.borderInlineStartWidth !== style.borderInlineEndWidth ||
          style.borderInlineStartColor !== style.borderInlineEndColor
        );
      }),
    );
  expect(hasDecorativeRails).toBe(false);
  await page.getByRole("combobox", { name: "Gönderim durumu", exact: true }).selectOption("failed");
  await expect(page.locator(".social-history-record")).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as { socialFixtureShow: (shown: boolean) => void }).socialFixtureShow(false),
  );
  await expect(page.locator("[data-other-tool]")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { socialFixtureShow: (shown: boolean) => void }).socialFixtureShow(true),
  );
  await expect(
    page.getByRole("heading", { name: "İşlem geçmişi ve kuyruk", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Gönderim durumu", exact: true })).toHaveValue(
    "failed",
  );
  await expect(page.locator(".social-history-record")).toHaveCount(1);
  await expect(page.locator(".social-initial-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "Filtreleri temizle", exact: true }).click();
  const review = page.locator('.social-history-record[data-status="review"]');
  await expect(review.getByText(/aynı içeriği yeniden göndermeyin/)).toBeVisible();
  await expect(review.getByRole("button")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("history-outcomes.png"),
    animations: "disabled",
  });
});

test("owner creates and explicitly activates a daily 2–5 hour publishing plan", async ({
  page,
}, testInfo) => {
  await seedWorkflow(page);
  await page
    .getByRole("navigation", { name: "Sosyal Medya bölümleri" })
    .getByRole("button", { name: "Otomasyonlar", exact: true })
    .click();
  await page
    .locator(".social-composer > summary")
    .filter({ hasText: "Otomatik yayın planı oluştur" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Otomatik yayın planı oluştur", exact: true });
  await dialog.getByLabel("Plan adı", { exact: true }).fill("Günlük ürün yayınları");
  await dialog.getByRole("button", { name: "09:00–18:00 · 2–5 saat arayla", exact: true }).click();
  await dialog.getByLabel("Saat dilimi", { exact: true }).fill("Europe/Istanbul");
  await dialog
    .getByRole("button", { name: "Paylaşılacak kampanyalar · seçtiğiniz sırayla", exact: true })
    .click();
  await page
    .getByRole("dialog", {
      name: "Paylaşılacak kampanyalar · seçtiğiniz sırayla seçimi",
      exact: true,
    })
    .getByRole("option")
    .click();
  await page.getByRole("button", { name: "Bitti", exact: true }).click();
  await expect(dialog.getByText("İçerik havuzu bitince plan durur", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Planı durdurulmuş kaydet", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const activate = page.getByRole("button", { name: "Otomatik yayını etkinleştir", exact: true });
  await expect(activate).toBeDisabled();
  await page.getByLabel(/Bu hesap, saatler ve onaylı içerik havuzuyla otomatik yayın/).check();
  await activate.click();
  await expect(page.getByRole("button", { name: "Planı durdur", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yanıt kuralları", exact: true })).toBeInViewport();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          socialFixtureCalls: {
            args: { params?: { action?: string; input?: Record<string, unknown> } };
          }[];
        }
      ).socialFixtureCalls,
  );
  expect(
    calls.find((call) => call.args.params?.action === "publishing-plans.create")?.args.params?.input
      ?.schedule,
  ).toEqual({
    timeZone: "Europe/Istanbul",
    startTime: "09:00",
    endTime: "18:00",
    minIntervalMinutes: 120,
    maxIntervalMinutes: 300,
  });
  await page.screenshot({
    path: testInfo.outputPath("daily-publishing-plan.png"),
    animations: "disabled",
  });
});

test("group outreach prepares eligible recipients and shows opt-out exclusions without sending", async ({
  page,
}, testInfo) => {
  await seedWorkflow(page);
  await page
    .getByRole("navigation", { name: "Sosyal Medya bölümleri" })
    .getByRole("button", { name: "Hedef Kitle", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Segment", exact: true }).selectOption("group");
  await page.getByRole("button", { name: "Bu grubun tüm kişilerini seç (2)", exact: true }).click();
  await page
    .locator(".social-composer > summary")
    .filter({ hasText: "Seçili kişilere mesaj veya yorum hazırla" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Seçili kişilere mesaj veya yorum hazırla",
    exact: true,
  });
  await dialog.getByLabel("Toplu içerik", { exact: true }).fill("Ürün hakkında kısa bilgi");
  await expect(dialog.getByText("Bu kişi iletişim istemiyor.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Taslak kaydet", exact: true }).click();
  await expect(
    dialog.getByText("1 hazır · 1 atlandı · 0 başarısız", { exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          socialFixtureCalls: {
            args: { params?: { action?: string; input?: Record<string, unknown> } };
          }[];
        }
      ).socialFixtureCalls,
  );
  expect(calls.filter((call) => call.args.params?.action?.endsWith(".send"))).toHaveLength(0);
  expect(calls.filter((call) => call.args.params?.action === "messages.draft")).toHaveLength(1);
  await page.screenshot({
    path: testInfo.outputPath("bulk-group-results.png"),
    animations: "disabled",
  });
  await dialog
    .getByRole("button", {
      name: "Seçili kişilere mesaj veya yorum hazırla formunu kapat",
      exact: true,
    })
    .click();
  await page.getByRole("checkbox", { name: "Demo kişi kişisini seç", exact: true }).uncheck();
  await page
    .locator(".social-composer > summary")
    .filter({ hasText: "Seçili kişilere mesaj veya yorum hazırla" })
    .click();
  await expect(dialog.getByText("Alıcı seçimi değişti.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Yeni seçilenler için hazırla", exact: true }).click();
  await expect(dialog.getByLabel("Toplu içerik", { exact: true })).toHaveValue(
    "Ürün hakkında kısa bilgi",
  );
  await expect(dialog.getByRole("button", { name: "Taslak kaydet", exact: true })).toBeDisabled();
});

test("social layout follows its panel width inside a wide window", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html");
  const view = page.locator("[data-app-social]");
  await expect(view).toBeVisible();
  await expect(page.locator(".social-tabs")).toHaveCSS("flex-direction", "column");
  await view.evaluate((element) => {
    element.style.inlineSize = "520px";
    element.style.maxInlineSize = "520px";
    element.style.flex = "none";
  });
  await expect(page.locator(".social-tabs")).toHaveCSS("display", "grid");
  expect(
    await page
      .locator(".social-tabs")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await expect(page.locator(".social-header")).toHaveCSS("grid-column-start", "1");
});

test("searchable project selections keep unfinished forms compact across sections", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureManyProjects: () => void }).socialFixtureManyProjects(),
  );
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Sosyal Medya bölümleri" });
  await nav.getByRole("button", { name: "Kampanyalar", exact: true }).click();
  const editor = page.getByRole("region", { name: "Yeni kampanya", exact: true });
  await expect(editor).not.toBeVisible();
  const listBounds = await page.locator(".social-columns:visible").first().boundingBox();
  await page.locator(".social-composer > summary").filter({ hasText: "Yeni kampanya" }).click();
  expect((await page.locator(".social-columns:visible").first().boundingBox())!.y).toBe(
    listBounds!.y,
  );
  await expect(editor).toBeVisible();
  expect((await editor.boundingBox())!.width).toBeGreaterThan(800);
  await page.getByLabel("Kampanya adı", { exact: true }).fill("Unfinished campaign");
  await editor.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "İlgili projeler seçimi", exact: true });
  await expect(menu.getByRole("option")).toHaveCount(30);
  await menu.getByRole("combobox").fill("monocode");
  await expect(menu.getByRole("option")).toHaveCount(2);
  await menu.getByRole("option").filter({ hasText: "G:/Projects" }).click();
  await menu.getByRole("combobox").fill("worktrees");
  await menu.getByRole("combobox").press("Enter");
  await expect(menu.getByRole("option")).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("project-multiselect-desktop.png"),
  });
  await menu.getByRole("combobox").press("Escape");
  await expect(editor.getByRole("button", { name: "İlgili projeler", exact: true })).toBeFocused();
  await editor.getByRole("button", { name: "Yeni kampanya formunu kapat", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await nav.getByRole("button", { name: "Hedef Kitle", exact: true }).click();
  await page.locator(".social-composer > summary").filter({ hasText: "Kişi ekle" }).click();
  const contact = page.getByRole("region", { name: "Kişi ekle", exact: true });
  await contact.getByLabel("Ad", { exact: true }).fill("Unfinished contact");
  await contact.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  await page
    .getByRole("dialog", { name: "İlgili projeler seçimi", exact: true })
    .getByRole("combobox")
    .fill("service-26");
  await page
    .getByRole("dialog", { name: "İlgili projeler seçimi", exact: true })
    .getByRole("option")
    .click();
  await page.getByRole("button", { name: "Bitti", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 850 });
  await expect(contact).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await contact.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  const bounds = (await page
    .getByRole("dialog", { name: "İlgili projeler seçimi", exact: true })
    .boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("project-multiselect-mobile.png"),
  });
  await page.getByRole("button", { name: "Bitti", exact: true }).click();
  await contact.getByRole("button", { name: "Kişi ekle formunu kapat", exact: true }).click();
  await nav.getByRole("button", { name: "Kampanyalar", exact: true }).click();
  await page.locator(".social-composer > summary").filter({ hasText: "Yeni kampanya" }).click();
  await expect(page.getByLabel("Kampanya adı", { exact: true })).toHaveValue("Unfinished campaign");
  await expect(editor.locator(".social-selection-tag")).toHaveCount(3);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          socialFixtureCalls: { args: { method?: string; params?: { action?: string } } }[];
        }
      ).socialFixtureCalls,
  );
  expect(
    calls.filter(
      (call) =>
        call.args.method === "social.request" &&
        !["snapshot", "workspace.snapshot", "policy.get"].includes(call.args.params?.action ?? ""),
    ),
  ).toEqual([]);
});

test("social workspace guides OAuth setup and keeps sends disabled", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html");
  await expect(page.locator("[data-app-social]")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const headingBounds = await page.locator(".social-heading h1").boundingBox();
  const filterBounds = await page
    .getByRole("button", { name: "Bu proje", exact: true })
    .boundingBox();
  expect(headingBounds).not.toBeNull();
  expect(filterBounds).not.toBeNull();
  expect(Math.max(headingBounds!.y, filterBounds!.y)).toBeLessThan(
    Math.min(headingBounds!.y + headingBounds!.height, filterBounds!.y + filterBounds!.height),
  );
  await page.getByText("Resmi X API ile bağla", { exact: false }).click();
  await expect(page.getByRole("button", { name: "Tarayıcıda bağla", exact: true })).toBeDisabled();
  await expect(page.getByText("Kurulum gerekli", { exact: true }).last()).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("accounts-desktop.png"),
  });
  await page.getByText("Kurulum için gerekenler", { exact: true }).click();
  await expect(page.getByText("BYCODA_SOCIAL_X_CLIENT_ID", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { socialFixtureConfigure: () => void }).socialFixtureConfigure(),
  );
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tarayıcıda bağla", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Tarayıcıda bağla", exact: true }).click();
  await expect(page.getByText(/Açılan platform sayfasında izin verin/)).toBeVisible();
  await expect(page.locator('.social-connection[role="status"] > strong')).toHaveText(
    "Tarayıcıda izin bekleniyor",
  );
  for (const section of ["Kampanyalar", "Gelen Kutusu", "Hedef Kitle", "Otomasyonlar", "Ayarlar"]) {
    await page
      .getByRole("navigation", { name: "Sosyal Medya bölümleri" })
      .getByRole("button", { name: section, exact: true })
      .click();
    await expect(page.getByRole("heading", { name: section, exact: true }).first()).toBeVisible();
    expect(
      await page
        .locator(".social-main")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`${section}-desktop.png`),
    });
  }
  const mutations = await page.evaluate(() =>
    (
      window as unknown as {
        socialFixtureCalls: {
          args: { method?: string; params?: { action?: string } };
        }[];
      }
    ).socialFixtureCalls.filter(
      (call) =>
        call.args.method === "social.request" &&
        !["snapshot", "workspace.snapshot", "policy.get"].includes(call.args.params?.action ?? ""),
    ),
  );
  expect(mutations).toEqual([]);
  await page.setViewportSize({ width: 480, height: 850 });
  await page.getByRole("navigation").getByRole("button", { name: "Hesaplar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tarayıcıda bağla", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(480);
  const checkbox = page.locator('input[type="checkbox"]').first();
  expect(await checkbox.evaluate((el) => getComputedStyle(el).accentColor)).toBe(
    "rgb(56, 189, 248)",
  );
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("accounts-mobile.png"),
  });
  await page.evaluate(() => document.documentElement.classList.add("theme-light"));
  expect(await checkbox.evaluate((el) => getComputedStyle(el).accentColor)).toBe(
    "rgb(2, 132, 199)",
  );
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("accounts-light.png"),
  });
});

test("all creation forms and verified project information stay readable at desktop and narrow widths", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/social.html");
  const nav = page.getByRole("navigation", { name: "Sosyal Medya bölümleri" });
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [section, title] of [
      ["Hesaplar", "Hesap ekle"],
      ["Hedef Kitle", "Kişi ekle"],
      ["Hedef Kitle", "Segment oluştur"],
      ["Otomasyonlar", "Otomasyon kuralı oluştur"],
    ]) {
      await nav.getByRole("button", { name: section, exact: true }).click();
      if (section === "Otomasyonlar")
        await page.getByRole("button", { name: "Yanıt kuralları", exact: true }).click();
      await page.locator(".social-composer > summary").filter({ hasText: title }).click();
      const editor = page.getByRole("region", { name: title, exact: true });
      await expect(editor).toBeVisible();
      expect(
        await page
          .locator(".social-main")
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${title}-${width}.png`),
      });
      await editor.getByRole("button", { name: `${title} formunu kapat`, exact: true }).click();
    }
    await nav.getByRole("button", { name: "Kampanyalar", exact: true }).click();
    const profile = page.locator(".social-page-secondary > details");
    if (!(await profile.evaluate((element) => (element as HTMLDetailsElement).open)))
      await profile.getByText("Ürün bilgisi ve doğrulanmış duyurular", { exact: true }).click();
    await expect(profile.getByLabel("Ürün adı", { exact: true })).toBeVisible();
    expect(
      await page
        .locator(".social-main")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  }
  const mutations = await page.evaluate(() =>
    (
      window as unknown as {
        socialFixtureCalls: { args: { method?: string; params?: { action?: string } } }[];
      }
    ).socialFixtureCalls.filter(
      (call) =>
        call.args.method === "social.request" &&
        !["snapshot", "workspace.snapshot", "policy.get"].includes(call.args.params?.action ?? ""),
    ),
  );
  expect(mutations).toEqual([]);
});

test("written replies survive navigation and failed saves; review drafts are editable", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureSeed: () => void }).socialFixtureSeed(),
  );
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Sosyal Medya bölümleri" });
  await nav.getByRole("button", { name: "Gelen Kutusu", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "Demo ürün sorusu" }).click();
  await page
    .locator(".social-composer > summary")
    .filter({ hasText: /^Yanıt hazırla$/ })
    .click();
  const reply = page
    .getByRole("dialog", { name: "Yanıt hazırla", exact: true })
    .getByLabel("Yanıt", { exact: true });
  await reply.fill("Kaybolmayan yanıt");
  await expect(page.getByText(/17 karakter/).first()).toBeVisible();
  await page.getByRole("button", { name: "Yanıt hazırla formunu kapat", exact: true }).click();
  await nav.getByRole("button", { name: "Hesaplar", exact: true }).click();
  await nav.getByRole("button", { name: "Gelen Kutusu", exact: true }).click();
  await page
    .locator(".social-composer > summary")
    .filter({ hasText: /^Yanıt hazırla$/ })
    .click();
  await expect(reply).toHaveValue("Kaybolmayan yanıt");
  await page.getByRole("button", { name: "Yanıt hazırla formunu kapat", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "İkinci konuşma" }).click();
  await page
    .locator(".social-composer > summary")
    .filter({ hasText: /^Yanıt hazırla$/ })
    .click();
  await expect(reply).toHaveValue("");
  await page.getByRole("button", { name: "Yanıt hazırla formunu kapat", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "Demo ürün sorusu" }).click();
  await page
    .locator(".social-composer > summary")
    .filter({ hasText: /^Yanıt hazırla$/ })
    .click();
  await expect(reply).toHaveValue("Kaybolmayan yanıt");
  await page.getByRole("button", { name: "Taslak kaydet", exact: true }).click();
  await expect(
    page.getByText("Unexpected social mutation: replies.draft", { exact: false }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "İçeriği düzenle", exact: true }).click();
  await expect(reply).toHaveValue("Kaybolmayan yanıt");
  await page.getByRole("button", { name: "Yanıt hazırla formunu kapat", exact: true }).click();
  await page.getByRole("button", { name: "Düzenle", exact: true }).click();
  await expect(page.getByLabel("Taslak metni", { exact: true })).toHaveValue("Demo yanıt");
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Onayla ve gönderim kuyruğuna ekle",
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("inbox-state.png"),
  });
});

test("populated workspace remains usable at narrow widths and in both themes", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureSeed: () => void }).socialFixtureSeed(),
  );
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    await page.setViewportSize({ width: 320, height: 850 });
    for (const section of [
      "Hesaplar",
      "Kampanyalar",
      "Gelen Kutusu",
      "Hedef Kitle",
      "Otomasyonlar",
      "Ayarlar",
    ]) {
      await page
        .getByRole("navigation", { name: "Sosyal Medya bölümleri" })
        .getByRole("button", { name: section, exact: true })
        .click();
      await expect(page.getByRole("heading", { name: section, exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
      expect(
        await page
          .locator(".social-main")
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${section}-${theme}-320.png`),
      });
    }
  }
});

test("neutral social surfaces keep outcomes readable with larger text and reduced motion", async ({
  page,
}, testInfo) => {
  await seedWorkflow(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "İşlem geçmişini aç", exact: true }).click();
  for (const theme of ["dark", "light"]) {
    await page.evaluate((light) => {
      document.documentElement.classList.toggle("theme-light", light);
      document.documentElement.style.fontSize = "125%";
    }, theme === "light");
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page
          .locator(".social-main")
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await expect(
        page.getByRole("combobox", { name: "Gönderim durumu", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`neutral-history-${theme}-${viewport.width}.png`),
        animations: "disabled",
      });
    }
  }
});

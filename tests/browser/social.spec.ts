import { test, expect, type Locator, type Page } from "@playwright/test";

async function selectSection(page: Page, name: string) {
  const label = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "iu");
  const tab = page
    .getByRole("navigation", { name: "Sosyal Medya bölümleri" })
    .getByRole("button", { name: label });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: /^Sosyal Medya bölümleri:/ }).click();
    await page.getByRole("option", { name: label }).click();
  }
}

// Assertions below use the Turkish catalog, so every test starts in Turkish.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
});

test("a portalled draft locks edits while only its initiating action stays busy and focused", async ({
  page,
}, testInfo) => {
  await seedWorkflow(page);
  await selectSection(page, "Hedef kitle");
  await page.getByRole("button", { name: "Segment oluştur", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Segment oluştur", exact: true });
  const name = dialog.getByRole("textbox", { name: "İsim", exact: true });
  await name.fill("Retained pending group");
  const save = dialog.getByRole("button", { name: "Segment kaydet", exact: true });
  await dialog.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  const project = page.getByRole("option", { name: /Demo project/ });
  if ((await project.getAttribute("aria-selected")) === "true") await project.click();
  await project.click();
  await expect(project).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { socialFixtureHold: (action: string) => void }).socialFixtureHold(
      "segments.create",
    ),
  );
  await save.click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save).toBeFocused();
  await expect(page.locator('button[aria-busy="true"]')).toHaveCount(1);
  await expect(name).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "İlgili projeler", exact: true })).toBeDisabled();
  await save.press("Enter");
  await dialog.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  const requests = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { socialFixtureCalls: { args: { params?: { action?: string } } }[] }
        ).socialFixtureCalls.filter((call) => call.args.params?.action === "segments.create")
          .length,
    );
  expect(await requests()).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("social-local-pending.png") });
  await page.evaluate(() =>
    (window as unknown as { socialFixtureRelease: (reject: boolean) => void }).socialFixtureRelease(
      true,
    ),
  );
  await expect(save).not.toHaveAttribute("aria-busy", "true");
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue("Retained pending group");
  await expect(dialog.getByText("Fixture request rejected.", { exact: false })).toBeVisible();
  await save.click();
  await expect(dialog).not.toBeVisible();
  expect(await requests()).toBe(2);
});

test("X media selection replaces image batches with video and keeps removal explicit", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/social.html?x-media=1");
  const files = page.getByLabel("Resim veya video dosyası", { exact: true });
  await files.setInputFiles([
    {
      name: "one.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    },
    {
      name: "two.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ]);
  await expect(page.getByText("2 görsel host'a yüklendi.", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Eklerin türleri" })).toHaveText("image,image");
  await files.setInputFiles({
    name: "demo.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]),
  });
  await expect(page.getByRole("status", { name: "Eklerin türleri" })).toHaveText("video");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 750 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`x-media-${theme}-${width}.png`) });
    }
  }
  await page.getByRole("button", { name: "Ekleri kaldır", exact: true }).click();
  await expect(page.getByRole("status", { name: "Eklerin türleri" })).toBeEmpty();
});

test("X profile editor applies a field diff and follows one selected account", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
  await page.goto("/tests/browser/social.html?browser-monitor=1");
  await selectSection(page, "Hesaplar");
  await page
    .locator("summary")
    .filter({ hasText: /^Tarayıcı çalışma alanı$/ })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: /^X profili ve takip$/ })
    .click();
  await page.getByRole("button", { name: "Profili oku", exact: true }).click();
  await page.getByLabel("Hakkında", { exact: true }).fill("Reviewed fixture bio");
  await page
    .getByRole("button", { name: "Değişiklikleri X profiline uygula", exact: true })
    .click();
  await expect(
    page.getByText("Profil kaydı yeniden okunarak doğrulandı.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Takip edilecek X kullanıcı adı", { exact: true }).fill("github");
  await page.getByRole("button", { name: "Bu hesabı takip et", exact: true }).click();
  await expect(page.getByText("@github takip edildi.", { exact: true })).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const editor = page
        .locator("details")
        .filter({ has: page.locator(":scope > summary", { hasText: /^X profili ve takip$/ }) });
      expect(
        await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`x-profile-${theme}-${width}.png`) });
    }
  }
});

test("browser monitoring shows partial coverage without claiming all channels are healthy", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
  await page.goto("/tests/browser/social.html?browser-monitor=1");
  await selectSection(page, "Hesaplar");
  const workspace = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: "Tarayıcı çalışma alanı" }) });
  await workspace.locator(":scope > summary").click();
  await expect(workspace.getByText(/Kısmi takip; bazı kanallar okunamadı/)).toBeVisible();
  await expect(workspace.getByText("Son kontrol başarılı", { exact: true })).toHaveCount(0);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`monitoring-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
});

test("browser workspace tracks assisted registration without reporting account connection", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
  await page.goto("/tests/browser/social.html");
  await selectSection(page, "Hesaplar");
  const workspace = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: "Tarayıcı çalışma alanı" }) });
  await workspace.locator(":scope > summary").click();
  await workspace.getByRole("button", { name: /^Tarayıcı işlemi:/ }).click();
  await page.getByRole("option", { name: "Kayıt ol", exact: true }).click();
  await workspace.getByLabel("Bu hesap için ayrı tarayıcı profilini aç").check();
  await workspace.getByRole("button", { name: "Tarayıcıda aç", exact: true }).click();
  await expect(
    workspace.getByText("Kayıt ol: Tarayıcıda kullanıcı işlemi bekleniyor", { exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "Tarayıcıda aç", exact: true }),
  ).toBeDisabled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`browser-workspace-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await workspace.getByRole("button", { name: "İşlemi iptal et", exact: true }).click();
  await expect(workspace.getByText("Kayıt ol: İptal edildi", { exact: true })).toBeVisible();
});

test("TikTok publishing shows current privacy choices and explicit consent without enabling communication", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
  await page.goto("/tests/browser/social.html?tiktok=1");
  await selectSection(page, "Kampanyalar");
  await page.getByRole("button", { name: "Yeni kampanya", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByRole("button", { name: "Sosyal hesaplar", exact: true }).click();
  await page.getByRole("option", { name: /Demo TikTok/ }).click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(
    form.getByText("Hesap: Demo TikTok · En fazla 60 saniye", { exact: true }),
  ).toBeVisible();
  const privacy = form.getByLabel("Görünürlük", { exact: true });
  await expect(privacy).toHaveValue("");
  await expect(form.getByLabel("Yorumlara izin ver", { exact: true })).toBeDisabled();
  await expect(form.getByLabel(/Videoyu önizledim/)).toBeDisabled();
  await form.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.getByRole("button", { name: "Yeni kampanya", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { socialFixtureCalls: { args: { method?: string } }[] }
          ).socialFixtureCalls.filter((call) => call.args.method === "social.tiktok.creator")
            .length,
      ),
    )
    .toBeGreaterThan(1);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`tiktok-publish-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
});

test("new social platforms are searchable and keyboard accessible in both themes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
  await page.goto("/tests/browser/social.html");
  await selectSection(page, "Hesaplar");
  await page.getByRole("button", { name: "Hesap ekle", exact: true }).click();
  const form = page.getByRole("dialog");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const trigger = form.getByRole("button", { name: "Platform", exact: true });
      for (const [name, type] of [
        ["TikTok", "member"],
        ["Snapchat", "public_profile"],
        ["WhatsApp", "business"],
        ["Telegram", "bot"],
      ]) {
        await trigger.click();
        // Search is owned by the shared combobox, including localized placeholder text.
        await page.getByRole("combobox", { name: "Seçeneklerde ara…", exact: true }).fill(name);
        await page.getByRole("option", { name, exact: true }).click();
        await expect(form.locator('select[name="type"]')).toHaveValue(type);
        await expect(trigger).toContainText(name);
      }
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("option", { name: "Telegram", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`new-platforms-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
});

test("scope menus and scheduling help remain readable and keyboard dismissible", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
  await page.goto("/tests/browser/social.html");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const trigger = page.locator(".social-project-filter button");
    await trigger.click();
    const menu = page.getByRole("dialog").filter({ has: page.getByRole("listbox") });
    await expect
      .poll(async () => (await menu.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(238);
    const bounds = await menu.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(238);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(menu.getByRole("option", { name: "Tüm projeler", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: "Zamanlama hazır", exact: true }).click();
    const help = page.getByRole("dialog", { name: "Zamanlama durumu", exact: true });
    await expect(help).toContainText("Bilgisayar çevrimdışıyken işler bekler");
    expect(await help.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(help).not.toBeVisible();
  }
});

async function openFilters(page: Page, scope: Locator) {
  const panel = page.getByRole("dialog", { name: "Filtreler", exact: true });
  if (!(await panel.isVisible()))
    await scope.getByRole("button", { name: /^Filtreler(?: ·|$)/ }).click();
  await expect(panel).toBeVisible();
  return panel;
}

async function closeFilters(page: Page) {
  const panel = page.getByRole("dialog", { name: "Filtreler", exact: true });
  await panel.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(panel).not.toBeVisible();
}

for (const width of [390, 1440])
  test(`AI campaign form retains model selections and fits viewport ${width}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tests/browser/social.html?programs=1");
    await selectSection(page, "Kampanyalar");
    await page
      .locator(".social-campaign-modes")
      .getByRole("button", { name: "AI kampanyaları", exact: true })
      .click();
    const modesBounds = await page.locator(".social-campaign-modes").boundingBox();
    const programsBounds = await page.locator(".social-programs:visible").boundingBox();
    expect(programsBounds!.y).toBeGreaterThanOrEqual(modesBounds!.y + modesBounds!.height);
    const editor = page.getByRole("region", { name: "AI kampanyası oluştur", exact: true });
    await expect(editor).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const form = editor.locator(".social-program-form");
    const steps = form.getByRole("navigation", { name: "AI kampanyası oluştur", exact: true });
    await expect(
      steps.getByRole("button", { name: "Amaç ve içerik", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    await form.getByLabel("Kampanya adı", { exact: true }).fill("Fixture campaign");
    await form.locator("summary").filter({ hasText: "AI modelleri ve medya" }).click();
    await form.getByLabel("Metin sağlayıcısı", { exact: true }).selectOption("codex");
    await form.getByLabel("Metin modeli", { exact: true }).fill("text-fixture");
    await form.getByLabel("Medya kaynağı", { exact: true }).selectOption("generate");
    await form.getByLabel("Görsel sağlayıcısı", { exact: true }).selectOption("gemini");
    await form.getByLabel("Görsel modeli", { exact: true }).fill("image-fixture");
    await steps.getByRole("button", { name: "Yayın takvimi", exact: true }).click();
    await expect(form.getByLabel("Metin modeli", { exact: true })).not.toBeVisible();
    await form
      .getByRole("group", { name: "Takvim modu", exact: true })
      .getByText("Paylaşım sıklığı", { exact: true })
      .click();
    await expect(form.getByLabel("Dönem başına paylaşım", { exact: true })).toBeVisible();
    await expect(form.getByLabel("Metin modeli", { exact: true })).toHaveValue("text-fixture");
    await expect(form.getByLabel("Görsel modeli", { exact: true })).toHaveValue("image-fixture");
    await steps.getByRole("button", { name: "Onay ve sınırlar", exact: true }).click();
    await expect(
      form
        .getByRole("group", { name: "Onay modu", exact: true })
        .getByRole("radio", { name: "Yarı onaylı: ilk örnek ve plan", exact: true }),
    ).toBeChecked();
    expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`social-programs-${width}.png`),
      animations: "disabled",
    });
    await selectSection(page, "Hesaplar");
    await expect(editor).not.toBeVisible();
    await selectSection(page, "Kampanyalar");
    await expect(editor).toBeVisible();
    await steps.getByRole("button", { name: "Amaç ve içerik", exact: true }).click();
    await expect(form.getByLabel("Kampanya adı", { exact: true })).toHaveValue("Fixture campaign");
    await expect(form.getByLabel("Metin modeli", { exact: true })).toBeVisible();
    await expect(form.getByLabel("Metin modeli", { exact: true })).toHaveValue("text-fixture");
    await expect(form.getByLabel("Görsel modeli", { exact: true })).toHaveValue("image-fixture");
    await steps.getByRole("button", { name: "Yayın takvimi", exact: true }).click();
    await expect(form.getByLabel("Dönem başına paylaşım", { exact: true })).toBeVisible();
  });

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

test("editing a contact keeps one disabled account payload in native FormData", async ({
  page,
}) => {
  await seedWorkflow(page);
  await selectSection(page, "Hedef kitle");
  await page.locator(".social-row:visible").first().click();
  await page.getByText("Kişi bilgilerini ve izinlerini düzenle", { exact: true }).click();
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Kişiyi güncelle", exact: true }) });
  await expect(form).toBeVisible();
  const account = form.locator('select[name="account"]');
  await expect(account).toBeDisabled();
  await expect(form.getByRole("button", { name: /^Hesap:/ })).toBeDisabled();
  expect(
    await form.evaluate((element) => new FormData(element as HTMLFormElement).getAll("account")),
  ).toEqual(["x"]);
  await expect(form.getByRole("textbox", { name: /^Platform kimliği/ })).toHaveAttribute(
    "readonly",
    "",
  );
});

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
  await selectSection(page, "Gelen kutusu");
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
  await selectSection(page, "Hedef kitle");
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
  await selectSection(page, "Hesaplar");
  await page
    .locator(".social-header-actions")
    .getByRole("button", { name: "Diğer işlemler", exact: true })
    .click();
  await page.getByRole("button", { name: "İşlem geçmişi", exact: true }).click();
  await expect(page.locator(".social-history-record:visible")).toHaveCount(50);
  const filters = await openFilters(page, page.locator(".social-job-list:visible"));
  await filters
    .getByRole("combobox", { name: "Gönderim durumu", exact: true })
    .selectOption("failed");
  await closeFilters(page);
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
  await page
    .locator(".social-header-actions")
    .getByRole("button", { name: "Diğer işlemler", exact: true })
    .click();
  await page.getByRole("button", { name: "İşlem geçmişi", exact: true }).click();
  await expect(page.locator(".social-history-record")).toHaveCount(5);
  const metadata = page
    .locator(".social-history-record")
    .first()
    .locator(".social-history-metadata");
  await expect(metadata.getByText(/^Oluşturuldu/)).not.toBeVisible();
  await metadata.locator("summary").click();
  await expect(metadata.getByText(/^Oluşturuldu/)).toBeVisible();
  await metadata.locator("summary").click();
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
  const filters = await openFilters(page, page.locator(".social-job-list:visible"));
  await filters
    .getByRole("combobox", { name: "Gönderim durumu", exact: true })
    .selectOption("failed");
  await closeFilters(page);
  await expect(page.locator(".social-history-record")).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as { socialFixtureShow: (shown: boolean) => void }).socialFixtureShow(false),
  );
  await expect(page.locator("[data-other-tool]")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { socialFixtureShow: (shown: boolean) => void }).socialFixtureShow(true),
  );
  await expect(page.getByRole("heading", { name: "Gönderim geçmişi", exact: true })).toBeVisible();
  await openFilters(page, page.locator(".social-job-list:visible"));
  await expect(
    page
      .getByRole("dialog", { name: "Filtreler", exact: true })
      .getByRole("combobox", { name: "Gönderim durumu", exact: true }),
  ).toHaveValue("failed");
  await closeFilters(page);
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
  await selectSection(page, "Otomasyonlar");
  const editor = page.getByRole("region", { name: "Otomatik yayın planı oluştur", exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await editor.getByLabel("Plan adı", { exact: true }).fill("Günlük ürün yayınları");
  await editor.getByRole("button", { name: "09:00–18:00 · 2–5 saat arayla", exact: true }).click();
  await editor.getByLabel("Saat dilimi", { exact: true }).fill("Europe/Istanbul");
  await editor
    .getByRole("button", { name: "Paylaşılacak kampanyalar · seçtiğiniz sırayla", exact: true })
    .click();
  await page
    .getByRole("dialog", {
      name: "Paylaşılacak kampanyalar · seçtiğiniz sırayla seçimi",
      exact: true,
    })
    .getByRole("option")
    .click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(editor.getByText(/Her kampanya bir kez paylaşılır/)).toBeVisible();
  await editor.getByRole("button", { name: "Planı durdurulmuş kaydet", exact: true }).click();
  await expect(editor).not.toBeVisible();
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
  await selectSection(page, "Hedef kitle");
  const filters = await openFilters(page, page.locator(".social-list-tools:visible"));
  await filters.getByRole("button", { name: /^Segment:/ }).click();
  await page.locator('[role="option"][data-value="group"]').click();
  await closeFilters(page);
  await page.getByRole("button", { name: "Bu grubun tüm kişilerini seç (2)", exact: true }).click();
  await page
    .getByRole("button", { name: "Seçili kişilere mesaj veya yorum hazırla", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Seçili kişilere mesaj veya yorum hazırla",
    exact: true,
  });
  await dialog.getByLabel("İçerik", { exact: true }).fill("Ürün hakkında kısa bilgi");
  await expect(dialog.getByText("Bu kişi iletişim istemiyor.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Taslağı kaydet", exact: true }).click();
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
      name: "Kapat",
      exact: true,
    })
    .click();
  await page.getByRole("checkbox", { name: "Demo kişi kişisini seç", exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Seçili kişilere mesaj veya yorum hazırla", exact: true })
    .click();
  await expect(dialog.getByText("Alıcı seçimi değişti.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Yeni seçilenler için hazırla", exact: true }).click();
  await expect(dialog.getByLabel("İçerik", { exact: true })).toHaveValue(
    "Ürün hakkında kısa bilgi",
  );
  await expect(dialog.getByRole("button", { name: "Taslağı kaydet", exact: true })).toBeDisabled();
});

test("social layout follows its panel width inside a wide window", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html");
  const view = page.locator("[data-app-social]");
  await expect(view).toBeVisible();
  const navigation = page.locator(".social-tabs");
  const main = page.locator(".social-main");
  await expect(navigation).toHaveCSS("flex-direction", "row");
  const navigationBounds = (await navigation.boundingBox())!;
  const mainBounds = (await main.boundingBox())!;
  expect(navigationBounds.y + navigationBounds.height).toBeLessThanOrEqual(mainBounds.y);
  expect(Math.abs(mainBounds.x - navigationBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(mainBounds.width - navigationBounds.width)).toBeLessThanOrEqual(1);
  await expect(page.locator(".social-header")).toHaveCSS("grid-column-start", "1");
  await expect(main).toHaveCSS("grid-column-start", "1");
  await view.evaluate((element) => {
    element.style.inlineSize = "520px";
    element.style.maxInlineSize = "520px";
    element.style.flex = "none";
  });
  await expect(navigation).toHaveCSS("display", "grid");
  expect(await navigation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  for (const tab of await navigation.getByRole("button").all()) {
    await tab.focus();
    await expect(tab).toBeInViewport();
    expect(
      await tab
        .locator(".social-nav-label")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
  const narrowNavigationBounds = (await navigation.boundingBox())!;
  const narrowMainBounds = (await main.boundingBox())!;
  expect(narrowNavigationBounds.y + narrowNavigationBounds.height).toBeLessThanOrEqual(
    narrowMainBounds.y,
  );
  expect(Math.abs(narrowMainBounds.x - narrowNavigationBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(narrowMainBounds.width - narrowNavigationBounds.width)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".social-header")).toHaveCSS("grid-column-start", "1");
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 768]) {
      await view.evaluate((element, width) => {
        element.style.inlineSize = `${width}px`;
        element.style.maxInlineSize = `${width}px`;
      }, width);
      const visibleNavigation = width < 448 ? page.locator(".social-section-picker") : navigation;
      await expect(visibleNavigation).toBeVisible();
      const bounds = (await visibleNavigation.boundingBox())!;
      for (const tab of await visibleNavigation.getByRole("button").all()) {
        const tabBounds = (await tab.boundingBox())!;
        expect(tabBounds.x).toBeGreaterThanOrEqual(bounds.x);
        expect(tabBounds.x + tabBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
        await tab.focus();
        await expect(tab).toBeFocused();
      }
      await page.screenshot({
        path: testInfo.outputPath(`social-navigation-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
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
  await selectSection(page, "Kampanyalar");
  const editor = page.getByRole("dialog", { name: "Yeni kampanya", exact: true });
  await expect(editor).not.toBeVisible();
  const listBounds = await page.locator(".social-columns:visible").first().boundingBox();
  await page.getByRole("button", { name: "Yeni kampanya", exact: true }).click();
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
  await editor.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await selectSection(page, "Hedef kitle");
  await page.getByRole("button", { name: "Kişi ekle", exact: true }).click();
  const contact = page.getByRole("dialog", { name: "Kişi ekle", exact: true });
  await contact.getByLabel("İsim", { exact: true }).fill("Unfinished contact");
  await contact.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  await page
    .getByRole("dialog", { name: "İlgili projeler seçimi", exact: true })
    .getByRole("combobox")
    .fill("service-26");
  await page
    .getByRole("dialog", { name: "İlgili projeler seçimi", exact: true })
    .getByRole("option")
    .click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
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
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await contact.getByRole("button", { name: "Kapat", exact: true }).click();
  await selectSection(page, "Kampanyalar");
  await page.getByRole("button", { name: "Yeni kampanya", exact: true }).click();
  await expect(page.getByLabel("Kampanya adı", { exact: true })).toHaveValue("Unfinished campaign");
  await expect(
    editor.locator(
      '.bycoda-selection-values[aria-label="İlgili projeler: seçilenler"] .bycoda-selection-value',
    ),
  ).toHaveCount(3);
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
  const accountWorkspace = page.locator('.social-account-workspace[data-single="true"]');
  await expect(accountWorkspace).toBeVisible();
  await expect(accountWorkspace.locator(":scope > section").first()).not.toBeVisible();
  const workspaceBounds = (await accountWorkspace.boundingBox())!;
  const detailBounds = (await accountWorkspace.locator(".social-account-detail").boundingBox())!;
  expect(Math.abs(workspaceBounds.x - detailBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(workspaceBounds.width - detailBounds.width)).toBeLessThanOrEqual(2);
  const projectAccess = accountWorkspace.locator(".social-account-permissions");
  await expect(projectAccess.locator("summary")).toHaveText("Proje erişimi");
  await expect(projectAccess).toHaveAttribute("open", "");
  await expect(
    projectAccess.getByRole("button", { name: "İzinleri kaydet", exact: true }),
  ).toBeVisible();
  const headingBounds = await page.locator(".social-header-field").first().boundingBox();
  const filterBounds = await page.locator(".social-project-filter").boundingBox();
  expect(headingBounds).not.toBeNull();
  expect(filterBounds).not.toBeNull();
  expect(Math.max(headingBounds!.y, filterBounds!.y)).toBeLessThan(
    Math.min(headingBounds!.y + headingBounds!.height, filterBounds!.y + filterBounds!.height),
  );
  await page
    .locator(".social-header-actions")
    .getByRole("button", { name: "Diğer işlemler", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Bu proje", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
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
  await expect(
    page.getByText(/Açılan platform sayfasında hesabınıza giriş yapıp izin verin/),
  ).toBeVisible();
  await expect(page.locator('.social-connection[role="status"] > strong')).toHaveText(
    "Tarayıcıda izin bekleniyor",
  );
  for (const section of ["Kampanyalar", "Gelen kutusu", "Hedef kitle", "Otomasyonlar", "Ayarlar"]) {
    await selectSection(page, section);
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
  await selectSection(page, "Hesaplar");
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
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [section, title] of [
      ["Hesaplar", "Hesap ekle"],
      ["Hedef kitle", "Kişi ekle"],
      ["Hedef kitle", "Segment oluştur"],
      ["Otomasyonlar", "Otomasyon kuralı oluştur"],
      ["Otomasyonlar", "Otomatik yayın planı oluştur"],
    ]) {
      await selectSection(page, section);
      const inlinePlan = title === "Otomatik yayın planı oluştur";
      if (section === "Otomasyonlar")
        await page
          .getByRole("button", {
            name: inlinePlan ? "Paylaşım planları" : "Yanıt kuralları",
            exact: true,
          })
          .click();
      if (!inlinePlan) await page.getByRole("button", { name: title, exact: true }).click();
      const editor = page.getByRole(inlinePlan ? "region" : "dialog", { name: title, exact: true });
      if (inlinePlan) {
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(editor.getByLabel("Plan adı", { exact: true })).toBeVisible();
        await expect(editor.getByLabel("Saat dilimi", { exact: true })).toBeVisible();
      }
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
      if (!inlinePlan) await editor.getByRole("button", { name: "Kapat", exact: true }).click();
    }
    await selectSection(page, "Kampanyalar");
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
  await selectSection(page, "Gelen kutusu");
  await page.getByRole("button").filter({ hasText: "Demo ürün sorusu" }).click();
  await page.getByRole("button", { name: /^Yanıt hazırla$/, exact: true }).click();
  const reply = page
    .getByRole("dialog", { name: "Yanıt hazırla", exact: true })
    .getByLabel("Yanıt", { exact: true });
  await reply.fill("Kaybolmayan yanıt");
  await expect(page.getByText(/17 karakter/).first()).toBeVisible();
  await page
    .getByRole("dialog", { name: "Yanıt hazırla", exact: true })
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  await selectSection(page, "Hesaplar");
  await selectSection(page, "Gelen kutusu");
  await page.getByRole("button", { name: /^Yanıt hazırla$/, exact: true }).click();
  await expect(reply).toHaveValue("Kaybolmayan yanıt");
  await page
    .getByRole("dialog", { name: "Yanıt hazırla", exact: true })
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  await page.getByRole("button").filter({ hasText: "İkinci konuşma" }).click();
  await page.getByRole("button", { name: /^Yanıt hazırla$/, exact: true }).click();
  await expect(reply).toHaveValue("");
  await page
    .getByRole("dialog", { name: "Yanıt hazırla", exact: true })
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  await page.getByRole("button").filter({ hasText: "Demo ürün sorusu" }).click();
  await page.getByRole("button", { name: /^Yanıt hazırla$/, exact: true }).click();
  await expect(reply).toHaveValue("Kaybolmayan yanıt");
  await page.getByRole("button", { name: "Taslağı kaydet", exact: true }).click();
  await expect(
    page.getByText("Unexpected social mutation: replies.draft", { exact: false }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "İçeriği düzenle", exact: true }).click();
  await expect(reply).toHaveValue("Kaybolmayan yanıt");
  await page
    .getByRole("dialog", { name: "Yanıt hazırla", exact: true })
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  await page.getByRole("button", { name: "Düzenle", exact: true }).click();
  await expect(page.getByLabel("Taslak metni", { exact: true })).toHaveValue("Demo yanıt");
  await page.getByRole("button", { name: "Düzenlemeyi iptal et", exact: true }).click();
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
      "Gelen kutusu",
      "Hedef kitle",
      "Otomasyonlar",
      "Ayarlar",
    ]) {
      await selectSection(page, section);
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
  await page
    .locator(".social-header-actions")
    .getByRole("button", { name: "Diğer işlemler", exact: true })
    .click();
  await page.getByRole("button", { name: "İşlem geçmişi", exact: true }).click();
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
      const filters = await openFilters(page, page.locator(".social-job-list:visible"));
      await expect(
        filters.getByRole("combobox", { name: "Gönderim durumu", exact: true }),
      ).toBeVisible();
      const bounds = (await filters.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      await closeFilters(page);
      await page.screenshot({
        path: testInfo.outputPath(`neutral-history-${theme}-${viewport.width}.png`),
        animations: "disabled",
      });
    }
  }
});

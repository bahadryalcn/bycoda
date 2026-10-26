import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { SocialSnapshot } from "../../src/features/social/model/social";
import type { SocialBrowserWorkflow } from "../../src/features/social/model/socialBrowser";

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

test("LinkedIn Page branding uploads only the selected logo and clears staged edits on account change", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html?linkedin-profile=1");
  await selectSection(page, "Hesaplar");
  await page.getByRole("button").filter({ hasText: "Fixture LinkedIn Page one" }).click();
  const workspace = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^Tarayıcı çalışma alanı$/ }) });
  await workspace.locator(":scope > summary").click();
  const profile = workspace
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^LinkedIn sayfa profili$/ }) });
  await profile.locator(":scope > summary").click();
  await profile.getByRole("button", { name: "Profili oku", exact: true }).click();
  await expect(profile.getByLabel("Profil adı", { exact: true })).toHaveValue(
    "Fixture LinkedIn Page one",
  );
  await expect(profile.locator('input[type="file"]')).toHaveCount(1);
  await expect(profile.getByLabel("Slogan", { exact: true })).toHaveAttribute("maxlength", "120");
  await expect(
    profile.getByRole("button", { name: "Bu hesabı takip et", exact: true }),
  ).toHaveCount(0);
  const calls = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          socialFixtureCalls: { args: { method?: string; params?: Record<string, unknown> } }[];
        }
      ).socialFixtureCalls.map((c) => c.args),
    );
  const writes = async () =>
    (await calls()).filter((c) => c.method === "social.browser.profile.update");
  await profile.locator('input[type="file"]').setInputFiles(browserImage);
  await expect(
    profile.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toBeVisible();
  expect(await writes()).toHaveLength(0);
  await profile.getByLabel("Slogan", { exact: true }).fill("Reviewed open-source Page");
  await completionCaptures(
    page,
    profile,
    profile.getByRole("button", { name: "Değişiklikleri LinkedIn sayfasına uygula", exact: true }),
    "linkedin-profile-logo-ready",
    testInfo,
  );
  await profile
    .getByRole("button", { name: "Değişiklikleri LinkedIn sayfasına uygula", exact: true })
    .click();
  await expect(
    profile.getByText("Profil kaydı yeniden okunarak doğrulandı.", { exact: true }),
  ).toBeVisible();
  expect(await writes()).toEqual([
    {
      machineId: "fixture",
      method: "social.browser.profile.update",
      params: {
        accountId: "linkedin-page-one",
        patch: { avatarUploadId: "fixture-image-1", bio: "Reviewed open-source Page" },
        confirm: "UPDATE_LINKEDIN_PROFILE",
      },
    },
  ]);
  await profile.locator('input[type="file"]').setInputFiles(browserImage);
  await expect(
    profile.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toBeVisible();
  await page.getByRole("button").filter({ hasText: "Fixture LinkedIn Page two" }).click();
  if (!(await workspace.evaluate((el) => (el as HTMLDetailsElement).open)))
    await workspace.locator(":scope > summary").click();
  const secondProfile = workspace
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^LinkedIn sayfa profili$/ }) });
  await secondProfile.locator(":scope > summary").click();
  await expect(
    secondProfile.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toHaveCount(0);
  await secondProfile.getByRole("button", { name: "Profili oku", exact: true }).click();
  await expect(secondProfile.getByLabel("Profil adı", { exact: true })).toHaveValue(
    "Fixture LinkedIn Page two",
  );
  await expect(secondProfile.getByLabel("Slogan", { exact: true })).toHaveValue(
    "Fixture Page tagline",
  );
  await expect(
    secondProfile.getByRole("button", {
      name: "Değişiklikleri LinkedIn sayfasına uygula",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await writes()).toHaveLength(1);
  const state = await browserFixtureState(page);
  expect(state.sendingEnabled).toBe(false);
  expect(state.jobs).toHaveLength(0);
});

test("Facebook Page branding applies one owner logo only after review and resets across Page accounts", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html?facebook-profile=1");
  await selectSection(page, "Hesaplar");
  await page.getByRole("button").filter({ hasText: "Fixture Facebook Page one" }).click();
  const workspace = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^Tarayıcı çalışma alanı$/ }) });
  await workspace.locator(":scope > summary").click();
  const profile = workspace.locator("details").filter({
    has: page.locator(":scope > summary", { hasText: /^Facebook sayfa profil resmi$/ }),
  });
  await profile.locator(":scope > summary").click();
  await profile.getByRole("button", { name: "Profili oku", exact: true }).click();
  await expect(profile.locator('input[type="file"]')).toHaveCount(1);
  await expect(profile.locator('input[type="text"],textarea,input[type="url"]')).toHaveCount(0);
  await expect(
    profile.getByRole("button", { name: "Bu hesabı takip et", exact: true }),
  ).toHaveCount(0);
  const writes = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          socialFixtureCalls: { args: { method?: string; params?: Record<string, unknown> } }[];
        }
      ).socialFixtureCalls
        .map((c) => c.args)
        .filter((c) => c.method === "social.browser.profile.update"),
    );
  const apply = profile.getByRole("button", {
    name: "Görseli Facebook sayfasına uygula",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await profile.locator('input[type="file"]').setInputFiles(browserImage);
  await expect(
    profile.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toBeVisible();
  expect(await writes()).toHaveLength(0);
  await completionCaptures(page, profile, apply, "facebook-profile-logo-ready", testInfo);
  await apply.click();
  await expect(
    profile.getByText("Profil kaydı yeniden okunarak doğrulandı.", { exact: true }),
  ).toBeVisible();
  expect(await writes()).toEqual([
    {
      machineId: "fixture",
      method: "social.browser.profile.update",
      params: {
        accountId: "facebook-page-one",
        patch: { avatarUploadId: "fixture-image-1" },
        confirm: "UPDATE_FACEBOOK_PROFILE",
      },
    },
  ]);
  await profile.locator('input[type="file"]').setInputFiles(browserImage);
  await expect(
    profile.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toBeVisible();
  await page.getByRole("button").filter({ hasText: "Fixture Facebook Page two" }).click();
  if (!(await workspace.evaluate((el) => (el as HTMLDetailsElement).open)))
    await workspace.locator(":scope > summary").click();
  const second = workspace.locator("details").filter({
    has: page.locator(":scope > summary", { hasText: /^Facebook sayfa profil resmi$/ }),
  });
  await second.locator(":scope > summary").click();
  await expect(
    second.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toHaveCount(0);
  await second.getByRole("button", { name: "Profili oku", exact: true }).click();
  await expect(
    second.getByRole("button", { name: "Görseli Facebook sayfasına uygula", exact: true }),
  ).toBeDisabled();
  expect(await writes()).toHaveLength(1);
  const state = await browserFixtureState(page);
  expect(state.sendingEnabled).toBe(false);
  expect(state.jobs).toHaveLength(0);
});

test("Instagram profile keeps reviewed bio and logo scoped to one selected account", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html?instagram-profile=1");
  await selectSection(page, "Hesaplar");
  await page.getByRole("button").filter({ hasText: "Fixture Instagram one" }).click();
  const workspace = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^Tarayıcı çalışma alanı$/ }) });
  await workspace.locator(":scope > summary").click();
  const profile = workspace
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^Instagram profili$/ }) });
  await profile.locator(":scope > summary").click();
  await profile.getByRole("button", { name: "Profili oku", exact: true }).click();
  await expect(profile.locator('input[type="file"]')).toHaveCount(1);
  await expect(profile.locator('input[type="text"],input[type="url"]')).toHaveCount(0);
  await expect(profile.getByLabel("Hakkında", { exact: true })).toHaveAttribute("maxlength", "150");
  await expect(
    profile.getByRole("button", { name: "Bu hesabı takip et", exact: true }),
  ).toHaveCount(0);
  const writes = () =>
    page.evaluate(() =>
      (
        window as unknown as { socialFixtureCalls: { args: { method?: string } }[] }
      ).socialFixtureCalls
        .map((c) => c.args)
        .filter((c) => c.method === "social.browser.profile.update"),
    );
  await profile.getByLabel("Hakkında", { exact: true }).fill("Reviewed Instagram bio");
  await profile.locator('input[type="file"]').setInputFiles(browserImage);
  await expect(
    profile.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toBeVisible();
  expect(await writes()).toHaveLength(0);
  const apply = profile.getByRole("button", {
    name: "Değişiklikleri Instagram profiline uygula",
    exact: true,
  });
  await completionCaptures(page, profile, apply, "instagram-profile-ready", testInfo);
  await apply.click();
  await expect(
    profile.getByText("Profil kaydı yeniden okunarak doğrulandı.", { exact: true }),
  ).toBeVisible();
  expect(await writes()).toEqual([
    {
      machineId: "fixture",
      method: "social.browser.profile.update",
      params: {
        accountId: "instagram-one",
        patch: { avatarUploadId: "fixture-image-1", bio: "Reviewed Instagram bio" },
        confirm: "UPDATE_INSTAGRAM_PROFILE",
      },
    },
  ]);
  await profile.locator('input[type="file"]').setInputFiles(browserImage);
  await expect(
    profile.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toBeVisible();
  await page.getByRole("button").filter({ hasText: "Fixture Instagram two" }).click();
  if (!(await workspace.evaluate((el) => (el as HTMLDetailsElement).open)))
    await workspace.locator(":scope > summary").click();
  const second = workspace
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^Instagram profili$/ }) });
  await second.locator(":scope > summary").click();
  await expect(
    second.getByRole("button", { name: "Seçilen görseli kaldır", exact: true }),
  ).toHaveCount(0);
  await second.getByRole("button", { name: "Profili oku", exact: true }).click();
  await expect(second.getByLabel("Hakkında", { exact: true })).toHaveValue("Fixture Instagram bio");
  await expect(
    second.getByRole("button", { name: "Değişiklikleri Instagram profiline uygula", exact: true }),
  ).toBeDisabled();
  expect(await writes()).toHaveLength(1);
  expect((await browserFixtureState(page)).jobs).toHaveLength(0);
});

test("LinkedIn final Page creation reviews observed terms and holds uncertain submission without retry", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html?linkedin-final-review=1");
  await selectSection(page, "Hesaplar");
  const workspace = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^Tarayıcı çalışma alanı$/ }) });
  await workspace.locator(":scope > summary").click();
  const review = workspace.getByRole("button", {
    name: "Sayfa oluşturma işlemini incele",
    exact: true,
  });
  const writes = () =>
    page.evaluate(() =>
      (
        window as unknown as { socialFixtureCalls: { args: { method?: string } }[] }
      ).socialFixtureCalls
        .map((c) => c.args)
        .filter((c) => c.method === "social.browser.registration.submit"),
    );
  expect(await writes()).toHaveLength(0);
  await review.click();
  await expect(
    workspace.getByText("Yönetici: Fixture Administrator (web:linkedin:in:fixture-admin)", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(workspace.getByText("Software Development", { exact: true })).toBeVisible();
  await expect(workspace.getByText("0–1 employees", { exact: true })).toBeVisible();
  await expect(
    workspace.getByRole("link", { name: "LinkedIn Sayfa Koşulları", exact: true }),
  ).toHaveAttribute("href", "https://www.linkedin.com/legal/l/page-terms");
  const create = workspace.getByRole("button", { name: "Create observed Page", exact: true });
  const consent = workspace.getByLabel(
    "Bu sayfayı oluşturma yetkim var ve gösterilen LinkedIn Sayfa Koşullarını kabul ediyorum.",
    { exact: true },
  );
  await expect(create).toBeDisabled();
  await consent.check();
  await expect(create).toBeEnabled();
  await page.evaluate(() =>
    (
      window as unknown as { socialFixtureChangeFinalRegistration(): void }
    ).socialFixtureChangeFinalRegistration(),
  );
  await workspace.getByRole("button", { name: "Durumu yenile", exact: true }).click();
  await expect(create).toHaveCount(0);
  expect(await writes()).toHaveLength(0);
  await review.click();
  await expect(consent).not.toBeChecked();
  await expect(create).toBeDisabled();
  await completionCaptures(page, workspace, create, "linkedin-final-review", testInfo);
  await consent.check();
  await create.click();
  await expect(
    workspace.getByText(
      "Sayfa oluşturma denemesinin sonucu belirsiz. Aynı tarayıcı penceresini kontrol edin; otomatik tekrar gönderim durduruldu.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(create).toHaveCount(0);
  await expect(review).toHaveCount(0);
  expect(await writes()).toEqual([
    {
      machineId: "fixture",
      method: "social.browser.registration.submit",
      params: {
        accountId: "linkedin-final",
        workflowId: "fixture-final-workflow",
        expectedUpdatedAt: 3,
        reviewId: "review-3",
        confirm: "CREATE_LINKEDIN_PAGE",
      },
    },
  ]);
  await workspace.getByRole("button", { name: "Durumu yenile", exact: true }).click();
  expect(await writes()).toHaveLength(1);
  expect((await browserFixtureState(page)).accounts[0].connected).toBe(false);
  const resource = workspace.getByLabel("Mevcut LinkedIn sayfa kimliği", { exact: true });
  const verify = workspace.getByRole("button", { name: "Mevcut sayfayı doğrula", exact: true });
  await expect(verify).toBeDisabled();
  await resource.fill("987");
  await verify.click();
  await expect(workspace.getByRole("alert")).toBeVisible();
  await expect(create).toHaveCount(0);
  await resource.fill("145372363");
  await completionCaptures(page, workspace, verify, "linkedin-existing-page-recovery", testInfo);
  await verify.click();
  await expect(
    workspace.getByRole("link", { name: "Oluşturulan sayfayı aç", exact: true }),
  ).toHaveAttribute("href", "https://www.linkedin.com/company/145372363/");
  await expect(verify).toHaveCount(0);
  await expect(create).toHaveCount(0);
  expect(await writes()).toHaveLength(1);
  const reconciliation = await page.evaluate(() =>
    (
      window as unknown as {
        socialFixtureCalls: { args: { method?: string; params?: Record<string, unknown> } }[];
      }
    ).socialFixtureCalls
      .map((call) => call.args)
      .filter((call) => call.method === "social.browser.registration.reconcile"),
  );
  expect(reconciliation).toEqual(
    ["987", "145372363"].map((resourceId) => ({
      machineId: "fixture",
      method: "social.browser.registration.reconcile",
      params: {
        accountId: "linkedin-final",
        workflowId: "fixture-final-workflow",
        expectedUpdatedAt: 4,
        resourceId,
      },
    })),
  );
  expect((await browserFixtureState(page)).accounts[0].connected).toBe(false);
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

test("registration automation resumes one window and keeps owner profile values out of workflow metadata", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() =>
    (
      window as unknown as { socialFixtureSeedRegistration(): void }
    ).socialFixtureSeedRegistration(),
  );
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  await selectSection(page, "Hesaplar");
  await page.getByRole("button").filter({ hasText: "Fixture registration TikTok" }).click();
  const workspace = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: "Tarayıcı çalışma alanı" }) });
  await workspace.locator(":scope > summary").click();
  await workspace.getByRole("button", { name: /^Tarayıcı işlemi:/ }).click();
  await page.getByRole("option", { name: "Kayıt ol", exact: true }).click();
  await expect(
    workspace.getByLabel("Desteklenen kayıt adımlarını otomatik yürüt", { exact: true }),
  ).toBeChecked();
  await expect(workspace.getByRole("radio", { name: "Marka", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(workspace.locator('input[type="password"]')).toHaveCount(0);
  const email = workspace.getByLabel("Kayıt e-posta adresi", { exact: true });
  await email.fill("fixture-registration@example.test");
  await completionCaptures(
    page,
    workspace,
    workspace.getByRole("group", { name: "Kayıt bilgileri", exact: true }),
    "registration-owner-fields",
    testInfo,
  );
  await workspace.getByLabel("Bu hesap için ayrı tarayıcı profilini aç", { exact: true }).check();
  const begin = workspace.getByRole("button", { name: "Tarayıcıda aç", exact: true });
  await begin.click();
  const readWorkflows = () =>
    page.evaluate(() =>
      (
        window as unknown as { socialFixtureWorkflowState(): SocialBrowserWorkflow[] }
      ).socialFixtureWorkflowState(),
    );
  await expect.poll(async () => (await readWorkflows()).length).toBe(1);
  const initial = (await readWorkflows())[0];
  expect(initial.registration).toMatchObject({
    status: "needs_fields",
    requiredFields: ["birthdate"],
    filledFields: ["email"],
  });
  await expect(begin).toBeDisabled();
  const advance = workspace.getByRole("button", {
    name: "Kayıt otomasyonuna devam et",
    exact: true,
  });
  await expect(advance).toBeVisible();
  const progressMessage = workspace.getByRole("status").locator("p").first();
  const initialMessage = await progressMessage.textContent();
  await workspace.getByLabel("Gerçek doğum tarihi", { exact: true }).fill("1990-02-03");
  await advance.click();
  await expect
    .poll(async () => (await readWorkflows())[0].updatedAt)
    .toBeGreaterThan(initial.updatedAt);
  const resumed = (await readWorkflows())[0];
  expect(resumed.id).toBe(initial.id);
  expect(resumed.registration).toMatchObject({
    status: "awaiting_owner",
    step: "verification",
    blockers: ["verification"],
    filledFields: ["email", "birthdate"],
    requiredFields: [],
  });
  expect(resumed.outcome).toBe("unverified");
  expect((await readWorkflows()).length).toBe(1);
  expect(JSON.stringify(resumed)).not.toContain("fixture-registration@example.test");
  expect(JSON.stringify(resumed)).not.toContain("1990-02-03");
  expect(resumed.registration).not.toHaveProperty("email");
  expect(resumed.registration).not.toHaveProperty("birthdate");
  await expect(begin).toBeDisabled();
  await expect(progressMessage).not.toHaveText(initialMessage ?? "");
  await completionCaptures(
    page,
    workspace,
    workspace.getByRole("status"),
    "registration-awaiting-verification",
    testInfo,
  );
  expect(
    (await browserFixtureState(page)).accounts.find(
      (account) => account.id === "registration-tiktok",
    )?.connected,
  ).toBe(false);
  await page.getByRole("button").filter({ hasText: "Fixture already connected LinkedIn" }).click();
  if (
    !(await workspace
      .locator(":scope > summary")
      .evaluate((el) => (el.parentElement as HTMLDetailsElement).open))
  )
    await workspace.locator(":scope > summary").click();
  await workspace.getByRole("button", { name: /^Tarayıcı işlemi:/ }).click();
  await page.getByRole("option", { name: "Kayıt ol", exact: true }).click();
  await expect(workspace.getByLabel("Kayıt e-posta adresi", { exact: true })).toHaveValue("");
  await workspace.getByLabel("Bu hesap için ayrı tarayıcı profilini aç", { exact: true }).check();
  await expect(
    workspace.getByRole("button", { name: "Tarayıcıda aç", exact: true }),
  ).toBeDisabled();
  await expect(
    workspace.getByText(
      "Bu hesap zaten bağlı. Yeniden kayıt yerine mevcut bağlantısını kullanın.",
      { exact: true },
    ),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (
      window as unknown as {
        socialFixtureCalls: { args: { method?: string; params?: Record<string, unknown> } }[];
      }
    ).socialFixtureCalls.map((call) => call.args),
  );
  const starts = calls.filter((call) => call.method === "social.browser.workflow.begin");
  const advances = calls.filter((call) => call.method === "social.browser.registration.advance");
  expect(starts).toHaveLength(1);
  expect(advances).toHaveLength(1);
  expect(starts[0].params).toMatchObject({
    accountId: "registration-tiktok",
    intent: "signup",
    registration: { accountKind: "brand", email: "fixture-registration@example.test" },
  });
  expect(advances[0].params).toEqual({
    accountId: "registration-tiktok",
    workflowId: initial.id,
    expectedUpdatedAt: initial.updatedAt,
    registration: {
      accountKind: "brand",
      email: "fixture-registration@example.test",
      birthdate: "1990-02-03",
    },
  });
  expect((await browserFixtureState(page)).jobs).toHaveLength(0);
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
  await form.getByRole("radio", { name: "API bağlantısı", exact: true }).click();
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

async function browserFixtureState(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { socialFixtureState(): SocialSnapshot }).socialFixtureState(),
  );
}

const browserImage = {
  name: "owner-image.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8zUAAAAASUVORK5CYII=",
    "base64",
  ),
};

async function completionCampaign(
  page: Page,
  account: string,
  name: string,
  seed: "completion" | "api" = "completion",
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html");
  await page.evaluate((mode) => {
    const fixture = window as unknown as {
      socialFixtureSeedMediaCompletion(): void;
      socialFixtureSeedApiMedia(): void;
    };
    if (mode === "api") fixture.socialFixtureSeedApiMedia();
    else fixture.socialFixtureSeedMediaCompletion();
  }, seed);
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  await selectSection(page, "Kampanyalar");
  await page.getByRole("button", { name: "Yeni kampanya", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Yeni kampanya", exact: true });
  await form.getByLabel("Kampanya adı", { exact: true }).fill(name);
  await form.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  const project = page.getByRole("option", { name: /Demo project/ });
  if ((await project.getAttribute("aria-selected")) !== "true") await project.click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await form.getByRole("button", { name: "Sosyal hesaplar", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(account) }).click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await form.getByLabel("Bu hesaba özel içerik", { exact: true }).fill("Reviewed media caption");
  return form;
}

async function completionCaptures(
  page: Page,
  form: Locator,
  target: Locator,
  name: string,
  testInfo: TestInfo,
) {
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await target.scrollIntoViewIfNeeded();
      expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function completionReview(page: Page) {
  await page.getByRole("button", { name: "Hesap ve içeriği kontrol et", exact: true }).click();
  const approve = page.getByRole("button", { name: "Yayın onayı ver", exact: true });
  await expect(approve).toBeDisabled();
  await page
    .getByLabel("Bu kampanyanın tüm hesap içeriklerini okudum ve yayınlanmasını onaylıyorum.", {
      exact: true,
    })
    .check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole("button", { name: "İçerik onaylı", exact: true })).toBeDisabled();
}

async function completionAssertNoSend(page: Page, revisions: number[]) {
  const state = await browserFixtureState(page);
  expect(state.jobs).toHaveLength(0);
  expect(state.sendingEnabled).toBe(false);
  const actions = await page.evaluate(() =>
    (
      window as unknown as {
        socialFixtureCalls: {
          args: { params?: { action?: string; input?: Record<string, unknown> } };
        }[];
      }
    ).socialFixtureCalls
      .map((call) => call.args.params)
      .filter(Boolean),
  );
  expect(
    actions.some(
      (item) => item?.action?.endsWith(".send") || item?.action === "campaigns.schedule",
    ),
  ).toBe(false);
  expect(
    actions
      .filter((item) => item?.action === "campaigns.approveReviewed")
      .map((item) => item?.input?.expectedRevision),
  ).toEqual(revisions);
}

test("Meta API ordered carousel becomes a reviewed Reel only after renewing approval", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const form = await completionCampaign(
    page,
    "Fixture Instagram API",
    "Meta carousel then Reel",
    "api",
  );
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await form.getByRole("button", { name: "Görsel adresi ekle", exact: true }).click();
  await form.getByLabel("Görsel adresi 1", { exact: true }).fill("https://cdn.test/first.jpg");
  await form
    .getByLabel("Görsel alternatif metni", { exact: true })
    .fill("First reviewed carousel image");
  await form.getByRole("button", { name: "Video adresi ekle", exact: true }).click();
  await form
    .getByLabel("Video adresi 2", { exact: true })
    .fill("https://cdn.test/carousel-clip.mp4");
  await form.getByRole("button", { name: "Görsel adresi ekle", exact: true }).click();
  await form.getByLabel("Görsel adresi 3", { exact: true }).fill("https://cdn.test/last.jpg");
  await form
    .getByLabel("Görsel alternatif metni", { exact: true })
    .nth(1)
    .fill("Last reviewed carousel image");
  await expect(
    form.getByText("Bu video Reels olarak yayımlanacak ve akışta görünecek.", { exact: true }),
  ).toHaveCount(0);
  await completionCaptures(
    page,
    form,
    form.getByLabel("Video adresi 2", { exact: true }),
    "goal-meta-carousel",
    testInfo,
  );
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  let campaign = (await browserFixtureState(page)).campaigns[0];
  expect(campaign.variants[0].media).toEqual([
    { kind: "image", url: "https://cdn.test/first.jpg", alt: "First reviewed carousel image" },
    { kind: "video", url: "https://cdn.test/carousel-clip.mp4" },
    { kind: "image", url: "https://cdn.test/last.jpg", alt: "Last reviewed carousel image" },
  ]);
  const preview = page.locator(".social-preview");
  const mediaRows = preview.locator("p").filter({ hasText: /cdn\.test/ });
  await expect(mediaRows).toHaveCount(3);
  await expect(mediaRows.nth(0)).toContainText("first.jpg");
  await expect(mediaRows.nth(1)).toContainText("carousel-clip.mp4");
  await expect(mediaRows.nth(2)).toContainText("last.jpg");
  await completionReview(page);
  await page.getByRole("button", { name: "Taslağı düzenle", exact: true }).click();
  const editing = page.getByRole("dialog", { name: "Kampanya taslağını düzenle", exact: true });
  await editing
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await editing.getByRole("button", { name: "Medyayı kaldır 3", exact: true }).click();
  await editing.getByRole("button", { name: "Medyayı kaldır 1", exact: true }).click();
  const reel = editing.getByLabel("Video adresi 1", { exact: true });
  await reel.fill("https://cdn.test/reviewed-reel.mp4");
  const placement = editing.getByText("Bu video Reels olarak yayımlanacak ve akışta görünecek.", {
    exact: true,
  });
  await expect(placement).toBeVisible();
  await completionCaptures(page, editing, placement, "goal-meta-reel-editor", testInfo);
  await editing.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(editing).not.toBeVisible();
  campaign = (await browserFixtureState(page)).campaigns[0];
  expect(campaign.revision).toBe(2);
  expect(campaign.variants[0].media).toEqual([
    { kind: "video", url: "https://cdn.test/reviewed-reel.mp4" },
  ]);
  expect((await browserFixtureState(page)).approvedCampaignIds).not.toContain(campaign.id);
  const reviewedPlacement = preview.getByText(
    "Bu video Reels olarak yayımlanacak ve akışta görünecek.",
    { exact: true },
  );
  await expect(reviewedPlacement).toBeVisible();
  await expect(preview).not.toContainText("First reviewed carousel image");
  await completionCaptures(page, preview, reviewedPlacement, "goal-meta-reel-review", testInfo);
  await completionReview(page);
  await completionAssertNoSend(page, [1, 2]);
});

test("Facebook API feed reviews ordered images and alternative text separately from Reels", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const form = await completionCampaign(
    page,
    "Fixture Facebook API",
    "Facebook multiple images",
    "api",
  );
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await expect(form.getByRole("button", { name: "Video adresi ekle", exact: true })).toHaveCount(0);
  for (let index = 1; index <= 2; index++) {
    await form.getByRole("button", { name: "Görsel adresi ekle", exact: true }).click();
    await form
      .getByLabel(`Görsel adresi ${index}`, { exact: true })
      .fill(`https://cdn.test/facebook-${index}.jpg`);
    await form
      .getByLabel("Görsel alternatif metni", { exact: true })
      .nth(index - 1)
      .fill(`Facebook reviewed description ${index}`);
  }
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  const saved = (await browserFixtureState(page)).campaigns[0];
  expect(saved.variants[0].media).toEqual(
    [1, 2].map((index) => ({
      kind: "image",
      url: `https://cdn.test/facebook-${index}.jpg`,
      alt: `Facebook reviewed description ${index}`,
    })),
  );
  const preview = page.locator(".social-preview");
  await expect(preview).toContainText("Facebook reviewed description 1");
  await expect(preview).toContainText("Facebook reviewed description 2");
  await completionCaptures(
    page,
    preview,
    preview.getByText(/facebook-1\.jpg/),
    "goal-facebook-media-review",
    testInfo,
  );
  await completionReview(page);
  await completionAssertNoSend(page, [1]);
});

test("Facebook API Reel requires an explicit destination and real uploaded metadata before draft review", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const form = await completionCampaign(
    page,
    "Fixture Facebook API",
    "Explicit Facebook Reel",
    "api",
  );
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await form.getByRole("button", { name: "Görsel adresi ekle", exact: true }).click();
  await form
    .getByLabel("Görsel adresi 1", { exact: true })
    .fill("https://cdn.test/old-feed-image.jpg");
  await form.getByRole("radio", { name: "Reel", exact: true }).click();
  await expect(form.getByLabel("Görsel adresi 1", { exact: true })).toHaveCount(0);
  const upload = form.getByLabel("Video dosyası", { exact: true });
  const fps = form.getByLabel("Video kare hızı (fps)", { exact: true });
  await expect(fps).toHaveValue("");
  await expect(fps).toHaveAttribute("required", "");
  const save = form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true });
  await expect(save).toBeDisabled();
  const file = {
    name: "fixture-reel-30fps.mp4",
    mimeType: "video/mp4",
    buffer: completionReelVideo,
  };
  await upload.setInputFiles(file);
  await expect(form.locator("video")).toHaveJSProperty("duration", 6);
  await expect(form.locator("video")).toHaveJSProperty("videoWidth", 540);
  await expect(form.locator("video")).toHaveJSProperty("videoHeight", 960);
  await expect(fps).toHaveValue("");
  await fps.fill("22");
  await expect(save).toBeDisabled();
  await fps.fill("30");
  await expect(save).toBeEnabled();
  await form.getByRole("radio", { name: "Sayfa akışı", exact: true }).click();
  await expect(upload).toHaveCount(0);
  await expect(fps).toHaveCount(0);
  await expect(form.getByText("1 video hosta yüklendi.", { exact: true })).toHaveCount(0);
  await form.getByRole("radio", { name: "Reel", exact: true }).click();
  await expect(fps).toHaveValue("");
  await expect(form.locator("video")).toHaveCount(0);
  await upload.setInputFiles(file);
  await expect(form.locator("video")).toHaveJSProperty("duration", 6);
  await fps.fill("30");
  await form.getByLabel("Bu hesaba özel içerik", { exact: true }).fill("");
  await expect(form.getByLabel("Bu hesaba özel içerik", { exact: true })).not.toHaveAttribute(
    "required",
    "",
  );
  await expect(save).toBeEnabled();
  await completionCaptures(page, form, fps, "goal-facebook-reel-editor", testInfo);
  await save.click();
  await expect(form).not.toBeVisible();
  const state = await browserFixtureState(page);
  expect(state.campaigns).toHaveLength(1);
  expect(state.campaigns[0].variants[0]).toMatchObject({
    text: "",
    media: [{ kind: "video", uploadId: "fixture-video-2" }],
    facebook: { target: "reel", durationSeconds: 6, width: 540, height: 960, frameRate: 30 },
  });
  const preview = page.locator(".social-preview");
  const target = preview.getByText("Facebook hedefi: Reel · 6s · 540 × 960 · 30 fps", {
    exact: true,
  });
  await expect(target).toBeVisible();
  await completionCaptures(page, preview, target, "goal-facebook-reel-review", testInfo);
  await page.getByRole("button", { name: "Hesap ve içeriği kontrol et", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yayın onayı ver", exact: true })).toBeDisabled();
  const finalState = await browserFixtureState(page);
  expect(finalState.approvedCampaignIds).toEqual([]);
  expect(finalState.jobs).toHaveLength(0);
  expect(finalState.sendingEnabled).toBe(false);
  const actions = await page.evaluate(() =>
    (
      window as unknown as { socialFixtureCalls: { args: { params?: { action?: string } } }[] }
    ).socialFixtureCalls.map((call) => call.args.params?.action),
  );
  expect(actions.some((action) => /approve|schedule|\.send$/.test(action ?? ""))).toBe(false);
});

test("LinkedIn API organization images use owner uploads and preserve ordered alternative text", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const form = await completionCampaign(page, "Fixture LinkedIn API", "LinkedIn API images", "api");
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  const files = form.getByLabel("Görseller", { exact: true });
  expect((await files.getAttribute("accept"))?.split(",").sort()).toEqual([
    "image/jpeg",
    "image/png",
  ]);
  await expect(form.locator('input[type="file"]')).toHaveCount(1);
  await expect(form.getByText(/tweet eki olarak|MP4: 64 MiB/)).toHaveCount(0);
  await expect(form.getByLabel("HTTPS görsel URL", { exact: true })).toHaveCount(0);
  await files.setInputFiles([browserImage, { ...browserImage, name: "second.png" }]);
  const firstAlt = form.getByLabel("Görsel alternatif metni 1", { exact: true });
  const lastAlt = form.getByLabel("Görsel alternatif metni 2", { exact: true });
  await expect(firstAlt).toBeVisible();
  await expect(lastAlt).toBeVisible();
  await firstAlt.fill("LinkedIn first image");
  await lastAlt.fill("LinkedIn second image");
  await completionCaptures(page, form, lastAlt, "goal-linkedin-api-images", testInfo);
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  const media = (await browserFixtureState(page)).campaigns[0].variants[0].media;
  expect(media).toEqual([
    { kind: "image", uploadId: "fixture-image-1", alt: "LinkedIn first image" },
    { kind: "image", uploadId: "fixture-image-2", alt: "LinkedIn second image" },
  ]);
  await expect(page.locator(".social-preview")).toContainText("LinkedIn first image");
  await expect(page.locator(".social-preview")).toContainText("LinkedIn second image");
  await completionReview(page);
  await completionAssertNoSend(page, [1]);
});

for (const platform of ["whatsapp", "telegram"] as const) {
  test(`${platform} API attachment-only draft edits clear approval and never send`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    await page.goto("/tests/browser/social.html");
    await page.evaluate(() =>
      (window as unknown as { socialFixtureSeedApiMedia(): void }).socialFixtureSeedApiMedia(),
    );
    await page.getByRole("button", { name: "Yenile", exact: true }).click();
    await selectSection(page, "Gelen kutusu");
    await page
      .getByRole("button")
      .filter({ hasText: `${platform} API media question` })
      .click();
    await page.getByRole("button", { name: "Düzenle", exact: true }).click();
    const text = page.getByLabel("Taslak metni", { exact: true });
    await text.fill("");
    const files = page.getByLabel("Resim veya video dosyası", { exact: true });
    await files.setInputFiles(browserImage);
    await expect(page.getByText(/tweet eki olarak/)).toHaveCount(0);
    await expect(
      page.getByText("Dosyalar seçili host'a yüklenir ve tarayıcı üzerinden eklenir.", {
        exact: true,
      }),
    ).toHaveCount(0);
    const editing = text.locator("xpath=ancestor::form");
    await completionCaptures(page, editing, files, `goal-${platform}-api-media`, testInfo);
    const save = page.getByRole("button", { name: "Değişiklikleri kaydet", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(text).not.toBeVisible();
    const state = await browserFixtureState(page);
    const saved = state.drafts.find((draft) => draft.accountId === platform)!;
    expect(saved.text).toBe("");
    expect(saved.media).toEqual([{ kind: "image", uploadId: "fixture-image-1" }]);
    expect(saved.approvedAt).toBeUndefined();
    await completionAssertNoSend(page, []);
  });
}

test("uploaded campaign review shows exact owner image bytes and retries preview locally before approval", async ({
  page,
}, testInfo) => {
  const form = await completionCampaign(
    page,
    "Fixture LinkedIn API",
    "Actual uploaded image review",
    "api",
  );
  const imageBytes = await readFile(
    new URL("../../public/brand/bycoda/icon-512.png", import.meta.url),
  );
  await form
    .locator("summary")
    .filter({ hasText: "Tek seferlik yayın zamanı, medya ve bağlantı" })
    .click();
  await form
    .getByLabel("Görseller", { exact: true })
    .setInputFiles({ name: "official-bycoda-logo.png", mimeType: "image/png", buffer: imageBytes });
  await form.getByLabel("Görsel alternatif metni 1", { exact: true }).fill("Bycoda official logo");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureHold(action: string): void }).socialFixtureHold(
      "programs.media-preview",
    ),
  );
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  const preview = page.locator(".social-preview");
  await expect(preview.getByText("Görsel önizlemesi yükleniyor…", { exact: true })).toBeVisible();
  expect((await browserFixtureState(page)).approvedCampaignIds).toEqual([]);
  await page.evaluate(() =>
    (window as unknown as { socialFixtureRelease(reject: boolean): void }).socialFixtureRelease(
      true,
    ),
  );
  await expect(preview.getByText("Görsel önizlemesi yüklenemedi.", { exact: true })).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(0);
  await preview.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  const image = preview.getByRole("img", { name: "Bycoda official logo", exact: true });
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (element, expected) => element.getAttribute("src") === expected,
      `data:image/png;base64,${imageBytes.toString("base64")}`,
    ),
  ).toBe(true);
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(512);
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalHeight))
    .toBe(512);
  await completionCaptures(page, preview, image, "owner-uploaded-image-review", testInfo);
  const calls = await page.evaluate(() =>
    (
      window as unknown as {
        socialFixtureCalls: {
          args: {
            params?: { action?: string; input?: Record<string, unknown>; requestId?: string };
          };
        }[];
      }
    ).socialFixtureCalls.map((call) => call.args.params),
  );
  const reads = calls.filter((call) => call?.action === "programs.media-preview");
  expect(reads).toHaveLength(2);
  for (const call of reads) {
    expect(call?.input).toEqual({ uploadId: "fixture-image-1" });
    expect(call).not.toHaveProperty("requestId");
  }
  expect(
    calls.some((call) =>
      ["campaigns.approve", "campaigns.schedule", "jobs.retry"].includes(call?.action ?? ""),
    ),
  ).toBe(false);
  const state = await browserFixtureState(page);
  expect(state.approvedCampaignIds).toEqual([]);
  expect(state.jobs).toHaveLength(0);
  expect(state.sendingEnabled).toBe(false);
});

test("Telegram channel connects one reviewed bot and queues a media-only campaign only after explicit approval", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html?telegram-channel=1");
  await selectSection(page, "Hesaplar");
  const target = page.getByLabel("Telegram kanal kimliği veya herkese açık kullanıcı adı", {
    exact: true,
  });
  await target.fill("@bycodaofficial");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "İncelenen kanalı bağla", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Kanalı ve botu incele", exact: true }).click();
  await expect(
    page.getByText("Fixture Bycoda announcements (-1001234567890)", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture Bycoda publisher (123456789)", { exact: false }),
  ).toBeVisible();
  expect((await browserFixtureState(page)).accounts[0].connected).toBe(false);
  const reviewedConnect = page.getByRole("button", { name: "İncelenen kanalı bağla", exact: true });
  const channelReview = reviewedConnect.locator("xpath=..");
  await completionCaptures(
    page,
    channelReview,
    reviewedConnect,
    "telegram-channel-owner-review",
    testInfo,
  );
  await reviewedConnect.click();
  await expect.poll(async () => (await browserFixtureState(page)).accounts[0].connected).toBe(true);
  const connected = (await browserFixtureState(page)).accounts[0];
  expect(connected).toMatchObject({
    platform: "telegram",
    accountType: "channel",
    connection: "token",
    platformId: "-1001234567890",
    telegramBotId: "123456789",
    scopes: ["channel.publish"],
  });
  const tokenCalls = await page.evaluate(() =>
    (
      window as unknown as { socialFixtureCalls: { args: { method?: string; params?: unknown } }[] }
    ).socialFixtureCalls
      .map((c) => c.args)
      .filter((c) => c.method?.startsWith("social.token.")),
  );
  expect(tokenCalls).toEqual([
    {
      machineId: "fixture",
      method: "social.token.inspect",
      params: { accountId: "telegram-channel", target: "@bycodaofficial" },
    },
    {
      machineId: "fixture",
      method: "social.token.connect",
      params: { accountId: "telegram-channel", reviewId: "fixture-channel-review-1" },
    },
  ]);
  await selectSection(page, "Kampanyalar");
  await page.getByRole("button", { name: "Yeni kampanya", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Yeni kampanya", exact: true });
  await form.getByLabel("Kampanya adı", { exact: true }).fill("Reviewed channel image");
  await form.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  const project = page.getByRole("option", { name: /Demo project/ });
  if ((await project.getAttribute("aria-selected")) !== "true") await project.click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await form.getByRole("button", { name: "Sosyal hesaplar", exact: true }).click();
  await page.getByRole("option", { name: /Fixture Bycoda announcements/ }).click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  const media = form.getByLabel("Resim veya video dosyası", { exact: true });
  await expect(media).not.toHaveAttribute("multiple", "");
  await media.setInputFiles(browserImage);
  const caption = form.getByLabel("Bu hesaba özel içerik", { exact: true });
  await expect(caption).toHaveValue("");
  await expect(caption).not.toHaveAttribute("required", "");
  await expect(form.getByText(/0 \/ 1024 karakter/)).toBeVisible();
  expect(await form.locator("form").evaluate((el: HTMLFormElement) => el.checkValidity())).toBe(
    true,
  );
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  const saved = (await browserFixtureState(page)).campaigns[0];
  expect(saved.variants).toEqual([
    expect.objectContaining({
      accountId: "telegram-channel",
      text: "",
      media: [{ kind: "image", uploadId: "fixture-image-1" }],
    }),
  ]);
  expect((await browserFixtureState(page)).jobs).toHaveLength(0);
  const preview = page.locator(".social-preview");
  await expect(preview).toContainText("Görsel: Hosta yüklenen dosya");
  await completionCaptures(
    page,
    preview,
    page.getByRole("button", { name: "Hesap ve içeriği kontrol et", exact: true }),
    "telegram-channel-caption-review",
    testInfo,
  );
  await expect(page.getByRole("button", { name: "Yayını planla", exact: true })).toBeDisabled();
  await completionReview(page);
  await page.getByRole("button", { name: "Yayını planla", exact: true }).click();
  await expect.poll(async () => (await browserFixtureState(page)).jobs.length).toBe(1);
  const job = (await browserFixtureState(page)).jobs[0];
  expect(job).toMatchObject({
    accountId: "telegram-channel",
    kind: "publish",
    status: "queued",
    attempts: 0,
    payload: { text: "", media: [{ kind: "image", uploadId: "fixture-image-1" }] },
  });
  const actions = await page.evaluate(() =>
    (
      window as unknown as { socialFixtureCalls: { args: { params?: { action?: string } } }[] }
    ).socialFixtureCalls.map((c) => c.args.params?.action),
  );
  expect(actions.filter((a) => a === "campaigns.schedule")).toHaveLength(1);
});

test("Snapchat API requires an explicit locale and retains real Spotlight metadata through renewed review", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const form = await completionCampaign(
    page,
    "Fixture Snapchat API",
    "Snapchat API Spotlight locale",
    "api",
  );
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  const locale = form.getByLabel("Spotlight dili ve bölgesi", { exact: true });
  const upload = form.getByLabel("Video dosyası", { exact: true });
  await expect(locale).toHaveValue("");
  await expect(locale).toHaveAttribute("required", "");
  await expect(upload).toBeDisabled();
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  expect((await browserFixtureState(page)).campaigns).toHaveLength(0);
  await locale.fill("tr");
  await expect(upload).toBeDisabled();
  await locale.fill("tr_TR");
  await expect(upload).toBeEnabled();
  await expect(form.getByRole("button", { name: /Story|Hikâye|Hikaye/i })).toHaveCount(0);
  await upload.setInputFiles({
    name: "spotlight.mp4",
    mimeType: "video/mp4",
    buffer: completionVideo,
  });
  await expect(form.locator("video")).toHaveJSProperty("duration", 6);
  await expect(form.locator("video")).toHaveJSProperty("videoWidth", 540);
  await expect(form.locator("video")).toHaveJSProperty("videoHeight", 960);
  await completionCaptures(page, form, locale, "goal-snapchat-api-editor", testInfo);
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  let campaign = (await browserFixtureState(page)).campaigns[0];
  expect(campaign.variants[0].snapchat).toEqual({
    target: "spotlight",
    locale: "tr_TR",
    durationSeconds: 6,
    width: 540,
    height: 960,
  });
  const preview = page.locator(".social-preview");
  await expect(preview).toContainText("tr_TR");
  await expect(preview).toContainText("Spotlight");
  await completionReview(page);
  await page.getByRole("button", { name: "Taslağı düzenle", exact: true }).click();
  const editing = page.getByRole("dialog", { name: "Kampanya taslağını düzenle", exact: true });
  await editing
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await editing.getByLabel("Spotlight dili ve bölgesi", { exact: true }).fill("en_US");
  await editing.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(editing).not.toBeVisible();
  campaign = (await browserFixtureState(page)).campaigns[0];
  expect(campaign.revision).toBe(2);
  expect(campaign.variants[0].snapchat).toEqual({
    target: "spotlight",
    locale: "en_US",
    durationSeconds: 6,
    width: 540,
    height: 960,
  });
  expect((await browserFixtureState(page)).approvedCampaignIds).not.toContain(campaign.id);
  await expect(preview).toContainText("en_US");
  await expect(preview).not.toContainText("tr_TR");
  await completionCaptures(
    page,
    preview,
    preview.getByText(/en_US/),
    "goal-snapchat-api-review",
    testInfo,
  );
  await completionReview(page);
  await completionAssertNoSend(page, [1, 2]);
});

test("LinkedIn PDF title and single-image alternative text persist through reviewed campaign revisions", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const form = await completionCampaign(page, "Fixture LinkedIn", "LinkedIn document then image");
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  const files = form.getByLabel("Görsel, video veya PDF dosyası", { exact: true });
  await expect(files).toHaveAttribute("accept", /application\/pdf/);
  await files.setInputFiles({
    name: "bycoda-guide.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"),
  });
  const title = form.getByLabel("Belge başlığı", { exact: true });
  await expect(title).toHaveValue("bycoda-guide");
  await title.fill("");
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  expect((await browserFixtureState(page)).campaigns).toHaveLength(0);
  await title.fill("Reviewed Bycoda PDF guide");
  await completionCaptures(page, form, title, "completion-linkedin-pdf", testInfo);
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  let saved = (await browserFixtureState(page)).campaigns[0];
  expect(saved.variants[0].media).toEqual([
    { kind: "document", uploadId: "fixture-document-1", title: "Reviewed Bycoda PDF guide" },
  ]);
  await expect(page.getByText(/PDF belgesi:.*Reviewed Bycoda PDF guide/)).toBeVisible();
  await completionReview(page);
  await page.getByRole("button", { name: "Taslağı düzenle", exact: true }).click();
  const editing = page.getByRole("dialog", { name: "Kampanya taslağını düzenle", exact: true });
  await editing
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await editing
    .getByLabel("Görsel, video veya PDF dosyası", { exact: true })
    .setInputFiles(browserImage);
  await expect(editing.getByLabel("Belge başlığı", { exact: true })).toHaveCount(0);
  const alt = editing.getByLabel("Görsel alternatif metni 1", { exact: true });
  await alt.fill("Bycoda editor showing reviewed workflow");
  await completionCaptures(page, editing, alt, "completion-linkedin-alt", testInfo);
  await editing.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(editing).not.toBeVisible();
  saved = (await browserFixtureState(page)).campaigns[0];
  expect(saved.revision).toBe(2);
  expect(saved.variants[0].media).toEqual([
    { kind: "image", uploadId: "fixture-image-2", alt: "Bycoda editor showing reviewed workflow" },
  ]);
  expect((await browserFixtureState(page)).approvedCampaignIds).not.toContain(saved.id);
  await expect(
    page.getByText(/Görsel alternatif metni: Bycoda editor showing reviewed workflow/),
  ).toBeVisible();
  await completionReview(page);
  await completionAssertNoSend(page, [1, 2]);
});

test("TikTok API photos require successful previews and renewed consent before campaign review", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.route("https://fixture-media.example.test/**", async (route) => {
    if (route.request().url().includes("unavailable"))
      await route.fulfill({ status: 404, body: "No photo" });
    else await route.fulfill({ status: 200, contentType: "image/png", body: completionPhoto });
  });
  const form = await completionCampaign(page, "Fixture TikTok API", "TikTok reviewed photo set");
  await form.getByRole("radio", { name: "Fotoğraflar", exact: true }).click();
  await expect(form.getByRole("radio", { name: "Fotoğraflar", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const consent = form.getByLabel(/^Her fotoğrafı önizledim;/);
  await expect(consent).toBeDisabled();
  await form.getByLabel("Fotoğraf başlığı", { exact: true }).fill("Bycoda photo set");
  await form.getByLabel("Görünürlük", { exact: true }).selectOption("SELF_ONLY");
  await form
    .getByLabel("Fotoğraf 1 HTTPS adresi", { exact: true })
    .fill("https://fixture-media.example.test/one.png");
  await expect(form.getByRole("img", { name: "Fotoğraf 1 önizlemesi", exact: true })).toBeVisible();
  await expect(consent).toBeEnabled();
  await form.getByRole("button", { name: "Fotoğraf ekle", exact: true }).click();
  await form
    .getByLabel("Fotoğraf 2 HTTPS adresi", { exact: true })
    .fill("https://fixture-media.example.test/unavailable.png");
  await expect(
    form.getByText("Fotoğraf önizlemesi yüklenemedi. Adresi kontrol edin.", { exact: true }),
  ).toBeVisible();
  await expect(consent).toBeDisabled();
  await form
    .getByLabel("Fotoğraf 2 HTTPS adresi", { exact: true })
    .fill("https://fixture-media.example.test/two.png");
  await expect(
    form.getByText("Fotoğraf önizlemesi yüklenemedi. Adresi kontrol edin.", { exact: true }),
  ).toHaveCount(0);
  await expect(consent).toBeEnabled();
  await form.getByLabel("Kapak fotoğrafı", { exact: true }).selectOption("1");
  await form.getByLabel("TikTok önerilen müziği eklesin", { exact: true }).check();
  await consent.check();
  await form.getByLabel("Fotoğraf başlığı", { exact: true }).fill("Reviewed Bycoda photo set");
  await expect(consent).not.toBeChecked();
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  expect((await browserFixtureState(page)).campaigns).toHaveLength(0);
  await consent.check();
  await completionCaptures(
    page,
    form,
    form.getByLabel("Fotoğraf başlığı", { exact: true }),
    "completion-tiktok-photos",
    testInfo,
  );
  await completionCaptures(page, form, consent, "completion-tiktok-consent", testInfo);
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  const saved = (await browserFixtureState(page)).campaigns[0].variants[0];
  expect(saved.media).toEqual([
    { kind: "image", url: "https://fixture-media.example.test/one.png" },
    { kind: "image", url: "https://fixture-media.example.test/two.png" },
  ]);
  expect(saved.tiktok).toMatchObject({
    mediaType: "photo",
    photoTitle: "Reviewed Bycoda photo set",
    photoCoverIndex: 1,
    autoAddMusic: true,
    privacy: "SELF_ONLY",
    consent: true,
    allowDuet: false,
    allowStitch: false,
  });
  await expect(
    page.getByText(
      /Fotoğraflar · Görünürlük: SELF_ONLY.*Reviewed Bycoda photo set.*Kapak fotoğrafı: 2/,
    ),
  ).toBeVisible();
  await completionReview(page);
  await completionAssertNoSend(page, [1]);
});

test("Snapchat destination and real video metadata persist while Story rejects captions and links", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const form = await completionCampaign(page, "Fixture Snapchat", "Snapchat Spotlight then Story");
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  const upload = form.getByLabel("Video dosyası", { exact: true });
  await expect(upload).toBeDisabled();
  await form.getByRole("radio", { name: "Spotlight", exact: true }).click();
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({
    name: "fixture-vertical.mp4",
    mimeType: "video/mp4",
    buffer: completionVideo,
  });
  const video = form.locator("video");
  await expect
    .poll(() =>
      video.evaluate((el) => {
        const media = el as HTMLVideoElement;
        return { width: media.videoWidth, height: media.videoHeight, duration: media.duration };
      }),
    )
    .toEqual({ width: 540, height: 960, duration: 6 });
  await completionCaptures(page, form, upload, "completion-snapchat-spotlight", testInfo);
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  let saved = (await browserFixtureState(page)).campaigns[0];
  expect(saved.variants[0].snapchat).toEqual({
    target: "spotlight",
    durationSeconds: 6,
    width: 540,
    height: 960,
  });
  await expect(page.getByText(/Snapchat yayın hedefi: Spotlight · 6s · 540 × 960/)).toBeVisible();
  await completionReview(page);
  await page.getByRole("button", { name: "Taslağı düzenle", exact: true }).click();
  const editing = page.getByRole("dialog", { name: "Kampanya taslağını düzenle", exact: true });
  await editing
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await editing.getByRole("radio", { name: "Herkese açık Hikâye", exact: true }).click();
  await editing.getByLabel("Bağlantı", { exact: true }).fill("https://example.test/retained-link");
  await editing.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  expect((await browserFixtureState(page)).campaigns[0].revision).toBe(1);
  await expect(editing.getByLabel("Bu hesaba özel içerik", { exact: true })).toHaveValue(
    "Reviewed media caption",
  );
  await editing.getByLabel("Bu hesaba özel içerik", { exact: true }).fill("");
  await editing.getByLabel("Bağlantı", { exact: true }).fill("");
  await expect(
    editing.getByText(/Herkese açık Hikâye yüklemelerinde açıklama veya bağlantı bulunmaz/),
  ).toBeVisible();
  await completionCaptures(
    page,
    editing,
    editing.getByRole("radio", { name: "Herkese açık Hikâye", exact: true }),
    "completion-snapchat-story",
    testInfo,
  );
  await editing.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(editing).not.toBeVisible();
  saved = (await browserFixtureState(page)).campaigns[0];
  expect(saved.revision).toBe(2);
  expect(saved.variants[0].snapchat).toEqual({
    target: "story",
    durationSeconds: 6,
    width: 540,
    height: 960,
  });
  expect(saved.variants[0].text).toBe("");
  expect(saved.variants[0].link).toBeUndefined();
  expect((await browserFixtureState(page)).approvedCampaignIds).not.toContain(saved.id);
  await expect(
    page.getByText(/Snapchat yayın hedefi: Herkese açık Hikâye · 6s · 540 × 960.*24 saat/),
  ).toBeVisible();
  await completionCaptures(
    page,
    page.locator(".social-main"),
    page.getByText(/Snapchat yayın hedefi: Herkese açık Hikâye · 6s · 540 × 960.*24 saat/),
    "completion-snapchat-review",
    testInfo,
  );
  await completionReview(page);
  await completionAssertNoSend(page, [1, 2]);
});

test("non-X browser accounts connect without API configuration and preserve platform-specific limitations", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureBrowserMode(): void }).socialFixtureBrowserMode(),
  );
  await selectSection(page, "Hesaplar");
  for (const platform of ["Instagram", "Telegram"] as const) {
    await page.getByRole("button", { name: "Hesap ekle", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Hesap ekle", exact: true });
    await expect(
      form.getByRole("radio", { name: "Tarayıcı bağlantısı", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    const platformTrigger = form.getByRole("button", { name: "Platform", exact: true });
    await platformTrigger.click();
    const search = page.getByRole("combobox", { name: "Seçeneklerde ara…", exact: true });
    await search.fill(platform);
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(platformTrigger).toContainText(platform);
    await expect(form.locator('select[name="type"]')).toHaveValue("member");
    await form.getByLabel("Hesap adı", { exact: true }).fill(`Bycoda ${platform}`);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await platformTrigger.focus();
        await platformTrigger.press("Enter");
        await expect(page.getByRole("option", { name: platform, exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(platformTrigger).toBeFocused();
        expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`browser-account-form-${platform}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await form.getByRole("button", { name: "Hesap ekle", exact: true }).click();
    await expect(form).not.toBeVisible();
    const before = await browserFixtureState(page);
    const account = before.accounts.find((item) => item.name === `Bycoda ${platform}`)!;
    expect(account).toMatchObject({
      connection: "browser",
      accountType: "member",
      connected: false,
    });
    const signIn = page.getByRole("button", { name: "Tarayıcıdan giriş yap", exact: true });
    await expect(signIn).toBeDisabled();
    await page
      .getByLabel("Riski anlıyorum; bu hesap için tarayıcı oturumunu kullan", { exact: true })
      .check();
    await expect(signIn).toBeEnabled();
    await signIn.click();
    expect(
      (await browserFixtureState(page)).accounts.find((item) => item.id === account.id)?.connected,
    ).toBe(false);
    await page.evaluate(
      (id) =>
        (
          window as unknown as { socialFixtureVerifyBrowser(id: string): void }
        ).socialFixtureVerifyBrowser(id),
      account.id,
    );
    await page
      .getByRole("button", { name: "Tarayıcı bağlantısını kontrol et", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await browserFixtureState(page)).accounts.find((item) => item.id === account.id)
            ?.connected,
      )
      .toBe(true);
    const browserSummary = page
      .locator("summary")
      .filter({ hasText: /^Tarayıcı bağlantısını yönet$/ });
    if (!(await browserSummary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open)))
      await browserSummary.click();
    await expect(page.getByText("Hesap bağlandı", { exact: true }).first()).toBeVisible();
    if (platform === "Telegram") {
      const publish = page
        .locator(".social-capability-grid > div")
        .filter({ hasText: /^Yayın/ })
        .first();
      await expect(publish).toContainText("Desteklenmiyor");
      expect(
        (await browserFixtureState(page)).capabilities[account.id].find(
          (item) => item.operation === "publish",
        )?.status,
      ).toBe("unsupported");
    }
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const summary = page
          .locator("summary")
          .filter({ hasText: /^Tarayıcı bağlantısını yönet$/ });
        if (!(await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open)))
          await summary.click();
        await page
          .getByRole("button", { name: "Tarayıcı bağlantısını kontrol et", exact: true })
          .scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await page.locator(".social-main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`browser-connect-${platform}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const calls = await page.evaluate(
    () =>
      (window as unknown as { socialFixtureCalls: { args: { method?: string } }[] })
        .socialFixtureCalls,
  );
  expect(
    calls.filter((call) =>
      ["social.oauth.begin", "social.token.connect"].includes(call.args.method ?? ""),
    ),
  ).toHaveLength(0);
  expect(calls.filter((call) => call.args.method === "social.browser.begin")).toHaveLength(2);
});

test("browser campaign uploads persist and approval binds the reviewed revision without scheduling", async ({
  page,
}, testInfo) => {
  test.setTimeout(45000);
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureSeedBrowser(): void }).socialFixtureSeedBrowser(),
  );
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  await selectSection(page, "Kampanyalar");
  await page.getByRole("button", { name: "Yeni kampanya", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Yeni kampanya", exact: true });
  await form.getByLabel("Kampanya adı", { exact: true }).fill("Browser image campaign");
  await form.getByRole("button", { name: "İlgili projeler", exact: true }).click();
  const project = page.getByRole("option", { name: /Demo project/ });
  if ((await project.getAttribute("aria-selected")) !== "true") await project.click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await form.getByRole("button", { name: "Sosyal hesaplar", exact: true }).click();
  await page.getByRole("option", { name: /Bycoda Instagram/ }).click();
  await page.getByRole("button", { name: "Tamam", exact: true }).click();
  await form.getByLabel("Bu hesaba özel içerik", { exact: true }).fill("Reviewed browser caption");
  await form
    .locator("summary")
    .filter({ hasText: /^Tek seferlik yayın zamanı, medya ve bağlantı$/ })
    .click();
  await expect(form.getByLabel("HTTPS görsel URL'si", { exact: true })).toHaveCount(0);
  await form.getByLabel("Resim veya video dosyası", { exact: true }).setInputFiles(browserImage);
  await expect(form.getByText("1 görsel host'a yüklendi.", { exact: true })).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await form.getByLabel("Resim veya video dosyası", { exact: true }).scrollIntoViewIfNeeded();
      expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`browser-campaign-media-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await form.getByRole("button", { name: "Kampanya taslağını kaydet", exact: true }).click();
  await expect(form).not.toBeVisible();
  const saved = (await browserFixtureState(page)).campaigns[0];
  expect(saved.variants[0].media).toEqual([{ kind: "image", uploadId: "fixture-image-1" }]);
  expect((await browserFixtureState(page)).approvedCampaignIds).not.toContain(saved.id);
  await page.getByRole("button", { name: "Hesap ve içeriği kontrol et", exact: true }).click();
  const approve = page.getByRole("button", { name: "Yayın onayı ver", exact: true });
  await expect(approve).toBeDisabled();
  await page
    .getByLabel("Bu kampanyanın tüm hesap içeriklerini okudum ve yayınlanmasını onaylıyorum.", {
      exact: true,
    })
    .check();
  await approve.click();
  await expect(page.getByRole("button", { name: "İçerik onaylı", exact: true })).toBeDisabled();
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
    calls
      .filter((call) => call.args.params?.action === "campaigns.approveReviewed")
      .map((call) => call.args.params?.input),
  ).toEqual([{ id: saved.id, expectedRevision: 1 }]);
  expect(calls.some((call) => call.args.params?.action === "campaigns.schedule")).toBe(false);
  expect((await browserFixtureState(page)).jobs).toHaveLength(0);
});

test("browser message media edits survive a failed save and revoke previous draft approval", async ({
  page,
}) => {
  await page.goto("/tests/browser/social.html");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureSeedBrowser(): void }).socialFixtureSeedBrowser(),
  );
  await page.getByRole("button", { name: "Yenile", exact: true }).click();
  await selectSection(page, "Gelen kutusu");
  await page.getByRole("button").filter({ hasText: "Browser message question" }).click();
  await page.getByRole("button", { name: "Düzenle", exact: true }).click();
  const text = page.getByLabel("Taslak metni", { exact: true });
  await text.fill("Browser draft after media change");
  await page.getByLabel("Resim veya video dosyası", { exact: true }).setInputFiles(browserImage);
  await page.evaluate(() =>
    (window as unknown as { socialFixtureHold(action: string): void }).socialFixtureHold(
      "drafts.update",
    ),
  );
  const save = page.getByRole("button", { name: "Değişiklikleri kaydet", exact: true });
  await save.click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() =>
    (window as unknown as { socialFixtureRelease(reject: boolean): void }).socialFixtureRelease(
      true,
    ),
  );
  await expect(save).not.toHaveAttribute("aria-busy", "true");
  await expect(text).toHaveValue("Browser draft after media change");
  expect((await browserFixtureState(page)).drafts[0].approvedAt).toBe(1);
  await save.click();
  await expect(text).not.toBeVisible();
  const saved = (await browserFixtureState(page)).drafts[0];
  expect(saved.text).toBe("Browser draft after media change");
  expect(saved.media).toEqual([{ kind: "image", uploadId: "fixture-image-1" }]);
  expect(saved.approvedAt).toBeUndefined();
  await selectSection(page, "Hesaplar");
  await selectSection(page, "Gelen kutusu");
  await expect(page.getByText(saved.text, { exact: true })).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (window as unknown as { socialFixtureCalls: { args: { params?: { action?: string } } }[] })
        .socialFixtureCalls,
  );
  expect(
    calls.some((call) =>
      ["messages.send", "replies.send", "drafts.approve"].includes(call.args.params?.action ?? ""),
    ),
  ).toBe(false);
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

// Generated six-second 540x960 H.264 fixture: real Chromium metadata, no synthetic media getters.
const completionVideo = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM9bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAF3AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAF3AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAhwAAAPAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABdwAAAAAAABAAAAAAHgbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABi21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUtzdGJsAAAAu3N0c2QAAAAAAAAAAQAAAKthdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAhwDwABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBQsAf/+EAGWdCwB/ZAIgee/ARAAADAAEAAAMAAg8YMkgBAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAusAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAGAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAGAAAAAQAAACxzdHN6AAAAAAAAAAAAAAAGAAAIhQAAAAwAAAAMAAAADAAAAAwAAAAMAAAAFHN0Y28AAAAAAAAAAQAAA20AAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAyAAAACGZyZWUAAAjJbWRhdAAAAnEGBf//bdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjMgMDQ4MGNiMCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0zMCBsb29rYWhlYWRfdGhyZWFkcz01IHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAGDGWIhAX8mKAAIIsnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeAAAAAhBmjgL+AH+YAAAAAhBmlQC/gB/mAAAAAhBmmAX8AP8wAAAAAhBmoAW8AP8wAAAAAhBmqAV8AP8wA==",
  "base64",
);

// Deterministic 640x360 PNG keeps successful photo previews visibly inspectable.
const completionPhoto = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAoAAAAFoCAIAAABIUN0GAAAACXBIWXMAAAABAAAAAQBPJcTWAAAFyElEQVR4nO3XsQnCUBhG0QgOZiWk0gEcxhncQMgAWglWjmZnLQi5yDtngT88Apdvc75cJwBgXduV7wEAAgwADQsYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAFgpACfDvvqNAB8LPfnVLCAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAkQK83J/VaQDIWcAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAACDA37k9Xn4WCB3nnfeHH1nAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAFAgAFgDBYwAAQEGAACAgwAAQEGgIAAA0BAgAEg8JcBPs67+hMAYLwAA8C/E2AACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDAABAQaAgAADQECAASAgwAAQEGAACAgwAAQEGAACAgwAAQEGgIAAA0BAgAEgIMAAEBBgAAgIMAAEBBgAAgIMAAEBBoCAAANAQIABICDAABAQYAAICDAABAQYAAICDADT+t5xuhA5tudJugAAAABJRU5ErkJggg==",
  "base64",
);

// Six-second 540x960 H.264 at 30 fps, verified with ffprobe; actual Chromium metadata.
const completionReelVideo = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAuhbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAF3AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAACsx0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAF3AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAhwAAAPAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABdwAAAEAAABAAAAAApEbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAA8AAABaABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAJ721pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAACa9zdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAhwDwABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAf/+EAGmdkAB+s2UCIHnvwEQAAAwABAAADADwPGDGWAQAEaO+Py/34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAdxQAAAAAAAAAYc3R0cwAAAAAAAAABAAAAtAAAAgAAAAAUc3RzcwAAAAAAAAABAAAAAQAABahjdHRzAAAAAAAAALMAAAABAAAEAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAIAAAAAAIAAAIAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAC0AAAAAQAAAuRzdHN6AAAAAAAAAAAAAAC0AAADSAAAABwAAAAaAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAaAAAAGgAAAB0AAAAcAAAAGgAAABoAAAAdAAAAHAAAABoAAAAaAAAAHQAAABwAAAAa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",
  "base64",
);

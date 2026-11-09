import { test, expect, type Page } from "@playwright/test";

type FixtureCall = { command: string; args: { params?: { action?: string; input?: unknown } } };

/** Inputs of every `social.request` the fixture received for one action, in order. */
function requests(page: Page, action: string) {
  return page.evaluate(
    (name) =>
      (window as unknown as { socialFixtureCalls: FixtureCall[] }).socialFixtureCalls
        .filter((call) => call.args.params?.action === name)
        .map((call) => call.args.params?.input ?? {}),
    action,
  );
}

async function openSocial(page: Page) {
  await page.goto("/tests/browser/social.html");
  await expect(page.getByRole("tab", { name: "Komut", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

const sections = (page: Page) => page.getByRole("tablist", { name: "Social bölümleri" });

// Assertions below use the Turkish catalog, so every test starts in Turkish.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
});

test("the five sections render and switch by click and keyboard", async ({ page }) => {
  await openSocial(page);
  const nav = sections(page);
  await expect(nav.getByRole("tab")).toHaveText([
    "Komut",
    "İçerik",
    "Hedef kitle",
    "Gelen kutusu",
    "Hesaplar ve Ayarlar",
  ]);
  // Command loads its AI activity and pending work from the Host without a read error.
  await expect(page.getByRole("textbox", { name: "AI'a sor" })).toBeVisible();
  await expect(page.getByRole("region", { name: "İşleminiz bekleniyor" })).toBeVisible();
  await expect(page.getByText("AI etkinliği yüklenemedi.")).toHaveCount(0);
  await expect(page.getByText("Bekleyen işler yüklenemedi.")).toHaveCount(0);

  const screens: [string, () => ReturnType<Page["getByRole"]>][] = [
    ["İçerik", () => page.getByRole("button", { name: "Yeni gönderi" })],
    ["Hedef kitle", () => page.getByRole("tabpanel", { name: "Kişiler" })],
    ["Gelen kutusu", () => page.getByRole("searchbox", { name: "Konuşmaları arayın" })],
    ["Hesaplar ve Ayarlar", () => page.getByRole("region", { name: "Hesaplar" })],
  ];
  for (const [name, landmark] of screens) {
    await nav.getByRole("tab", { name, exact: true }).click();
    await expect(nav.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(landmark()).toBeVisible();
    // Only the selected section is visible; the command input stays mounted but hidden.
    await expect(page.getByRole("textbox", { name: "AI'a sor" })).toBeHidden();
  }

  // Keyboard: Home, ArrowRight and End move focus and selection along the strip.
  await nav.getByRole("tab", { name: "Hesaplar ve Ayarlar" }).focus();
  await page.keyboard.press("Home");
  await expect(nav.getByRole("tab", { name: "Komut" })).toBeFocused();
  await expect(nav.getByRole("tab", { name: "Komut" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "AI'a sor" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(nav.getByRole("tab", { name: "İçerik" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Yeni gönderi" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(nav.getByRole("tab", { name: "Hesaplar ve Ayarlar" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Hesaplar" })).toBeVisible();
});

test("a command becomes a visible plan that runs nothing until the owner runs it", async ({
  page,
}) => {
  await openSocial(page);
  await expect(page.getByText("Bugün gönderilen", { exact: true })).toBeVisible();
  const input = page.getByRole("textbox", { name: "AI'a sor" });
  const submit = page.getByRole("button", { name: "Plan", exact: true });
  await expect(submit).toBeDisabled();
  await input.fill("Answer this week's pricing questions");
  await submit.click();

  const plan = page.getByRole("region", { name: "Plan" });
  await expect(
    plan.getByText("Find questions for: Answer this week's pricing questions"),
  ).toBeVisible();
  await expect(plan.getByText("Otomatik çalışacak")).toBeVisible();
  await expect(plan.getByText("Reply to two pricing questions")).toBeVisible();
  await expect(input).toHaveValue("");
  expect(await requests(page, "ai.command")).toEqual([
    { text: "Answer this week's pricing questions", projectId: "demo" },
  ]);

  await plan.getByRole("button", { name: "Onayla", exact: true }).click();
  await expect(plan.getByText("Onaylandı", { exact: true })).toBeVisible();
  // Approving a step only marks it; nothing runs until the owner runs the plan.
  expect(await requests(page, "ai.plan.run")).toEqual([]);
});

test("undo on an AI action asks the Host once and removes the undo offer", async ({ page }) => {
  await openSocial(page);
  const activity = page.getByRole("region", { name: "Etkinlik" });
  await expect(activity.getByText("Fixture draft prepared for review")).toBeVisible();
  await activity.getByRole("button", { name: "Geri al", exact: true }).click();
  await expect(activity.getByRole("button", { name: "Geri al", exact: true })).toHaveCount(0);
  expect(await requests(page, "ai.actions.undo")).toEqual([{ actionId: "fixture-ai-action" }]);
});

test("stopping all AI is confirmed first and then shown in the shell bar", async ({ page }) => {
  await openSocial(page);
  await expect(page.getByText("AI etkin", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tüm AI işlemlerini durdur" }).click();
  const dialog = page.getByRole("dialog", { name: "Tüm AI durdurulsun mu?" });
  await expect(dialog).toBeVisible();
  // Nothing is stopped while the confirmation is open.
  expect(await requests(page, "ai.stop")).toEqual([]);
  await dialog.getByRole("button", { name: "Tüm AI işlemlerini durdur" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("AI durduruldu", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI'yi devam ettir" })).toBeVisible();
  expect(await requests(page, "ai.stop")).toHaveLength(1);
});

test("a new post states why it cannot be saved or published yet", async ({ page }) => {
  await openSocial(page);
  await sections(page).getByRole("tab", { name: "İçerik" }).click();
  await page.getByRole("button", { name: "Yeni gönderi" }).click();
  const editor = page.getByRole("dialog", { name: "Yeni gönderi" });
  await editor.getByRole("textbox", { name: "Paylaşım" }).fill("Launch day post");
  // The only account is not connected, so it cannot be picked and the draft cannot be saved.
  await expect(editor.getByRole("checkbox", { name: /Demo account/ })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Taslağı kaydet" })).toBeDisabled();
  await expect(editor.getByText("En az bir hesap seçin.")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Yayınla" })).toBeDisabled();
  await expect(
    editor.getByText("Gönderim kapalı. Hesaplar ve ayarlar bölümünden açın."),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Kapat" }).click();
  await expect(editor).toBeHidden();
  expect(await requests(page, "campaigns.create")).toEqual([]);
});

test("a new audience list is created by name and selected in the sidebar", async ({ page }) => {
  await openSocial(page);
  await sections(page).getByRole("tab", { name: "Hedef kitle" }).click();
  await page.getByRole("button", { name: "Yeni liste" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni liste" });
  const create = dialog.getByRole("button", { name: "Liste oluştur" });
  await expect(create).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Liste adı" }).fill("Launch followers");
  await create.click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("navigation", { name: "Kitle listeleri" }).getByText("Launch followers"),
  ).toBeVisible();
  expect(await requests(page, "lists.save")).toEqual([
    { name: "Launch followers", kind: "static", projectIds: [] },
  ]);
});

test("inbox auto-refresh follows the Host setting after the owner turns it on", async ({
  page,
}) => {
  await openSocial(page);
  await sections(page).getByRole("tab", { name: "Gelen kutusu" }).click();
  const inbox = page.getByRole("region", { name: "Gelen kutusu" });
  await expect(
    inbox.getByText("Henüz konuşma yok. Yeni mesajlar ve yorumlar burada görünür."),
  ).toBeVisible();
  const autoRefresh = inbox.getByRole("switch", { name: "Otomatik yenileme" });
  await expect(autoRefresh).not.toBeChecked();
  await autoRefresh.click();
  await expect(autoRefresh).toBeChecked();
  expect(await requests(page, "inbox.settings")).toEqual([{ autoRefresh: true }]);
});

test("account detail lists what a disconnected account cannot do and sending stays gated", async ({
  page,
}) => {
  await openSocial(page);
  await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
  const sending = page.getByRole("group", { name: "Onaylı gönderimleri aç" });
  const enable = sending.getByRole("button", { name: "Onaylı gönderimleri aç" });
  await expect(enable).toBeDisabled();
  await sending.getByRole("checkbox").check();
  await expect(enable).toBeEnabled();

  await page.getByRole("button", { name: /Demo account/ }).click();
  const detail = page.getByRole("dialog", { name: "Demo account" });
  const capabilities = detail.getByRole("list", { name: "Bu hesabın yapabilecekleri" });
  await expect(
    capabilities.getByRole("listitem").filter({ hasText: "Yayın" }).first(),
  ).toContainText("Bağlantı gerekli");
  await expect(capabilities.getByRole("button", { name: "Bağlan" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  // Ticking the consent box only enables the action; nothing was sent to the Host.
  expect(await requests(page, "execution.enable")).toEqual([]);
});

test("media field lists attached images and video and removes each item explicitly", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/social.html?x-media=1");
  const files = page.getByLabel("Görseller ya da tek video", { exact: true });
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
  await expect(page.getByText("one.png", { exact: true })).toBeVisible();
  await expect(page.getByText("two.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Eklerin türleri" })).toHaveText("image,image");
  // The field appends; the one-video-or-four-images rule is enforced by the content rules, not here.
  await files.setInputFiles({
    name: "demo.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]),
  });
  await expect(page.getByText("demo.mp4", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Eklerin türleri" })).toHaveText(
    "image,image,video",
  );
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
  // Each item has its own remove button (catalog "{p0}'ı kaldır"); nothing removes the batch at once.
  const status = page.getByRole("status", { name: "Eklerin türleri" });
  await page.getByRole("button", { name: "one.png'ı kaldır", exact: true }).click();
  await expect(status).toHaveText("image,video");
  await page.getByRole("button", { name: "two.png'ı kaldır", exact: true }).click();
  await expect(status).toHaveText("video");
  await page.getByRole("button", { name: "demo.mp4'ı kaldır", exact: true }).click();
  await expect(status).toBeEmpty();
});

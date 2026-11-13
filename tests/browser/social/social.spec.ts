import { mkdirSync } from "node:fs";
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
  await page.goto("/tests/browser/social/social.html");
  await expect(page.getByRole("tab", { name: "Komut", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

const sections = (page: Page) => page.getByRole("tablist", { name: "Social bölümleri" });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`social audience shared surfaces ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?extra-seeded&audience-surfaces");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const phase = process.env.SOCIAL_FRAME_PHASE ?? "after";
      await expect(page.locator(".activity-timeline > .social-activity-row")).toHaveCount(2);
      await page.screenshot({
        path: `temp/verification/social-frames/${phase}-activity-${theme}-${width}.png`,
        animations: "disabled",
      });
      await sections(page).getByRole("tab", { name: "Hedef kitle", exact: true }).click();
      await expect(page.locator('.social-platform-mark[data-size="xs"]')).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-frames/${phase}-people-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByText("Kişilere ulaşma", { exact: true }).click();
      const rows = page.locator(".audience-frame > .audience-seq");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveCSS("border-top-width", "0px");
      await expect(rows.nth(1)).toHaveCSS("border-top-width", "1px");
      await expect(page.locator(".audience-stats")).toHaveCSS("border-top-width", "1px");
      await expect(page.locator(".audience-stats > dl")).toHaveCSS("padding-inline-start", "12px");
      await expect(page.locator(".audience-stats > dl")).toHaveCSS("padding-block-start", "8px");
      await expect(page.locator(".audience-chain > li")).toHaveCount(4);
      await page.screenshot({
        path: `temp/verification/social-frames/${phase}-outreach-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByText("Toplama kuralları", { exact: true }).click();
      const rules = page.locator("ul.audience-frame > .audience-rule");
      await expect(rules).toHaveCount(2);
      await expect(rules.nth(0)).toHaveCSS("border-top-width", "0px");
      await expect(rules.nth(1)).toHaveCSS("border-top-width", "1px");
      await page.screenshot({
        path: `temp/verification/social-frames/${phase}-capture-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`social inbox shared surfaces ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?extra-seeded&inbox-surfaces");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "Gelen kutusu", exact: true }).click();
      const badge = page.locator(".social-avatar-platform").first();
      await expect(badge).toBeVisible();
      // Chromium rounds the 1.5px cutout to a physical CSS pixel at device scale 1.
      await expect(badge).toHaveCSS("border-top-width", "1px");
      await page.locator(".inbox-row-preview").filter({ hasText: "Demo ürün sorusu" }).click();
      await expect(page.locator('.inbox-line[data-direction="outbound"] .inbox-bubble')).toHaveCSS(
        "border-top-width",
        "1px",
      );
      await expect(page.locator('.inbox-line[data-direction="inbound"] .inbox-bubble')).toHaveCSS(
        "border-top-width",
        "0px",
      );
      await expect(page.locator(".inbox-day-label")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `temp/verification/social-frames/${process.env.SOCIAL_FRAME_PHASE ?? "after"}-inbox-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`social calendar shared surfaces ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?extra-seeded&calendar-seeded");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      const phase = process.env.SOCIAL_FRAME_PHASE ?? "after";
      for (const view of ["week", "month"]) {
        if (view === "month") await page.getByText("Ay", { exact: true }).click();
        await expect(page.locator(`.content-calendar[data-view="${view}"]`)).toBeVisible();
        const cells = page.locator(".content-day");
        expect(await cells.count()).toBeGreaterThanOrEqual(7);
        for (let index = 0; index < (await cells.count()); index++) {
          await expect(cells.nth(index)).toHaveCSS(
            "border-inline-start-width",
            index % 7 ? "1px" : "0px",
          );
          await expect(cells.nth(index)).toHaveCSS(
            "border-block-start-width",
            index >= 7 ? "1px" : "0px",
          );
        }
        const today = page.locator(".content-day[data-today]");
        await expect(today).toHaveCount(1);
        const colors = await today.evaluate((node) => {
          const probe = document.createElement("span");
          node.append(probe);
          probe.style.background = "var(--ui-fill-faint)";
          const ground = getComputedStyle(probe).backgroundColor;
          probe.style.background = "var(--ui-tone-accent-solid)";
          const number = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { ground, number };
        });
        await expect(today).toHaveCSS("background-color", colors.ground);
        await expect(today.locator(".content-day-number")).toHaveCSS(
          "background-color",
          colors.number,
        );
        const calendar = page.locator(".content-calendar");
        await expect(page.locator(".content-chip-host")).toHaveCount(1);
        await expect(page.getByText("Demo takvim gönderisi", { exact: true })).toBeVisible();
        expect(await calendar.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        await page.screenshot({
          path: `temp/verification/social-frames/${phase}-calendar-${view}-${theme}-${width}.png`,
          animations: "disabled",
        });
      }
    });
    test(`social shared frame contracts ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?extra-seeded");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await expect(page.getByRole("region", { name: "Rapor" })).toBeVisible();
      await page.getByRole("button", { name: "Rapor oluştur" }).click();
      await expect(page.getByText("Demo görev tamamlandı")).toBeVisible();
      const commandBodies = page.locator(".command-frame-body");
      await expect(commandBodies).toHaveCount(2);
      for (const body of await commandBodies.all()) {
        await expect(body).toHaveCSS("border-top-width", "1px");
      }
      const phase = process.env.SOCIAL_FRAME_PHASE ?? "after";
      await page.screenshot({
        path: `temp/verification/social-frames/${phase}-command-${theme}-${width}.png`,
        animations: "disabled",
      });
      await sections(page).getByRole("tab", { name: "Hedef kitle", exact: true }).click();
      await page.getByText("Demo kişi", { exact: true }).click();
      const panelSections = page.locator(".audience-panel-section");
      await expect(panelSections).toHaveCount(7);
      await expect(panelSections.first()).toHaveCSS("border-top-width", "0px");
      for (const section of (await panelSections.all()).slice(1)) {
        await expect(section).toHaveCSS("border-top-width", "1px");
      }
      const stages = page.locator(".audience-pipeline > li");
      expect(await stages.count()).toBeGreaterThan(1);
      for (const stage of await stages.all())
        await expect(stage).toHaveCSS("border-top-width", "1px");
      const active = page.locator('.audience-pipeline > li[data-current="true"]');
      await expect(active).toHaveCount(1);
      const palette = await active.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.background = "var(--ui-tone-accent-subtle)";
        probe.style.border = "1px solid var(--ui-tone-accent-border)";
        node.append(probe);
        const style = getComputedStyle(probe);
        const result = { background: style.backgroundColor, border: style.borderTopColor };
        probe.remove();
        return result;
      });
      await expect(active).toHaveCSS("background-color", palette.background);
      await expect(active).toHaveCSS("border-top-color", palette.border);
      await page.screenshot({
        path: `temp/verification/social-frames/${phase}-person-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(panelSections).toHaveCount(0);
    });
  }

test("social extra caller visual matrix", async ({ page }) => {
  for (const theme of ["light", "dark"])
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?tiktok&extra-seeded");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await expect(page.getByRole("region", { name: "Rapor" })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/command-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Rapor oluştur" }).click();
      await expect(page.getByText("Demo görev tamamlandı")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/report-${theme}-${width}.png`,
        animations: "disabled",
      });
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await expect(page.getByRole("button", { name: "Yeni gönderi", exact: true })).toBeVisible();
      await page.getByText("Liste", { exact: true }).click();
      await expect(page.getByText("Demo duyuru", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/content-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Yeni gönderi" })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/editor-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: /AI.a sor/ }).click();
      await page.screenshot({
        path: `temp/verification/social-extra/editor-ai-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: /AI.a sor/ }).click();
      await page.getByText("Demo TikTok", { exact: true }).click();
      await page.screenshot({
        path: `temp/verification/social-extra/tiktok-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByText("Diğer seçenekler", { exact: true }).click();
      await expect(page.getByText("Kampanya adı", { exact: true })).toBeVisible();
      await page.getByLabel("Kampanya adı").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/social-extra/advanced-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await sections(page).getByRole("tab", { name: "Hedef kitle", exact: true }).click();
      await expect(page.getByText("Demo kişi", { exact: true })).toBeVisible();
      await page.getByText("Demo kişi", { exact: true }).click();
      await page.screenshot({
        path: `temp/verification/social-extra/audience-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Olası yinelenenleri bul" }).click();
      await expect(page.getByText("Olası yineleme bulunamadı.")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/person-empty-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await sections(page).getByRole("tab", { name: "Gelen kutusu", exact: true }).click();
      await expect(page.getByText("Demo ürün sorusu", { exact: true })).toBeVisible();
      await page.getByText("Demo ürün sorusu", { exact: true }).click();
      await page.screenshot({
        path: `temp/verification/social-extra/inbox-${theme}-${width}.png`,
        animations: "disabled",
      });
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Demo account/ }).click();
      await expect(page.getByRole("region", { name: "X profili" })).toBeVisible();
      await page.getByRole("button", { name: "Profili oku" }).click();
      await expect(page.getByLabel("Profil adı", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/xprofile-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.goto("/tests/browser/social/social.html?extra-empty");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Rapor oluştur" }).click();
      await expect(page.getByText("Bu dönemde AI etkinliği yok.")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/report-empty-${theme}-${width}.png`,
        animations: "disabled",
      });
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await expect(page.getByText("Henüz gönderi yok.")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/content-empty-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.goto("/tests/browser/social/social.html?extra-seeded&extra-inbox-empty");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "Gelen kutusu", exact: true }).click();
      await expect(page.getByText("Henüz konuşma yok.", { exact: false })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/inbox-empty-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.goto("/tests/browser/social/social.html?extra-error");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await expect(page.getByText("Bekleyen işler yüklenemedi.")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-extra/needs-error-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
});

test("account capability and Telegram connection visual matrix", async ({ page }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [800, 1280]) {
      for (const telegram of [false, true]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/tests/browser/social/social.html${telegram ? "?telegram-channel" : ""}`);
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
        const account = telegram ? "Fixture Telegram channel" : "Demo account";
        await page.getByRole("button", { name: new RegExp(account) }).click();
        const detail = page.getByRole("dialog", { name: account });
        await expect(detail).toBeVisible();
        if (telegram) {
          await expect(detail.getByPlaceholder("@bycoda")).toBeVisible();
        } else {
          await detail.locator("summary").filter({ hasText: "Bağlantı gerekli" }).click();
          await expect(
            detail.getByRole("list", { name: "Bu hesabın yapabilecekleri" }),
          ).toBeVisible();
        }
        await page.screenshot({
          path: testInfo.outputPath(
            `${telegram ? "telegram-connect" : "account-capabilities"}-${theme}-${width}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
  }
});

test("account settings and connection forms visual matrix", async ({ page }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openSocial(page);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
      for (const [label, name] of [
        ["Karakter sınırları", "character-limits"],
        ["İşlem geçmişi", "activity-history"],
      ]) {
        const summary = page.locator("summary").filter({ hasText: new RegExp(`^${label}$`) });
        await summary.click();
        await summary.locator("..").scrollIntoViewIfNeeded();
        if (name === "activity-history") {
          await expect(
            summary.locator("..").getByText("Tamamlandı", { exact: true }),
          ).toBeVisible();
          await expect(summary.locator("..").getByText("Gönderildi", { exact: true })).toHaveCount(
            0,
          );
        }
        await page.screenshot({
          path: testInfo.outputPath(`${name}-${theme}-${width}.png`),
          fullPage: true,
        });
        await summary.click();
      }
      await page.getByRole("button", { name: "Hesap bağla", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`connect-account-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Bunun yerine e-posta hesabı ekle" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`email-account-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});

test("automatic audience labels stay on one line", async ({ page }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?automatic-list");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Hedef kitle", exact: true }).click();
      const badge = page.locator(".audience-collection-main [data-variant][data-tone]");
      await expect(badge).toBeVisible();
      const bounds = await badge.boundingBox();
      expect(bounds!.height).toBeLessThanOrEqual(20);
      await page.screenshot({
        path: testInfo.outputPath(`audience-badge-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});

// Assertions below use the Turkish catalog, so every test starts in Turkish.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
});

test("empty reply rules explain the disabled review once", async ({ page }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openSocial(page);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
      await page.locator(".social-account-row").first().click();
      const dialog = page.getByRole("dialog");
      await dialog
        .locator("summary")
        .filter({ hasText: /^Yanıt kuralları$/ })
        .click();
      const explanation = "Bu hesap için henüz yanıt kuralı yok.";
      await expect(dialog.getByText(explanation, { exact: true })).toHaveCount(1);
      const review = dialog.getByRole("button", { name: "Kuralları AI ile gözden geçir" });
      await expect(review).toBeDisabled();
      await expect(review).toHaveAccessibleDescription(explanation);
      await page.screenshot({
        path: testInfo.outputPath(`reply-rules-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});

test("live browser controls retain readable spacing", async ({ page }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?instagram-profile");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: /Accounts|Hesaplar/ }).click();
      await page.locator(".social-account-row").first().click();
      const dialog = page.getByRole("dialog");
      await dialog
        .locator("summary")
        .filter({ hasText: /^(Browser|Tarayıcı)$/ })
        .click();
      await dialog.getByRole("button", { name: /Open live view|Canlı görünümü aç/ }).click();
      const panel = dialog
        .locator("section")
        .filter({ has: page.locator("form") })
        .last();
      const form = panel.locator("form");
      await expect(form).toBeVisible();
      const buttons = form.getByRole("button");
      await expect(buttons).toHaveCount(3);
      const first = await buttons.nth(0).boundingBox();
      const second = await buttons.nth(1).boundingBox();
      expect(second!.x - (first!.x + first!.width)).toBeGreaterThanOrEqual(7);
      await page.screenshot({
        path: testInfo.outputPath(`live-browser-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
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
    inbox.getByText("Yeni görüşmeleri kontrol etmek için bir hesap bağlayın."),
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
  await detail.locator("summary").filter({ hasText: "Bağlantı gerekli" }).click();
  const capabilities = detail.getByRole("list", { name: "Bu hesabın yapabilecekleri" });
  await expect(
    capabilities.getByRole("listitem").filter({ hasText: "Yayın" }).first(),
  ).toContainText("Bağlantı gerekli");
  await expect(detail.getByRole("button", { name: "Tarayıcıda bağla", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  // Ticking the consent box only enables the action; nothing was sent to the Host.
  expect(await requests(page, "execution.enable")).toEqual([]);
});

test("media field lists attached images and video and removes each item explicitly", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/social/social.html?x-media=1");
  const files = page.getByRole("button", { name: "Görseller ya da tek video", exact: true });
  const firstPick = page.waitForEvent("filechooser");
  await files.click();
  await (
    await firstPick
  ).setFiles([
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
  const secondPick = page.waitForEvent("filechooser");
  await files.click();
  await (
    await secondPick
  ).setFiles({
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

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`content list final controls ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?extra-seeded");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByText("Liste", { exact: true }).click();
      const list = page.locator(".content-list");
      await expect(list.getByText("Demo duyuru", { exact: true })).toBeVisible();
      await expect(list.locator(".content-rows")).toHaveCSS("border-top-width", "1px");
      await page.screenshot({
        path: `temp/verification/goal-content-list/list-${theme}-${width}.png`,
        animations: "disabled",
      });
      await list.getByRole("button", { name: /Tüm durumlar/ }).click();
      await expect(page.getByRole("option", { name: "İptal edildi", exact: true })).toBeVisible();
      await expect(
        page.getByRole("option", { name: "İnceleme gerekli", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/goal-content-list/options-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("option", { name: "İptal edildi", exact: true }).click();
      await expect(list.getByText("Demo duyuru", { exact: true })).toHaveCount(0);
      const clear = list.getByRole("button", { name: "Filtreleri temizle", exact: true }).first();
      await expect(clear).toBeVisible();
      await page.screenshot({
        path: `temp/verification/goal-content-list/filtered-${theme}-${width}.png`,
        animations: "disabled",
      });
      await clear.focus();
      await page.keyboard.press("Enter");
      await expect(list.getByText("Demo duyuru", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`social remaining account callers ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/social/social.html?browser-monitor");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
      const folder = "temp/verification/social-account-callers";
      mkdirSync(folder, { recursive: true });
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `${folder}/${name}-${theme}-${width}.png`,
          animations: "disabled",
        });
      };
      await expect(page.locator(".social-account-row")).toHaveCount(1);
      await capture("accounts");
      for (const [label, name] of [
        ["Bu bilgisayarda gönderim", "sending"],
        ["Gelen kutusu", "inbox-settings"],
        ["AI modeli", "ai-model"],
      ] as const) {
        const region = page.getByRole("region", { name: label, exact: true });
        await region.scrollIntoViewIfNeeded();
        await expect(region).toBeVisible();
        expect(await region.locator("button,input").count()).toBeGreaterThan(0);
        await capture(name);
      }
      for (const [label, name] of [
        ["Karakter sınırları", "character-limits"],
        ["İşlem geçmişi", "activity-history"],
      ] as const) {
        const summary = page.locator("summary").filter({ hasText: new RegExp(`^${label}$`) });
        await summary.click();
        await summary.locator("..").scrollIntoViewIfNeeded();
        if (name === "activity-history") {
          await expect(
            summary.locator("..").getByText("Tamamlandı", { exact: true }),
          ).toBeVisible();
          await expect(summary.locator("..").getByText("Gönderildi", { exact: true })).toHaveCount(
            0,
          );
        } else
          expect(
            await summary.locator("..").locator('input[inputmode="numeric"]').count(),
          ).toBeGreaterThan(0);
        await capture(name);
        await summary.click();
      }
      await page.locator(".social-account-row").click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      for (const [label, name] of [
        ["Bu hesabı kimler kullanabilir", "permissions"],
        ["Özerklik", "autonomy"],
        ["Tarayıcı", "browser-settings"],
        ["Yanıt kuralları", "reply-rules"],
      ] as const) {
        const summary = sheet.locator("summary").filter({ hasText: new RegExp(`^${label}$`) });
        await summary.click();
        const region = sheet.getByRole("region", { name: label, exact: true });
        await region.scrollIntoViewIfNeeded();
        await expect(region).toBeVisible();
        if (name === "browser-settings") await expect(region.getByRole("switch")).toBeVisible();
        if (name === "reply-rules")
          await expect(
            region.getByRole("button", { name: "Kuralları AI ile gözden geçir", exact: true }),
          ).toBeDisabled();
        if (name === "permissions")
          expect(await region.getByRole("checkbox").count()).toBeGreaterThan(1);
        if (name === "autonomy")
          expect(await region.getByRole("spinbutton").count()).toBeGreaterThan(1);
        await capture(name);
        if (name === "autonomy") {
          await region.getByRole("switch").scrollIntoViewIfNeeded();
          await capture("autonomy-bottom");
        }
        await summary.click();
      }
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await page.getByRole("button", { name: "Hesap bağla", exact: true }).click();
      const connect = page.getByRole("dialog");
      const name = connect.getByRole("textbox", { name: "İsim", exact: true });
      await name.fill("Unsent fixture account draft");
      await expect(name).toHaveValue("Unsent fixture account draft");
      await capture("connect-account");
      await connect.getByRole("button", { name: "Bunun yerine e-posta hesabı ekle" }).click();
      const email = page.getByRole("dialog");
      await email.getByRole("textbox", { name: "İsim", exact: true }).fill("Unsent email draft");
      await email
        .getByRole("textbox", { name: "Gönderen adresi", exact: true })
        .fill("fixture@example.test");
      await capture("email-account");
      await email.getByRole("textbox").last().scrollIntoViewIfNeeded();
      await capture("email-account-bottom");
      await email.getByRole("button", { name: "İptal", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Yeni gönderi", exact: true })).toBeVisible();
      await capture("content-editor-current");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      for (const action of [
        "accounts.create",
        "accounts.assistantGrant",
        "accounts.grants",
        "autonomy.set",
        "execution.enable",
        "jobs.create",
      ])
        expect(await requests(page, action)).toEqual([]);
    });
  }

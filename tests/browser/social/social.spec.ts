import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { spotlightId, storyId } from "./snapchat-data";

type FixtureCall = { command: string; args: { params?: { action?: string; input?: unknown } } };

/** The alert owns one plain sentence; the raw provider text sits behind its Details link. */
async function expectErrorDetails(page: Page, detail: string | RegExp) {
  await page
    .getByRole("alert")
    .getByRole("button", { name: /^(Ayrıntılar|Details)/ })
    .first()
    .click();
  await expect(page.getByLabel(/^(Hata ayrıntıları|Error details)$/)).toContainText(detail);
  await page.keyboard.press("Escape");
}

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
    test(`Reddit campaign keeps target and title ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?reddit-delete&reddit-campaign");
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
      }, theme === "light");
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Yeni gönderi" });
      await editor.getByRole("checkbox", { name: /Fixture Reddit/ }).check();
      await editor.getByRole("textbox", { name: "Paylaşım" }).fill("Campaign body");
      await editor
        .getByRole("textbox", { name: "Topluluk veya profil", exact: true })
        .fill("u/bycoda");
      const save = editor.getByRole("button", { name: "Taslağı kaydet" });
      const publish = editor.getByRole("button", { name: "Yayınla", exact: true });
      await expect(save).toBeEnabled();
      await expect(publish).toBeDisabled();
      await editor.getByRole("textbox", { name: "Başlık", exact: true }).fill("Release notes");
      const preview = editor.getByRole("article").filter({ hasText: "Release notes" });
      await expect(preview.getByText("u/bycoda", { exact: true })).toBeVisible();
      await expect(save).toBeEnabled();
      await expect(publish).toBeEnabled();
      await editor.getByRole("textbox", { name: "Başlık", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/social-platform-acceptance/reddit-campaign-${theme}-${width}.png`,
        animations: "disabled",
      });
      await save.click();
      await expect(editor).toBeHidden();
      expect(await requests(page, "campaigns.create")).toEqual([
        expect.objectContaining({
          variants: [
            expect.objectContaining({
              accountId: "fixture-reddit",
              reddit: { subreddits: ["u_bycoda"], title: "Release notes", kind: "self" },
            }),
          ],
        }),
      ]);
      await page.getByRole("radio", { name: "Liste", exact: true }).check();
      await page.getByRole("button", { name: /^Reddit Campaign body/ }).click();
      const reopened = page.getByRole("dialog");
      await expect(reopened.getByRole("textbox", { name: "Başlık", exact: true })).toHaveValue(
        "Release notes",
      );
      await expect(
        reopened.getByRole("textbox", { name: "Topluluk veya profil", exact: true }),
      ).toHaveValue("u/bycoda");
    });
  }

test("social YouTube management confirms video edits and shows provider failures", async ({
  page,
}) => {
  await page.goto("/tests/browser/social/social.html?youtube-management");
  await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
  await page.getByRole("button", { name: /YouTube fixture/ }).click();
  await page.locator("summary").filter({ hasText: "YouTube yönetimi" }).click();
  await page.getByRole("tab", { name: "Videolar ve oynatma listeleri", exact: true }).click();
  await page.getByRole("button", { name: /^Summer release/ }).click();
  await page.getByRole("textbox", { name: "Başlık", exact: true }).fill("Renamed in fixture");
  await page.getByRole("button", { name: "Videoyu düzenle", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Videoyu düzenle" });
  await expect(edit.getByText("Renamed in fixture")).toBeVisible();
  expect(await requests(page, "youtube.video.update")).toEqual([]);
  await edit.getByRole("button", { name: "Videoyu düzenle" }).click();
  await expect
    .poll(() => requests(page, "youtube.video.update"))
    .toEqual([
      {
        accountId: "youtube-api",
        videoId: "shortDemo01",
        patch: { title: "Renamed in fixture" },
      },
    ]);
  await expect(edit).toBeHidden();
  await page.getByRole("radio", { name: "Videoyu sil", exact: true }).click();
  await page.getByRole("button", { name: "Videoyu sil", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Videoyu sil" })
    .getByRole("button", { name: "Videoyu sil" })
    .click();
  await expectErrorDetails(page, "Fixture YouTube deletion denied.");
  expect(await requests(page, "youtube.video.delete")).toEqual([
    {
      accountId: "youtube-api",
      videoId: "shortDemo01",
      confirm: true,
    },
  ]);
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`social YouTube Community management ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?youtube-management");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const capture = (surface: string) =>
        page.screenshot({
          path: `temp/verification/social-youtube/community-${surface}-${theme}-${width}.png`,
          animations: "disabled",
        });
      const action = async (name: string) => {
        await page.getByRole("radio", { name, exact: true }).click();
      };
      const studio = "youtube-browser";
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
      await page.getByRole("button", { name: /Studio fixture/ }).click();
      await page.locator("summary").filter({ hasText: "YouTube yönetimi" }).click();
      await page.getByRole("tab", { name: "Topluluk gönderileri", exact: true }).click();
      await page.getByRole("button", { name: /^Biçim:/ }).click();
      await page.getByRole("option", { name: "Metin", exact: true }).click();
      await page.getByRole("textbox", { name: "Gönderi metni" }).fill("Fixture Community release");
      await page.getByRole("button", { name: "Yayın zamanı", exact: true }).click();
      const calendar = page.getByRole("dialog", { name: "Yayın zamanı" });
      const date = calendar.getByRole("textbox", { name: "Tarih ve saat" });
      await date.fill("2026-12-01 12:30");
      await date.press("Enter");
      await calendar.getByRole("button", { name: "Uygula" }).click();
      const scheduleName = "Topluluk gönderisini planla";
      await capture("schedule");
      await page.getByRole("button", { name: scheduleName, exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: scheduleName });
      expect(await requests(page, "youtube.community.publish")).toEqual([]);
      await confirmation.getByRole("button", { name: scheduleName }).click();
      const publishAt = await page.evaluate(() => new Date("2026-12-01T12:30:00").toISOString());
      await expect
        .poll(() => requests(page, "youtube.community.publish"))
        .toEqual([
          { accountId: studio, kind: "text", text: "Fixture Community release", publishAt },
        ]);
      await expect(confirmation).toBeHidden();
      await page.getByRole("button", { name: /^Durum:/ }).click();
      await page.getByRole("option", { name: "Planlandı", exact: true }).click();
      await page.getByRole("button", { name: "Yükle", exact: true }).click();
      await page.getByRole("button", { name: /^Fixture Community release/ }).click();
      const editName = "Topluluk gönderisini düzenle";
      const editor = page.getByRole("textbox", { name: "Gönderi metni" });
      await expect(editor).toHaveValue("Fixture Community release");
      await editor.fill("Edited Community release");
      await capture("edit");
      await page.getByRole("button", { name: editName, exact: true }).click();
      await page
        .getByRole("dialog", { name: editName })
        .getByRole("button", { name: editName })
        .click();
      await expect
        .poll(() => requests(page, "youtube.community.edit"))
        .toEqual([
          {
            accountId: studio,
            postId: "UgFixturePost001",
            status: "scheduled",
            editedText: "Edited Community release",
          },
        ]);
      const deleteName = "Topluluk gönderisini sil";
      await action(deleteName);
      await page.getByRole("button", { name: deleteName, exact: true }).click();
      const deletion = page.getByRole("dialog", { name: deleteName });
      await expect(deletion).toBeVisible();
      expect(await requests(page, "youtube.community.delete")).toEqual([]);
      await capture("delete");
      await deletion.getByRole("button", { name: deleteName }).click();
      await expect
        .poll(() => requests(page, "youtube.community.delete"))
        .toEqual([
          { accountId: studio, postId: "UgFixturePost001", status: "scheduled", confirm: true },
        ]);
    });

    test(`social YouTube management ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?youtube-management");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const capture = (surface: string) =>
        page.screenshot({
          path: `temp/verification/social-youtube/${surface}-${theme}-${width}.png`,
          animations: "disabled",
        });
      const chooseSection = (name: string) => page.getByRole("tab", { name, exact: true }).click();
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Yeni gönderi" });
      await editor.getByRole("checkbox", { name: /YouTube fixture/ }).check();
      await editor.getByRole("button", { name: /^Biçim:/ }).click();
      await page.getByRole("option", { name: "Kısa", exact: true }).click();
      await capture("shorts");
      await editor.getByRole("button", { name: "Kapat" }).click();
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
      await page.getByRole("button", { name: /YouTube fixture/ }).click();
      await page.locator("summary").filter({ hasText: "YouTube yönetimi" }).click();
      await chooseSection("Videolar ve oynatma listeleri");
      await expect(page.getByText("Summer release")).toBeVisible();
      await capture("videos");
      await chooseSection("Kanal profili");
      await expect(page.getByText("@fixture")).toBeVisible();
      await capture("profile");
      await chooseSection("Canlı yayınlar");
      await expect(page.getByText("Friday livestream")).toBeVisible();
      await capture("live");
      await chooseSection("Analiz");
      await expect(page.getByText("Data API kota birimleri")).toBeVisible();
      await capture("analytics");
      await chooseSection("Yorumlar");
      await expect(page.getByText(/Gösterilecek yorum yok/)).toBeVisible();
      await capture("comments");
      await chooseSection("Abonelikler");
      await expect(page.getByText("Fixture subscriber")).toBeVisible();
      await capture("subscriptions");
      await chooseSection("İncele");
      await expect(page.getByRole("button", { name: "İncele", exact: true })).toBeVisible();
      await capture("review");
      await page.getByRole("dialog").getByRole("button", { name: "Kapat" }).click();
      await page.getByRole("button", { name: /Studio fixture/ }).click();
      await page.locator("summary").filter({ hasText: "YouTube yönetimi" }).click();
      await chooseSection("Videolar");
      await page.getByRole("button", { name: "Yükle", exact: true }).click();
      await page.getByRole("button", { name: /^Studio test Short/ }).click();
      await page.getByRole("button", { name: "Videoyu sil", exact: true }).click();
      const studioDelete = page.getByRole("dialog", { name: "Videoyu sil" });
      await expect(studioDelete.getByText("shortDemo01")).toBeVisible();
      await expect(studioDelete.getByText("Studio test Short", { exact: true })).toBeVisible();
      await expect(studioDelete.getByText("Bu işlem geri alınamaz.")).toBeVisible();
      expect(await requests(page, "youtube.video.delete")).toEqual([]);
      await capture("studio-delete-confirm");
      await studioDelete.getByRole("button", { name: "Videoyu sil", exact: true }).click();
      await expect
        .poll(() => requests(page, "youtube.video.delete"))
        .toEqual([{ accountId: "youtube-browser", videoId: "shortDemo01", confirm: true }]);
      await expect(page.getByText("Studio test Short")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Videoyu sil", exact: true })).toBeDisabled();
      await capture("studio-delete-complete");
      await chooseSection("Topluluk gönderileri");
      await capture("community");
      await chooseSection("Analiz");
      await page.getByRole("button", { name: "Yükle", exact: true }).click();
      await expect(page.getByText(/YouTube işlem yapmanızı bekliyor/)).toBeVisible();
      await capture("needs-human");
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`Instagram deletion review ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        "/tests/browser/social/social.html?instagram-surface=browser&instagram-delete-review",
      );
      const frame = page.locator("[data-instagram-surface]");
      const openTools = async () => {
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await frame.getByText(/^(Instagram tools|Instagram araçları)$/i).click();
      };
      const tab = (name: RegExp) => frame.getByRole("tab", { name }).click();
      const input = frame.getByRole("textbox", {
        name: /^(Instagram post URL|Instagram gönderi bağlantısı)$/i,
      });
      const deleteName = /^(Delete Instagram post|Instagram gönderisini sil)$/i;
      const remove = frame.getByRole("button", { name: deleteName });
      await openTools();
      await tab(/^(Content|İçerik)$/);
      await tab(/^(Posts|Gönderiler)$/);
      await input.fill("https://www.instagram.com/p/FixtureDelete/");
      await expect(remove).toBeEnabled();
      await remove.click();
      await page.getByRole("dialog").getByRole("button", { name: deleteName }).click();
      await expect(frame.getByText(/^(Needs review|İnceleme gerekli)$/)).toBeVisible();
      await expect(remove).toBeDisabled();
      await expect(frame.getByRole("button", { name: /^(Open post|Gönderiyi aç)$/ })).toBeVisible();
      const capture = (surface: string) =>
        page.screenshot({
          path: `temp/verification/social-instagram-followup/delete-${surface}-${theme}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
      await capture("post");
      await page.reload();
      await openTools();
      await tab(/^(Requests|İstekler)$/);
      await expect(
        frame.getByText(
          /This change may already be on Instagram|Bu değişiklik Instagram'da zaten olabilir/,
        ),
      ).toBeVisible();
      await expect(
        frame.getByRole("button", { name: /Review and apply|İncele ve uygula/ }),
      ).toHaveCount(0);
      await expect(frame.getByRole("button", { name: /^(Open post|Gönderiyi aç)$/ })).toBeVisible();
      await capture("request");
      await tab(/^(Content|İçerik)$/);
      await tab(/^(Posts|Gönderiler)$/);
      await input.fill("https://www.instagram.com/reel/FixtureDelete/");
      await expect(frame.getByText(/^(Needs review|İnceleme gerekli)$/)).toBeVisible();
      await expect(remove).toBeDisabled();
    });

    test(`Instagram surfaces ${theme} ${width}`, async ({ page }) => {
      for (const surface of ["publishing", "story", "inbox", "browser", "insights"]) {
        await page.setViewportSize({
          width,
          height: surface === "browser" ? 2200 : surface === "inbox" ? 1100 : 900,
        });
        await page.goto(`/tests/browser/social/social.html?instagram-surface=${surface}`);
        const frame = page.locator("[data-instagram-surface]");
        await expect(frame).toBeVisible();
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        if (surface === "browser" || surface === "insights") {
          await frame.getByText(/^(Instagram tools|Instagram araçları)$/i).click();
          const tool = (name: RegExp) => frame.getByRole("tab", { name }).click();
          if (surface === "browser") {
            await tool(/^(Account|Hesap)$/);
            await tool(/^(Profile|Profil)$/);
            await frame
              .getByRole("button", { name: /^(Read Instagram profile|Instagram profilini oku)$/i })
              .click();
            await tool(/^(Live|Canlı)$/);
            await frame
              .getByRole("button", {
                name: /^(Open Instagram Live Producer|Instagram Canlı Yayın Yapımcısı’nı aç)$/i,
              })
              .click();
            await tool(/^(Account|Hesap)$/);
            await tool(/^(Earnings|Kazançlar)$/);
            await frame
              .getByRole("button", {
                name: /^(Read Instagram earnings|Instagram kazançlarını oku)$/i,
              })
              .click();
            await expect(frame.getByText(/€321\.40/)).toBeVisible();
            await tool(/^(Content|İçerik)$/);
            await tool(/^(Highlights|Öne çıkanlar)$/);
            await frame
              .getByRole("button", {
                name: /^(Read Instagram Highlights|Instagram Öne Çıkanlar’ı oku)$/i,
              })
              .click();
            await frame.getByRole("button", { name: "Studio Stories", exact: true }).click();
            await expect(
              frame.getByRole("textbox", { name: /^(Highlight name|Öne Çıkanlar öğesinin adı)$/i }),
            ).toHaveValue("Studio Stories");
          } else {
            await tool(/^(Insights|İstatistikler)$/);
            await frame
              .getByRole("button", {
                name: /^(Read Instagram insights|Instagram istatistiklerini oku)$/i,
              })
              .click();
          }
        } else if (surface === "inbox") {
          await frame.getByText(/^(Instagram comment actions|Instagram yorum işlemleri)$/i).click();
          await expect(
            frame.getByText(/Send privately on Instagram|Instagram’da özel yanıt gönder/),
          ).toBeVisible();
          await frame
            .getByRole("button", {
              name: /^(Review Instagram moderation requests|Instagram moderasyon isteklerini incele)$/i,
            })
            .click();
          await expect(
            frame.getByText("When is the next live stream?", { exact: true }),
          ).toBeVisible();
          await frame
            .getByRole("button", { name: /^(Instagram attachment|Instagram eki):/i })
            .click();
          await page.getByRole("option", { name: /^(Audio|Ses)$/i }).click();
          await expect(frame.getByText(/^(Local file|Yerel dosya)$/i)).toBeVisible();
        }
        await page.screenshot({
          path: `temp/verification/social-instagram-followup/${surface}-${theme}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    });
  }

async function openSnapchatFixture(page: Page, theme = "light", width = 1280) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/tests/browser/social/social.html?snapchat-ui");
  await page.evaluate(
    (light) => document.documentElement.classList.toggle("theme-light", light),
    theme === "light",
  );
  await expect(page.getByRole("tab", { name: "Command", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`Snapchat routed panels ${theme} ${width}`, async ({ page }) => {
      await openSnapchatFixture(page, theme, width);
      const shot = (surface: string) =>
        page.screenshot({
          path: `temp/verification/social-snapchat/${surface}-${theme}-${width}.png`,
          animations: "disabled",
        });
      await page.getByText("Snapchat insights", { exact: true }).click();
      await page.getByText("Insights", { exact: true }).click();
      await page.getByRole("button", { name: "Read insights" }).click();
      await expect(page.getByText("SUBSCRIBERS · 2,345")).toBeVisible();
      await expect(page.getByText("Some Snapchat results are unavailable.")).toBeVisible();
      await page.getByText("Creator earnings", { exact: true }).click();
      await page.getByRole("button", { name: "Read earnings" }).click();
      const earnings = page.getByText(/12\.345.*SPOTLIGHT/);
      await earnings.scrollIntoViewIfNeeded();
      await expect(earnings).toBeInViewport();
      await expect(page.getByText(/Data through .*UTC/)).toBeVisible();
      await shot("command");

      await page.getByRole("tab", { name: "Content", exact: true }).click();
      await page.getByText("Snapchat publications", { exact: true }).click();
      await page.getByRole("button", { name: "Read publications" }).click();
      await expect(page.getByText("Fixture launch clip")).toBeVisible();
      await page.getByText("Fixture launch clip").click();
      await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
      await shot("content");

      await page.getByRole("tab", { name: "Accounts & Settings" }).click();
      await page.getByRole("button", { name: /Fixture Snapchat Browser/ }).click();
      const account = page.getByRole("dialog", { name: "Fixture Snapchat Browser" });
      await account.getByText("Snapchat Public Profile", { exact: true }).click();
      await account.getByRole("button", { name: "Read profile", exact: true }).click();
      await expect(account.getByLabel("Profile name", { exact: true })).toHaveValue(
        "Fixture Studio",
      );
      await account.getByRole("button", { name: "Snapchat monetization status" }).click();
      await expect(account.getByText("Daily rewards · Eligible")).toBeVisible();
      await account
        .getByRole("button", { name: "Save changes", exact: true })
        .scrollIntoViewIfNeeded();
      await shot("account-profile");
      await account.getByText("Delete Public Story", { exact: true }).click();
      await account.getByLabel("Public Story ID").fill(storyId);
      await account.getByRole("button", { name: "Delete", exact: true }).click();
      const storyConfirm = page.getByRole("dialog", { name: "Delete this Snapchat publication?" });
      const confirmStory = storyConfirm.getByRole("button", { name: "Delete", exact: true });
      await expect(confirmStory).toBeDisabled();
      await storyConfirm.getByRole("textbox").fill(storyId);
      await shot("account-story-confirmation");
      await confirmStory.click();
      await expect(account.getByText("Public Story deleted.")).toBeVisible();
      await account.getByText("Snapchat Public Profile", { exact: true }).click();
      await account.getByText("Snapchat reviews", { exact: true }).click();
      await account.getByRole("button", { name: "Refresh" }).click();
      await account.getByText("Save changes?", { exact: true }).click();
      await expect(account.getByText(/New behind-the-scenes series/)).toBeVisible();
      await shot("account-reviews");

      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: "Inbox", exact: true }).click();
      await page.getByText("New Snapchat chat", { exact: true }).click();
      await page.getByRole("button", { name: "Read Snapchat friends" }).click();
      await page.getByRole("button", { name: /^Snapchat friends:/ }).click();
      await page.getByRole("option", { name: "@fixture.friend", exact: true }).click();
      await expect(page.getByLabel("Friend’s Snapchat username")).toHaveValue("fixture.friend");
      await page.getByLabel("Message", { exact: true }).fill("Fixture message draft");
      await shot("inbox-new-chat");

      await page.getByRole("tab", { name: "Content", exact: true }).click();
      await page.getByRole("button", { name: "New post", exact: true }).click();
      const composer = page.getByRole("dialog", { name: "New post" });
      await composer.getByRole("checkbox", { name: /Fixture Snapchat API/ }).click();
      for (const [format, field, file] of [
        ["Spotlight", "Spotlight locale", "spotlight"],
        ["Public Story", "Story expiry", "public-story"],
        ["Saved Story", "Saved Story source IDs", "saved-story"],
      ]) {
        await composer.getByRole("button", { name: /^Snapchat publishing format:/ }).click();
        await page.getByRole("option", { name: format, exact: true }).click();
        const optionsField =
          field === "Story expiry"
            ? composer.getByRole("button", { name: /^Story expiry:/ })
            : composer.getByLabel(field, { exact: true });
        await optionsField.scrollIntoViewIfNeeded();
        await shot(`composer-${file}`);
      }
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: "Accounts & Settings" }).click();
      await page.getByRole("button", { name: "Connect account", exact: true }).click();
      await page.getByRole("button", { name: /^Platform:/ }).click();
      await page.getByRole("option", { name: "Snapchat", exact: true }).click();
      await page.getByRole("button", { name: /^How to connect:/ }).click();
      await page.getByRole("option", { name: "Browser sign-in", exact: true }).click();
      await page.getByRole("button", { name: /Create a new Snapchat account instead/ }).click();
      const signup = page.getByRole("dialog", { name: "Create a Snapchat account" });
      await signup.getByLabel("Name", { exact: true }).fill("Fixture Snapchat signup");
      await shot("signup-start");
      await signup.getByRole("button", { name: "Open sign-up window" }).click();
      await expect(signup.getByLabel("Phone number")).toBeVisible();
      await expect(signup.locator('input[type="password"]')).toHaveCount(0);
      expect(await requests(page, "accounts.create")).toEqual([
        expect.objectContaining({
          platform: "snapchat",
          accountType: "member",
          connection: "browser",
        }),
      ]);
      await shot("signup-fields");
    });

test("Snapchat routed loading, project permission, empty, denied and exact deletion", async ({
  page,
}) => {
  await openSnapchatFixture(page);
  await page.getByText("Snapchat insights", { exact: true }).click();
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("option", { name: "Fixture Snapchat Read Only" }).click();
  await page.getByText("Creator earnings", { exact: true }).click();
  await page.getByRole("button", { name: "Read earnings" }).click();
  await expectErrorDetails(page, /Fixture creator access denied/);
  await expect(page.getByText("No Snapchat earnings found.")).toHaveCount(0);

  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await page.getByText("Snapchat publications", { exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { socialFixtureHold(action: string): void }).socialFixtureHold(
      "snapchat.content.list",
    ),
  );
  const read = page.getByRole("button", { name: "Read publications" });
  await read.click();
  await expect(read).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => requests(page, "snapchat.content.list")).toHaveLength(1);
  await page.evaluate(() =>
    (window as unknown as { socialFixtureRelease(): void }).socialFixtureRelease(),
  );
  await expect(page.getByText("Fixture launch clip")).toBeVisible();
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByText("Fixture studio tour")).toBeVisible();
  await page.getByText("Fixture launch clip").click();
  const remove = page.getByRole("button", { name: "Delete", exact: true });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Delete this Snapchat publication?" });
  const confirm = confirmation.getByRole("button", { name: "Delete", exact: true });
  await expect(confirm).toBeDisabled();
  await confirmation.getByRole("textbox").fill(spotlightId);
  await confirm.click();
  await expect(page.getByText("Fixture launch clip")).toHaveCount(0);
  expect(await requests(page, "snapchat.content.delete")).toEqual([
    { accountId: "snapchat-api", target: "spotlight", id: spotlightId, confirmId: spotlightId },
  ]);

  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("option", { name: "Fixture Snapchat Read Only" }).click();
  await page.getByRole("button", { name: "Read publications" }).click();
  await page.getByText("Fixture launch clip").click();
  await expect(remove).toBeDisabled();
  await page.getByRole("button", { name: /^Format:/ }).click();
  await page.getByRole("option", { name: "Public Stories" }).click();
  await page.getByRole("button", { name: "Read publications" }).click();
  await expect(page.getByText("No Snapchat publications found.")).toBeVisible();
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`LinkedIn Live comments panel ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?linkedin-live-comments");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Fixture LinkedIn Live Page/ }).click();
      await page.getByText("LinkedIn Live", { exact: true }).click();
      const comments = page.getByRole("group", { name: "LinkedIn Live yorumları" });
      await comments.getByLabel("LinkedIn etkinlik kimliği").fill("7246559654799892480");
      await comments.getByRole("button", { name: "Yorumları yükle" }).click();
      await expect(page.getByText("Bir ürün demosu olacak mı?")).toBeVisible();
      await page.getByRole("button", { name: "Yanıt", exact: true }).click();
      await page.getByRole("textbox", { name: "Yanıt", exact: true }).fill("Evet, yayın sonunda.");
      await page.getByRole("button", { name: "Değişikliği incele" }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/social-linkedin/live-comments-${theme}-${width}.png`,
        animations: "disabled",
      });
      expect(await requests(page, "linkedin.management.submit")).toEqual([]);
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`LinkedIn desktop surfaces ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?linkedin-support");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const shot = (name: string) =>
        page.screenshot({
          path: `temp/verification/social-linkedin/${name}-${theme}-${width}.png`,
          animations: "disabled",
        });
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Fixture LinkedIn API/ }).click();
      await page
        .locator("summary")
        .filter({ hasText: /^Analiz$/ })
        .click();
      await page.getByRole("button", { name: "Analizleri oku", exact: true }).click();
      await expect(page.getByText(/Gösterimler/)).toBeVisible();
      await page.getByText("LinkedIn gönderilerini yönet", { exact: true }).click();
      await page.getByText("Mevcut bir incelemeyi aç", { exact: true }).click();
      await expect(page.getByLabel("LinkedIn inceleme kimliği")).toBeVisible();
      await shot("api-account");
      await page.getByText("LinkedIn Live", { exact: true }).click();
      await expect(page.getByText("Live Studio’yu aç", { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "Yayın bilgilerini kaydet", exact: true })
        .scrollIntoViewIfNeeded();
      await shot("live-credentials");
      await page.getByRole("dialog").getByRole("button", { name: "Kapat", exact: true }).click();
      await page.getByRole("button", { name: /Fixture LinkedIn Browser/ }).click();
      await page
        .locator("summary")
        .filter({ hasText: /^Profil$/ })
        .click();
      await page.getByRole("button", { name: "Okuma", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Profil başlığı" })).toHaveValue(
        "Fixture product studio",
      );
      await shot("browser-profile");
      await page
        .locator("summary")
        .filter({ hasText: /^Bağlantılar$/ })
        .click();
      await page.getByRole("button", { name: "Yenile", exact: true }).click();
      await expect(page.getByRole("button", { name: "Ada Fixture" })).toBeVisible();
      await shot("network");
      await page
        .locator("summary")
        .filter({ hasText: /^Makaleler ve bültenler$/ })
        .click();
      await page
        .getByRole("button", { name: "Taslak hazırla", exact: true })
        .scrollIntoViewIfNeeded();
      await shot("creator");
      await page.getByRole("dialog").getByRole("button", { name: "Kapat", exact: true }).click();
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Yeni gönderi" });
      const linkedin = editor.getByRole("checkbox", { name: /Fixture LinkedIn API/ });
      if (!(await linkedin.isChecked())) await linkedin.check();
      await editor.getByRole("button", { name: /^Gönderi biçimi/ }).click();
      await page.getByText("Anket", { exact: true }).click();
      await editor.getByLabel("Anket sorusu").fill("Hangi özelliği önce çıkaralım?");
      await editor.getByLabel("1. seçenek").fill("Analizler");
      await editor.getByLabel("2. seçenek").fill("Yayın");
      await expect(editor.getByRole("button", { name: "Taslağı kaydet" })).toBeEnabled();
      await editor.getByRole("button", { name: /^Anket süresi/ }).scrollIntoViewIfNeeded();
      await shot("poll-composer");
      expect(errors).toEqual([]);
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    for (const [name, platform, postId] of [
      ["Reddit", "reddit", "t3_qa123"],
      ["Telegram", "telegram", "-1001234567890:7"],
    ] as const)
      test(`${name} published post deletion ${theme} ${width}`, async ({ page }) => {
        const review = theme === "dark" && width === 800;
        const profileTarget = platform === "reddit" && width === 800;
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `/tests/browser/social/social.html?${platform}-delete${review ? "&delete-review" : ""}${profileTarget ? "&profile-target" : ""}`,
        );
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
        await page.getByRole("button", { name: new RegExp(`Fixture ${name}`) }).click();
        const detail = page.getByRole("dialog", { name: `Fixture ${name}` });
        await detail
          .locator("summary")
          .filter({ hasText: /^Gönderiler$/ })
          .click();
        await detail.getByRole("button", { name: "Gönderilerimi yükle" }).click();
        const remove = detail.getByRole("button", { name: "Gönderiyi sil", exact: true });
        await expect(remove).toBeDisabled();
        await detail.getByRole("button", { name: /Gönderi seçin/ }).click();
        const title =
          platform === "reddit"
            ? `${profileTarget ? "u/bycoda" : "r/bycodatest"} · Test yayını`
            : "Test yayını";
        await page.getByRole("option", { name: title, exact: true }).click();
        await page.screenshot({
          path: `temp/verification/social-platform-acceptance/${platform}-delete-form-${theme}-${width}.png`,
          animations: "disabled",
        });
        await remove.click();
        const confirmation = page.getByRole("dialog", { name: "Gönderiyi sil" });
        await expect(confirmation.getByText(postId, { exact: true })).toBeVisible();
        await page.screenshot({
          path: `temp/verification/social-platform-acceptance/${platform}-delete-confirm-${theme}-${width}.png`,
          animations: "disabled",
        });
        await confirmation.getByRole("button", { name: "İptal", exact: true }).click();
        expect(await requests(page, `${platform}.post.delete`)).toEqual([]);
        await remove.click();
        await confirmation.getByRole("button", { name: "Sil", exact: true }).click();
        await expect(
          detail.getByText(review ? "İnceleme gerekli" : "Silindi", { exact: true }),
        ).toBeVisible();
        await expect(detail.getByRole("button", { name: "Gönderiyi aç" })).toHaveCount(
          review ? 1 : 0,
        );
        await expect(remove).toBeDisabled();
        expect(await requests(page, `${platform}.post.delete`)).toEqual([
          {
            accountId: `fixture-${platform}`,
            jobId: `${platform}-qa`,
            postId,
            confirm: `DELETE_${platform.toUpperCase()}_POST`,
          },
        ]);
      });
    test(`Facebook browser post deletion ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?facebook-page&facebook-browser");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Fixture Facebook Page/ }).click();
      const detail = page.getByRole("dialog", { name: "Fixture Facebook Page" });
      await detail
        .locator("summary")
        .filter({ hasText: /^Gönderiler$/ })
        .click();
      const link = detail.getByRole("textbox", { name: "Bağlantı", exact: true });
      const remove = detail.getByRole("button", { name: "Gönderiyi sil", exact: true });
      const postId = "https://www.facebook.com/permalink.php?story_fbid=789&id=123";
      await expect(remove).toBeDisabled();
      await link.fill(postId);
      await page.screenshot({
        path: `temp/verification/social-platform-acceptance/facebook-delete-form-${theme}-${width}.png`,
        animations: "disabled",
      });
      await remove.click();
      const confirmation = page.getByRole("dialog", { name: "Gönderiyi sil" });
      await expect(confirmation.getByText(postId, { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-platform-acceptance/facebook-delete-confirm-${theme}-${width}.png`,
        animations: "disabled",
      });
      await confirmation.getByRole("button", { name: "İptal", exact: true }).click();
      await expect(link).toHaveValue(postId);
      expect(await requests(page, "facebook.post.delete")).toEqual([]);
      await remove.click();
      await confirmation.getByRole("button", { name: "Sil", exact: true }).click();
      await expect(detail.getByText("Silindi", { exact: true })).toBeVisible();
      expect(await requests(page, "facebook.post.delete")).toEqual([
        { accountId: "fixture-facebook", postId, confirm: "DELETE_FACEBOOK_POST" },
      ]);
    });
    test(`Facebook Page controls ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?facebook-page");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Fixture Facebook Page/ }).click();
      const detail = page.getByRole("dialog", { name: "Fixture Facebook Page" });
      const capture = (name: string) =>
        page.screenshot({
          path: `temp/verification/social-facebook/${name}-${theme}-${width}.png`,
          animations: "disabled",
        });
      const profile = detail.locator("summary").filter({ hasText: "Profili düzenle" });
      await profile.click();
      await detail.getByRole("button", { name: "Profili oku", exact: true }).click();
      await expect(detail.getByText(/@fixturepage/)).toBeVisible();
      await capture("profile");
      await detail
        .getByRole("button", { name: "Profili kaydet", exact: true })
        .scrollIntoViewIfNeeded();
      await capture("profile-settings");
      await profile.click();
      await detail
        .locator("summary")
        .filter({ hasText: /^Gönderiler$/ })
        .click();
      await detail.getByRole("button", { name: "Gönderileri yükle" }).click();
      await detail.getByRole("button", { name: "Sayfa istatistikleri" }).click();
      await expect(detail.getByText("Fixture studio announcement")).toBeVisible();
      await expect(detail.getByText(/240/)).toBeVisible();
      await capture("posts");
      await detail
        .locator("summary")
        .filter({ hasText: /^Gönderiler$/ })
        .click();
      await detail
        .locator("summary")
        .filter({ hasText: /^Canlı video$/ })
        .click();
      await detail.getByRole("button", { name: "Canlı videoyu yükle" }).click();
      await detail.getByRole("button", { name: "Canlı yayın yorumları" }).click();
      await expect(detail.getByText(/When does it begin/)).toBeVisible();
      await capture("live");
      await detail
        .locator("summary")
        .filter({ hasText: /^Canlı video$/ })
        .click();
      await detail
        .locator("summary")
        .filter({ hasText: /^Para kazanma$/ })
        .click();
      await detail.getByRole("button", { name: "Tahmini kazançları oku" }).click();
      await expect(
        detail.getByText("Facebook gelir elde etme verisi döndürmedi.", { exact: true }),
      ).toBeVisible();
      await capture("monetization");
      await detail
        .locator("summary")
        .filter({ hasText: /^Para kazanma$/ })
        .click();
      await detail
        .locator("summary")
        .filter({ hasText: /^Bahsetmeler$/ })
        .click();
      await detail.getByRole("button", { name: "Bahsetmeleri yükle" }).click();
      await expect(
        detail
          .getByRole("region", { name: "Bahsetmeler" })
          .getByText("Fixture studio announcement"),
      ).toBeVisible();
      await capture("mentions");
      await detail
        .locator("summary")
        .filter({ hasText: /^Bahsetmeler$/ })
        .click();
      await detail
        .locator("summary")
        .filter({ hasText: /^Facebook talepleri$/ })
        .click();
      const proposals = detail.getByRole("region", { name: "Facebook talepleri" });
      await proposals.getByRole("button", { name: "Yenile" }).click();
      await expect(proposals.getByText(/More studio workshops/)).toBeVisible();
      await capture("requests");
      await page.keyboard.press("Escape");
      await expect(detail).toBeHidden();

      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Yeni gönderi" });
      await editor.getByRole("checkbox", { name: /Fixture Facebook Page/ }).check();
      await expect(editor.getByLabel("Facebook yayın zamanı")).toBeVisible();
      await capture("composer");
      const destination = editor.getByRole("combobox", { name: "Facebook hedefi" });
      await destination.selectOption("video");
      await capture("composer-video");
      await destination.selectOption("story");
      await expect(editor.getByLabel("Facebook yayın zamanı")).toHaveCount(0);
      await capture("composer-story");
      await page.keyboard.press("Escape");
      await sections(page).getByRole("tab", { name: "Gelen kutusu", exact: true }).click();
      await page.getByRole("button", { name: /Fixture viewer/ }).click();
      await page
        .locator("summary")
        .filter({ hasText: /^Yorum moderasyonu$/ })
        .click();
      await expect(page.getByRole("button", { name: "Özel yanıt gönder" })).toBeVisible();
      await capture("moderation");

      await page.goto(
        "/tests/browser/social/social.html?facebook-page&facebook-browser&signup-create",
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Fixture Facebook Page/ }).click();
      await detail
        .locator("summary")
        .filter({ hasText: /^Profili düzenle$/ })
        .click();
      await expect(detail.getByLabel("Kullanıcı adı", { exact: true })).toBeVisible();
      await capture("browser-profile");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Hesap bağla", exact: true }).click();
      await page.getByRole("button", { name: /^Platform: / }).click();
      await page.getByRole("option", { name: "Facebook", exact: true }).click();
      await page.getByRole("button", { name: /^Nasıl bağlanılacak: / }).click();
      await page.getByRole("option", { name: "Tarayıcıda oturum açma" }).click();
      await page
        .getByRole("button", { name: /Bunun yerine yeni bir Facebook hesabı oluştur/ })
        .click();
      await expect(page.getByRole("dialog").getByLabel("Hakkında", { exact: true })).toBeVisible();
      await capture("signup");
    });
    test(`Facebook profile uploads and chat approval ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      const open = async (member: boolean) => {
        await page.goto(
          `/tests/browser/social/social.html?facebook-page&facebook-profile-controls${member ? "&facebook-member" : ""}`,
        );
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
        const name = member ? "Fixture Facebook Profile" : "Fixture Facebook Page";
        await page.getByRole("button", { name: new RegExp(name) }).click();
        return page.getByRole("dialog", { name });
      };
      const capture = (name: string) =>
        page.screenshot({
          path: `temp/verification/social-facebook/${name}-${theme}-${width}.png`,
          animations: "disabled",
        });
      const photo = {
        name: "owner-cover.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zlll1sAAAAASUVORK5CYII=",
          "base64",
        ),
      };
      const detail = await open(false);
      await detail.locator("summary").filter({ hasText: "Facebook profil fotoğrafları" }).click();
      await detail.getByRole("button", { name: /Facebook fotoğraf türü/ }).click();
      await page.getByRole("option", { name: "Facebook kapak fotoğrafı" }).click();
      await detail.locator('input[type="file"]').setInputFiles(photo);
      await expect(detail.getByText(photo.name)).toBeVisible();
      await capture("page-photo-upload");
      await detail.getByRole("button", { name: "Kaydet", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Facebook kapak fotoğrafı" })
        .getByRole("button", { name: "Kaydet", exact: true })
        .click();
      await expect
        .poll(() => requests(page, "facebook.page.uploadPhoto"))
        .toEqual([
          {
            accountId: "fixture-facebook",
            kind: "cover",
            uploadId: "fixture-image-1",
            confirm: "UPLOAD_FACEBOOK_PAGE_PHOTO",
          },
        ]);
      await detail.locator("summary").filter({ hasText: "Facebook profil fotoğrafları" }).click();
      await detail.locator("summary").filter({ hasText: "Facebook talepleri" }).click();
      await detail.getByRole("button", { name: "Yenile" }).click();
      await detail.getByRole("button", { name: "Sohbet için onayla" }).click();
      await page
        .getByRole("dialog", { name: "Gönderiyi düzenle" })
        .getByRole("button", { name: "Sohbet için onayla" })
        .click();
      await expect(
        detail.getByText("Bu Facebook değişikliğini uygulamak için sohbete dönün."),
      ).toBeVisible();
      await capture("chat-approval");
      const member = await open(true);
      await member.locator("summary").filter({ hasText: "Profili düzenle" }).click();
      const fields = member.getByRole("button", { name: /Profil bilgileri/ });
      await fields.click();
      await page.getByRole("option", { name: "Profil adı" }).click();
      await member.getByLabel("Facebook ikinci ad").fill("Deniz");
      await capture("personal-name");
      await fields.click();
      await page.getByRole("option", { name: "Web sitesi", exact: true }).click();
      await member
        .locator("summary")
        .filter({ hasText: "Facebook'ta zaten bulunan bir değeri değiştir" })
        .click();
      await expect(member.getByLabel(/Facebook’taki mevcut değer/)).toBeVisible();
      await capture("personal-website");
      await fields.click();
      await page.getByRole("option", { name: "Facebook tanıtım bilgileri" }).click();
      await member.getByLabel("Facebook’taki bilgi etiketi").fill("Ankara’da yaşıyor");
      await capture("personal-intro-details");
      await member.locator("summary").filter({ hasText: "Profili düzenle" }).click();
      await member.locator("summary").filter({ hasText: "Facebook profil fotoğrafları" }).click();
      await member
        .locator('input[type="file"]')
        .setInputFiles({ ...photo, name: "owner-avatar.png" });
      await expect(member.getByText("owner-avatar.png")).toBeVisible();
      await capture("personal-photo-upload");
      await member.getByRole("button", { name: "Kaydet", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Facebook profil resmi" })
        .getByRole("button", { name: "Kaydet", exact: true })
        .click();
      await expect(member.getByText("Kaydedildi", { exact: true })).toBeVisible();
    });
  }

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
      await page
        .getByRole("list", { name: "Konuşmalar" })
        .getByRole("button", { name: /Demo ürün sorusu/ })
        .click();
      // Shared MessageTimeline: borderless bubbles, own messages end-aligned, day separators.
      const own = page.locator('[data-message-id][data-own="true"] > div').first();
      await expect(own).toHaveCSS("border-top-width", "0px");
      await expect(page.locator("[data-message-id]:not([data-own]) > div").first()).toHaveCSS(
        "border-top-width",
        "0px",
      );
      await expect(page.getByRole("separator").first()).toBeVisible();
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
        // Below 56rem the days stack in one column: each keeps only its top edge.
        const stacked = await page
          .locator(".content-calendar-grid")
          .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length === 1);
        for (let index = 0; index < (await cells.count()); index++) {
          await expect(cells.nth(index)).toHaveCSS(
            "border-inline-start-width",
            !stacked && index % 7 ? "1px" : "0px",
          );
          await expect(cells.nth(index)).toHaveCSS(
            "border-block-start-width",
            (stacked ? index > 0 : index >= 7) ? "1px" : "0px",
          );
        }
        const today = page.locator(".content-day[data-today]");
        await expect(today).toHaveCount(1);
        const colors = await today.evaluate((node) => {
          const probe = document.createElement("span");
          node.append(probe);
          probe.style.background = "var(--ui-surface-inset, var(--ui-surface-muted))";
          const ground = getComputedStyle(probe).backgroundColor;
          probe.style.background = "var(--ui-tone-accent-solid)";
          const number = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { ground, number };
        });
        // Today is the inset surface role (muted ground), not a custom tint.
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

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    const capture = async (page: Page, surface: string) => {
      await page.screenshot({
        path: `temp/verification/social-tiktok/${surface}-${theme}-${width}.png`,
        animations: "disabled",
      });
    };
    const toggleTheme = (page: Page) =>
      page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );

    test(`TikTok composer visual fixture ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?tiktok");
      await toggleTheme(page);
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Yeni gönderi" });
      await editor.getByText("Demo TikTok", { exact: true }).click();
      await editor
        .getByRole("button", { name: /TikTok gönderi biçimi|TikTok post format/ })
        .click();
      await page.getByRole("option", { name: /^(Fotoğraflar|Photos)$/ }).click();
      await editor
        .getByRole("textbox", { name: /TikTok fotoğraf URL’si|TikTok photo URL/ })
        .fill("https://example.com/tiktok-photo.jpg");
      await editor.getByRole("button", { name: /^(Ekle|Add)$/ }).click();
      const cover = editor.getByText(/TikTok kapak fotoğrafı|TikTok cover photo/);
      await expect(cover).toBeVisible();
      await capture(page, "composer");
      await cover.scrollIntoViewIfNeeded();
      await capture(page, "composer-options");
    });

    test(`TikTok account visual fixture ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?tiktok-browser");
      await toggleTheme(page);
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Demo TikTok/ }).click();
      const detail = page.getByRole("dialog", { name: "Demo TikTok" });
      await detail
        .locator("summary")
        .filter({ hasText: /TikTok araçları|TikTok tools/ })
        .click();
      // Grouped tools: pick the group tab, then the view inside it when the group has several.
      const select = async (group: RegExp, view?: RegExp) => {
        await detail.getByRole("tab", { name: group }).click();
        if (view) await detail.getByRole("radio", { name: view }).click();
      };
      const ACCOUNT = /^(Hesap|Account)$/;
      const INSIGHTS = /^(Analiz|Analizler|Analitik|Analytics)$/;
      const CONVERSATIONS = /^(Konuşmalar|Conversations)$/;
      const expose = async (button: RegExp, result: string | RegExp, surface: string) => {
        await detail.getByRole("button", { name: button }).click();
        const value = detail
          .getByText(result, { exact: typeof result === "string" })
          .filter({ visible: true });
        await expect(value).toBeVisible();
        await value.scrollIntoViewIfNeeded();
        await capture(page, surface);
      };
      await detail.getByRole("button", { name: /Profili oku|Read profile/i }).click();
      await expect(detail.getByRole("textbox", { name: /Kullanıcı adı|Username/i })).toHaveValue(
        "demo.creator",
      );
      await capture(page, "profile");
      await detail
        .getByRole("button", { name: /Profili kaydet|Save profile/i })
        .scrollIntoViewIfNeeded();
      await capture(page, "profile-options");
      await select(ACCOUNT, /^(Gizlilik|Privacy)$/);
      await detail
        .getByRole("button", { name: /Gizlilik ayarlarını oku|Read privacy settings/ })
        .click();
      await expect(
        detail.getByRole("checkbox", { name: /Gizli hesap|Private account/ }),
      ).toBeVisible();
      await capture(page, "privacy");
      await select(INSIGHTS);
      await expose(/Analizleri oku|Read analytics/, "128.450", "analytics");
      await select(INSIGHTS, /^(Kazançlar|Earnings)$/);
      await expose(/Kazançları oku|Read earnings/, "₺ 450,50", "earnings");
      await select(CONVERSATIONS, /^(Yorumlar|Comments)$/);
      await expose(/Yorumları oku|Read comments/, "Yeni video ne zaman geliyor?", "comments");
      await select(CONVERSATIONS, /^(Bahsetmeler|Bahsedilenler|Mentions)$/);
      await expose(/Bahsetmeleri oku|Read mentions/, "Yeni video ne zaman geliyor?", "mentions");
      await select(CONVERSATIONS, /^(Doğrudan mesajlar|Direct messages)$/i);
      await expose(
        /Doğrudan mesajları oku|Read direct messages/,
        "Yeni video ne zaman geliyor?",
        "messages",
      );
      await select(/^(Hedef kitle|Audience)$/, /^(Takipçiler|Followers)$/);
      await expose(/Hedef kitleyi oku|Read audience/, "@demo.fan", "audience");
      await detail.getByRole("button", { name: /^(Takip et|Follow)$/ }).click();
      await detail
        .getByRole("button", { name: /İnceleme için sıraya al|Queue for review/ })
        .click();
      await expect(detail.getByText(/Onay bekliyor|Awaiting approval/)).toBeVisible();
      expect(await requests(page, "tiktok.changes.apply")).toEqual([]);
      await capture(page, "review");
      await detail.getByRole("button", { name: /İncele ve uygula|Review and apply/ }).click();
      const exactReview = page.getByRole("dialog", { name: /^(Takip et|Follow)$/ });
      await expect(exactReview.getByText("@demo.fan", { exact: true })).toBeVisible();
      await capture(page, "confirmation");
      await exactReview.getByRole("button", { name: /^(Takip et|Follow)$/ }).click();
      await expect
        .poll(() => requests(page, "tiktok.changes.apply"))
        .toEqual([{ accountId: "tiktok", reviewId: "review-1", confirm: true }]);
      await select(/^TikTok LIVE$/);
      await expose(
        /Yayın anahtarını kaydet|Save stream key/,
        /Yayın anahtarı bu Host’a kaydedildi|Stream key saved on this Host/,
        "live",
      );
      await select(ACCOUNT, /^TikTok for Business$/);
      await expose(
        /Business API erişimini kontrol et|Check Business API access/,
        /Bu Host’ta TikTok Business API erişimi yok|TikTok Business API access unavailable/,
        "business",
      );
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
      await page.getByRole("button", { name: /Yapay zekâya sor/ }).click();
      await page.screenshot({
        path: `temp/verification/social-extra/editor-ai-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: /Yapay zekâya sor/ }).click();
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
      await expect(page.getByText("Henüz gönderi yok", { exact: true })).toBeVisible();
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
      await expect(page.getByRole("heading", { name: "Henüz konuşma yok" })).toBeVisible();
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

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`Reddit Chat uses the selected browser account ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?reddit-delete&reddit-chat");
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
      }, theme === "light");
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Fixture Reddit/ }).click();
      const account = page.getByRole("dialog", { name: "Fixture Reddit" });
      await account.locator("summary").filter({ hasText: "Doğrudan mesajlar" }).click();
      const open = account.getByRole("button", { name: "Tarayıcıda aç", exact: true });
      await open.click();
      const status = account.getByText("Reddit Chat’te devam edin.", { exact: true });
      await expect(status).toBeVisible();
      await expect(open).toBeDisabled();
      await account.getByRole("button", { name: "Kapat", exact: true }).click();
      await expect(account).toBeHidden();
      await page.getByRole("button", { name: /Fixture Reddit/ }).click();
      await account.locator("summary").filter({ hasText: "Doğrudan mesajlar" }).click();
      await expect(status).toBeVisible({ timeout: 3_000 });
      await expect(open).toBeDisabled();
      await status.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/social-platform-acceptance/reddit-chat-${theme}-${width}.png`,
        animations: "disabled",
      });
      await account.getByRole("button", { name: "İptal", exact: true }).click();
      await expect(account.getByText("İptal edildi", { exact: true })).toBeVisible();
      await expect(open).toBeEnabled();
      expect(
        await page.evaluate(() => {
          const { socialFixtureCalls } = window as unknown as {
            socialFixtureCalls: { args: { method?: string; params?: unknown } }[];
          };
          return socialFixtureCalls
            .filter(({ args }) =>
              ["social.browser.workflow.begin", "social.browser.workflow.cancel"].includes(
                args.method ?? "",
              ),
            )
            .map(({ args }) => args.params);
        }),
      ).toEqual([
        expect.objectContaining({ accountId: "fixture-reddit", intent: "inbox" }),
        { accountId: "fixture-reddit", workflowId: "workflow-0" },
      ]);
    });

    test(`X Chat uses the selected browser account ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?x-browser-delete&x-chat");
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
      }, theme === "light");
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Demo account/ }).click();
      const account = page.getByRole("dialog", { name: "Demo account" });
      await account
        .locator("summary")
        .filter({ hasText: /X işlemleri/i })
        .click();
      await account.getByRole("button", { name: /X'te ne yapmak istiyorsunuz/ }).click();
      await page.getByRole("option", { name: "Doğrudan mesajlar", exact: true }).click();
      const open = account.getByRole("button", { name: "Tarayıcıda aç", exact: true });
      await open.click();
      const status = account.getByText("X tarayıcı penceresinde devam edin.", { exact: true });
      await expect(status).toBeVisible();
      await expect(open).toBeDisabled();
      await account.getByRole("button", { name: "Kapat", exact: true }).click();
      await expect(account).toBeHidden();
      await page.getByRole("button", { name: /Demo account/ }).click();
      await account
        .locator("summary")
        .filter({ hasText: /X işlemleri/i })
        .click();
      await account.getByRole("button", { name: /X'te ne yapmak istiyorsunuz/ }).click();
      await page.getByRole("option", { name: "Doğrudan mesajlar", exact: true }).click();
      await expect(status).toBeVisible({ timeout: 3_000 });
      await expect(open).toBeDisabled();
      await status.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/social-platform-acceptance/x-chat-${theme}-${width}.png`,
        animations: "disabled",
      });
      await account.getByRole("button", { name: "İptal", exact: true }).click();
      await expect(account.getByText("İptal edildi", { exact: true })).toBeVisible();
      await expect(open).toBeEnabled();
      expect(
        await page.evaluate(() => {
          const { socialFixtureCalls } = window as unknown as {
            socialFixtureCalls: { args: { method?: string; params?: unknown } }[];
          };
          return socialFixtureCalls
            .filter(({ args }) =>
              ["social.browser.workflow.begin", "social.browser.workflow.cancel"].includes(
                args.method ?? "",
              ),
            )
            .map(({ args }) => args.params);
        }),
      ).toEqual([
        expect.objectContaining({ accountId: "x", intent: "inbox" }),
        { accountId: "x", workflowId: "workflow-0" },
      ]);
    });

    test(`X billing, actions and publishing ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?x-paid-fixture");
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
      }, theme === "light");
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Demo account/ }).click();
      const account = page.getByRole("dialog", { name: "Demo account" });
      const actions = account.locator("summary").filter({ hasText: /X işlemleri/i });
      await actions.click();
      await expect(
        account
          .getByRole("button", { name: "Analiz", exact: true })
          .or(account.getByRole("button", { name: "Analitik", exact: true })),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/social-x/account-${theme}-${width}.png`,
        animations: "disabled",
      });
      await account.getByRole("button", { name: "Analiz", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/social-x/actions-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await sections(page).getByRole("tab", { name: "İçerik", exact: true }).click();
      await page.getByRole("button", { name: "Yeni gönderi", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Yeni gönderi", exact: true });
      await expect(editor).toBeVisible();
      await editor.getByRole("checkbox", { name: "Demo account" }).check();
      await editor.getByText("X için diğer seçenekler", { exact: true }).click();
      await expect(
        editor.getByRole("textbox", { name: "Alıntılanacak gönderinin kimliği" }),
      ).toBeVisible();
      await editor.getByRole("checkbox", { name: "Anket", exact: true }).check();
      await editor.getByRole("button", { name: "Diziye gönderi ekle", exact: true }).click();
      await editor
        .getByRole("textbox", { name: "Dizideki 2. gönderi", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/social-x/content-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`X browser post deletion ${theme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/social/social.html?x-browser-delete");
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
      }, theme === "light");
      await sections(page).getByRole("tab", { name: "Hesaplar ve Ayarlar" }).click();
      await page.getByRole("button", { name: /Demo account/ }).click();
      const account = page.getByRole("dialog", { name: "Demo account" });
      await account
        .locator("summary")
        .filter({ hasText: /X işlemleri/i })
        .click();
      await expect(account.getByText("Gönderiyi sil", { exact: true })).toBeVisible();
      await account.getByText("Bunun yerine bir gönderi kimliği kullanın", { exact: true }).click();
      await account.getByRole("textbox", { name: "Gönderi kimliği" }).fill("123456789");
      await page.screenshot({
        path: testInfo.outputPath("x-browser-delete-picker.png"),
        animations: "disabled",
      });
      await account.getByRole("button", { name: "İncele", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: "Gönderiyi sil" });
      await expect(confirm.getByText("123456789")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("x-browser-delete.png"),
        animations: "disabled",
      });
      await confirm.getByRole("button", { name: "Sil", exact: true }).click();
      await expect(account.getByText("Uygulandı", { exact: true })).toBeVisible();
    });
  }

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
      await page.getByRole("button", { name: /^Platform: / }).click();
      await page.getByRole("option", { name: "E-posta", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`email-account-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});

for (const width of [800, 1280]) {
  test(`signup verification recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      for (const [scene, platform, instruction] of [
        ["signup-google-expired", "YouTube", "Google kayıt oturumunun süresi doldu."],
        ["signup-google-device", "YouTube", "QR kodunu telefonunuzla tarayın"],
        ["signup-instagram-phone", "Instagram", "Instagram’da cep telefonu numaranızı girin"],
        ["signup-x-welcome", "X", "X’te karşılama adımlarını bitirin"],
      ]) {
        await page.goto(`/tests/browser/social/social.html?signup-create&${scene}`);
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
        await page.getByRole("button", { name: "Hesap bağla", exact: true }).click();
        await page.getByRole("button", { name: /^Platform: / }).click();
        await page.getByRole("option", { name: platform, exact: true }).click();
        await page.getByRole("button", { name: /^Nasıl bağlanılacak: / }).click();
        await page.getByRole("option", { name: "Tarayıcıda oturum açma" }).click();
        await page
          .getByRole("button", { name: `Bunun yerine yeni bir ${platform} hesabı oluştur` })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("İsim").fill("Bycoda");
        await dialog.getByRole("button", { name: "Kayıt penceresini aç" }).click();
        await expect(dialog.getByText(instruction, { exact: false })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Kaydı durdur" })).toBeEnabled();
        await expect(dialog.locator('input[type="password"], input[type="tel"]')).toHaveCount(0);
        await page.screenshot({
          path: `temp/verification/social-platform-acceptance/${scene}-${theme}-${width}.png`,
          animations: "disabled",
        });
      }
    }
  });

  test(`signup provider warnings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      for (const [platform, name, warning] of [
        ["x", "X", "X kayda devam edemedi."],
        ["tiktok", "TikTok", "TikTok, kayıt denemesi sınırına ulaştı."],
      ]) {
        await page.goto("/tests/browser/social/social.html?signup-create&signup-provider-warning");
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
        await page.getByRole("button", { name: "Hesap bağla", exact: true }).click();
        await page.getByRole("button", { name: /^Platform: / }).click();
        await page.getByRole("option", { name, exact: true }).click();
        await page.getByRole("button", { name: /^Nasıl bağlanılacak: / }).click();
        await page.getByRole("option", { name: "Tarayıcıda oturum açma" }).click();
        await page
          .getByRole("button", { name: `Bunun yerine yeni bir ${name} hesabı oluştur` })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("İsim").fill("Bycoda");
        await dialog.getByRole("button", { name: "Kayıt penceresini aç" }).click();
        await expect(dialog.getByText(warning, { exact: false })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Kaydı durdur" })).toBeEnabled();
        if (platform === "tiktok")
          await expect(dialog.getByRole("button", { name: "Devam et", exact: true })).toHaveCount(
            0,
          );
        await page.screenshot({
          path: `temp/verification/social-platform-acceptance/${platform}-signup-warning-${theme}-${width}.png`,
          animations: "disabled",
        });
      }
    }
  });
}

for (const [width, variant] of [
  [1280, ""],
  [800, ""],
  [1280, "signup-limit"],
  [800, "signup-limit"],
  [1280, "signup-network-block"],
  [800, "signup-network-block"],
] as const) {
  const networkBlocked = variant === "signup-network-block";
  const state = networkBlocked ? " with network block" : variant ? " with email sign-up limit" : "";
  test(`owner-assisted signup dialog${state} at ${width}px`, async ({ page }, testInfo) => {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/social/social.html?signup-create${variant ? `&${variant}` : ""}`,
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
      await page.getByRole("button", { name: "Hesap bağla", exact: true }).click();
      await page.getByRole("button", { name: /^Platform: / }).click();
      await page.getByRole("option", { name: "Reddit" }).click();
      await page.getByRole("button", { name: /^Nasıl bağlanılacak: / }).click();
      await page.getByRole("option", { name: "Tarayıcıda oturum açma" }).click();
      await page
        .getByRole("button", { name: "Bunun yerine yeni bir Reddit hesabı oluştur" })
        .click();
      const dialog = page.getByRole("dialog");
      const close = dialog.locator("header").getByRole("button", { name: "Kapat", exact: true });
      await expect(close).toBeEnabled();
      await dialog.getByLabel("İsim").fill("Studio");
      await page.screenshot({
        path: testInfo.outputPath(`signup-start-${theme}.png`),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Kayıt penceresini aç" }).click();
      await expect(close).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Kaydı durdur", exact: true })).toBeEnabled();
      await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
      if (!networkBlocked) {
        await expect(dialog.getByLabel("E-posta adresi")).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`signup-fields-${theme}.png`),
          animations: "disabled",
        });
        await dialog.getByLabel("E-posta adresi").fill("studio@example.com");
        await dialog.getByRole("button", { name: "Devam et" }).click();
      }
      if (variant) {
        await expect(
          dialog.getByRole("status").filter({
            hasText: networkBlocked
              ? "Reddit, ağ güvenliği nedeniyle tarayıcı erişimini engelledi. Daha sonra tekrar deneyin."
              : "Reddit, e-postayla kayıt sınırına ulaştı. Daha sonra tekrar deneyin.",
          }),
        ).toBeVisible();
        await expect(dialog.getByText("İşleminiz bekleniyor", { exact: true })).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "Devam et", exact: true })).toHaveCount(0);
        await expect(
          dialog.getByRole("button", { name: "Kaydı durdur", exact: true }),
        ).toBeEnabled();
        await page.screenshot({
          path: `temp/verification/social-platform-acceptance/reddit-${variant}-${theme}-${width}.png`,
          animations: "disabled",
        });
        if (networkBlocked) {
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.goto(
            "/tests/browser/social/social.html?reddit-delete&reddit-browser-network-block",
          );
          await page.evaluate(
            (light) => document.documentElement.classList.toggle("theme-light", light),
            theme === "light",
          );
          await page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }).click();
          await page.getByRole("button", { name: /Fixture Reddit/ }).click();
          const connection = page.getByRole("region", { name: "Bağlantı", exact: true });
          await connection.getByRole("button", { name: "Bağlantıyı kontrol et" }).click();
          await expect(connection.getByRole("alert")).toContainText("Oturum açılamadı.");
          await connection
            .getByRole("alert")
            .getByRole("button", { name: /^Ayrıntılar/ })
            .click();
          await expect(page.getByLabel("Hata ayrıntıları", { exact: true })).toContainText(
            "Reddit blocked browser access for network security. Try again later.",
          );
          await page.keyboard.press("Escape");
          const accountStatus = page
            .getByRole("dialog", { name: "Fixture Reddit" })
            .locator(".social-detail-status");
          await expect(connection.getByRole("status").filter({ hasText: "Bağlı" })).toHaveCount(0);
          await expect(
            accountStatus.getByRole("img", {
              name: "Hesap durumu: Bağlantı tekrar denenmeli",
              exact: true,
            }),
          ).toHaveCount(1);
          await page.screenshot({
            path: `temp/verification/social-platform-acceptance/reddit-connect-network-block-${theme}-${width}.png`,
            animations: "disabled",
          });
          await connection.getByRole("button", { name: "Bağlantıyı kontrol et" }).click();
          await expect(connection.getByRole("status").filter({ hasText: "Bağlı" })).toHaveCount(1);
          await expect(accountStatus.getByRole("img", { name: /^Hesap durumu: / })).toHaveCount(0);
          await expect(connection.getByRole("alert")).toHaveCount(0);
        }
        continue;
      }
      await expect(dialog.getByText("Doğrulama kodunu gir")).toHaveCount(1);
      await expect(
        dialog.getByText(
          "Aşağıda belirtilenleri platform penceresinde tamamlayın. Sonra burada Devam et’e tıklayın.",
        ),
      ).toBeVisible();
      await expect(dialog.getByText(/parola|koşul kabulü/i)).toHaveCount(0);
      await expect(dialog.getByLabel("E-posta adresi")).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`signup-blockers-${theme}.png`),
        animations: "disabled",
      });
      await page.evaluate(() =>
        (
          window as unknown as { socialFixtureCloseSignupWindow: () => void }
        ).socialFixtureCloseSignupWindow(),
      );
      await expect(dialog.getByRole("button", { name: "Girişe devam et" })).toBeVisible({
        timeout: 8000,
      });
      await expect(close).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`signup-closed-${theme}.png`),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Girişe devam et" }).click();
      await expect(page.getByRole("dialog", { name: "Studio" })).toBeVisible();
    }
  });
}

test("automatic audience list stays on one line with its hint", async ({ page }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?automatic-list");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Hedef kitle", exact: true }).click();
      // The automatic list carries a lightning icon with the "Otomatik" hint instead of a text tag.
      const row = page.getByRole("button", { name: "Yorumcular", exact: true });
      await expect(row).toBeVisible();
      const bounds = await row.boundingBox();
      expect(bounds!.height).toBeLessThanOrEqual(36);
      await row.hover();
      await expect(page.getByRole("tooltip", { name: "Otomatik" })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`audience-badge-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});

// Assertions below use the Turkish catalog, so every test starts in Turkish.
test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(
    (locale) => localStorage.setItem("bycoda.language", locale),
    testInfo.title.startsWith("Snapchat ") ? "en" : "tr",
  );
});

test("empty reply rules explain themselves once without a review button", async ({
  page,
}, testInfo) => {
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
      // With no rules there is nothing to review, so the control is absent and the sentence stands alone.
      await expect(review).toHaveCount(0);
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
  await expect(page.getByRole("textbox", { name: "Yapay zekâya sor" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sizi bekliyor" })).toBeVisible();
  await expect(page.getByText("AI etkinliği yüklenemedi.")).toHaveCount(0);
  await expect(page.getByText("Bekleyen işler yüklenemedi.")).toHaveCount(0);

  const screens: [string, () => ReturnType<Page["getByRole"]>][] = [
    ["İçerik", () => page.getByRole("button", { name: "Yeni gönderi" })],
    ["Hedef kitle", () => page.getByRole("tabpanel", { name: "Kişiler" })],
    ["Gelen kutusu", () => page.getByRole("searchbox", { name: "Konuşmalarda ara" })],
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
    await expect(page.getByRole("textbox", { name: "Yapay zekâya sor" })).toBeHidden();
  }

  // Keyboard: Home, ArrowRight and End move focus and selection along the strip.
  await nav.getByRole("tab", { name: "Hesaplar ve Ayarlar" }).focus();
  await page.keyboard.press("Home");
  await expect(nav.getByRole("tab", { name: "Komut" })).toBeFocused();
  await expect(nav.getByRole("tab", { name: "Komut" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Yapay zekâya sor" })).toBeVisible();
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
  const input = page.getByRole("textbox", { name: "Yapay zekâya sor" });
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
  // The shell button is named by its visible state; the stop action is its tooltip.
  await page.getByRole("button", { name: "AI etkin", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tüm AI durdurulsun mu?" });
  await expect(dialog).toBeVisible();
  // Nothing is stopped while the confirmation is open.
  expect(await requests(page, "ai.stop")).toEqual([]);
  await dialog.getByRole("button", { name: "Tüm AI işlemlerini durdur" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("AI durduruldu", { exact: true })).toBeVisible();
  // The shell button is named by its state again; resuming is its tooltip.
  await expect(page.getByRole("button", { name: "AI durduruldu", exact: true })).toBeVisible();
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
    inbox.getByText("Yeni konuşmaları kontrol etmek için bir hesap bağlayın."),
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
  const sending = page.getByRole("group", { name: "Onaylı gönderimler" });
  const enable = sending.getByRole("button", { name: "Etkinleştir" });
  await expect(enable).toBeEnabled();
  // Enabling asks for confirmation first; cancelling sends nothing to the Host.
  await enable.click();
  const confirm = page.getByRole("dialog", { name: "Onaylı gönderimler açılsın mı?" });
  await expect(confirm.getByRole("button", { name: "Onaylı gönderimleri aç" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();

  await page.getByRole("button", { name: /Demo account/ }).click();
  const detail = page.getByRole("dialog", { name: "Demo account" });
  await detail.locator("summary").filter({ hasText: "Bağlantı gerekli" }).click();
  const capabilities = detail.getByRole("list", { name: "Bu hesabın yapabilecekleri" });
  // The "Connection needed" group names the state once; each row only carries its unavailable mark.
  const publishRow = capabilities.getByRole("listitem").filter({ hasText: "Yayın" }).first();
  await expect(publishRow).toHaveAttribute("data-available", "false");
  await expect(publishRow.getByRole("img", { name: "Kullanılamıyor" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Tarayıcıda bağla", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  // The confirmation was dismissed; nothing was sent to the Host.
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
  // Each item has its own remove button (catalog "Kaldır: {p0}"); nothing removes the batch at once.
  const status = page.getByRole("status", { name: "Eklerin türleri" });
  await page.getByRole("button", { name: "Kaldır: one.png", exact: true }).click();
  await expect(status).toHaveText("image,video");
  await page.getByRole("button", { name: "Kaldır: two.png", exact: true }).click();
  await expect(status).toHaveText("video");
  await page.getByRole("button", { name: "Kaldır: demo.mp4", exact: true }).click();
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
        ["Gelen kutusunu otomatik yenile", "inbox-settings"],
        ["AI modeli", "ai-model"],
      ] as const) {
        // The inbox setting is a single switch row, not a region of its own.
        if (name === "inbox-settings") {
          const toggle = page.getByRole("switch", { name: label, exact: true });
          await toggle.scrollIntoViewIfNeeded();
          await expect(toggle).toBeVisible();
          await capture(name);
          continue;
        }
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
          // No rules: nothing to review, so there is no review button.
          await expect(
            region.getByRole("button", { name: "Kuralları AI ile gözden geçir", exact: true }),
          ).toHaveCount(0);
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
      await connect.getByRole("button", { name: /^Platform: / }).click();
      await page.getByRole("option", { name: "E-posta", exact: true }).click();
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

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`social project account requests ${theme} ${width}`, async ({ page }) => {
      const shot = (name: string) =>
        page.screenshot({
          path: `temp/verification/2026-11-15-social-account-requests/${name}-${theme}-${width}.png`,
          animations: "disabled",
        });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/social/social.html?requests");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const rows = page.locator(".account-request-row");
      await expect(rows).toHaveCount(2);
      await expect(rows.getByText("Demo project")).toHaveCount(2);
      await shot("waiting");
      await rows.first().getByRole("button", { name: "Hesap oluştur", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot("approve-create");
      expect(await requests(page, "accounts.requests.approve")).toEqual([
        { id: "request-linkedin", mode: "create" },
      ]);
      // The approved account is reused: the dialog never creates a second record.
      expect(await requests(page, "accounts.create")).toEqual([]);
      // Approving opens the signup window at once; leaving cancels it and opens the new account.
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Kaydı durdur", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await shot("account-opened");
      await page.keyboard.press("Escape");
      await sections(page).getByRole("tab", { name: "Komut", exact: true }).click();
      await expect(rows).toHaveCount(1);
      await rows
        .first()
        .getByRole("button", { name: "Zaten bir hesabım var", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: "Hesaplar ve Ayarlar", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(await requests(page, "accounts.requests.approve")).toEqual([
        { id: "request-linkedin", mode: "create" },
        { id: "request-x", mode: "signin" },
      ]);
      await shot("approve-signin");
    });
  }

import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const output = "temp/verification/assistant-interview-language-20261113";
const longQuestion =
  "When you are concentrating on implementation and several projects need attention, how should your assistant speak to you? Consider routine progress, completed work and questions that block a job. You can ask for a brief spoken summary when you return, immediate interruption for decisions, or quiet updates you review later. Tell me which information matters most, whether project names should be spoken aloud, and how much detail you want when an error needs your attention.";
const options = [
  "Keep routine progress silent while I am concentrating; speak only when a decision blocks a job or something needs attention.",
  "Summarize completed work when I return, including project names, next actions and the decisions still waiting for me.",
  "Use Turkish for spoken replies and retain the original English technical names, filenames and error messages.",
  "Ask one short question at a time and wait for my answer before moving to another topic or changing preferences.",
  "Read the requested result first, then let me ask for implementation details instead of narrating every operation.",
  "When I explicitly ask for more detail, explain it fully; keep ordinary updates brief enough to hear without interruption.",
];
async function resolve(page: Page, value: unknown) {
  await page.evaluate((result) => (window as any).interviewFixture.resolve(result), value);
}
async function requestCount(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => (window as any).interviewFixture.requests.length))
    .toBe(count);
}
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`interview real controls and worst case ${theme} ${width}`, async ({ page }) => {
      await mkdir(output, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/interview-redesign.html?theme=${theme}&data=worst`);
      const capture = async (state: string) => {
        await expect(page.getByRole("dialog")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: `${output}/${theme}-${width}-${state}.png` });
      };
      await expect(
        page.getByText("Asistanınızın ne yapmasını veya neyi değiştirmesini istersiniz?"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Finish and show preview" })).toBeDisabled();
      await requestCount(page, 0);
      await capture("initial");
      const answer = page.getByRole("textbox", { name: "Your answer" });
      await answer.fill("Preserve this draft");
      await page.getByRole("button", { name: "Language: Türkçe" }).click();
      await page.getByRole("option", { name: "English", exact: true }).click();
      await expect(
        page.getByText("What would you like your assistant to do or change?"),
      ).toBeVisible();
      await expect(answer).toHaveValue("Preserve this draft");
      await requestCount(page, 0);
      await capture("language-override");
      await answer.fill("Keep spoken replies brief.\nUse Turkish, preserving technical names.");
      await answer.press("Shift+Enter");
      await requestCount(page, 0);
      await page.getByRole("button", { name: "Send answer", exact: true }).click();
      await requestCount(page, 1);
      expect(await page.evaluate(() => (window as any).interviewFixture.requests[0].locale)).toBe(
        "en-US",
      );
      await expect(page.getByText("Thinking…", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop waiting", exact: true })).toBeVisible();
      await capture("pending");
      await resolve(page, { kind: "question", question: longQuestion, options });
      await expect(page.getByRole("button", { name: options[0], exact: true })).toBeVisible();
      await capture("quick-answers-worst");
      await page.getByRole("button", { name: options[0], exact: true }).click();
      await requestCount(page, 2);
      await page.evaluate(() =>
        (window as any).interviewFixture.reject("Provider authentication expired."),
      );
      await expect(page.getByText(/Provider authentication expired/)).toBeVisible();
      await capture("error");
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await requestCount(page, 3);
      await resolve(page, {
        kind: "proposal",
        summary: "Your current voice preferences already match this request.",
        profile: { name: "Arif", language: "Turkish", tone: "friendly" },
      });
      await expect(
        page.getByText("The proposal matches your current settings. Nothing to change."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Apply to settings" })).toBeDisabled();
      await capture("unchanged");
      await page.getByRole("button", { name: "Back to questions" }).click();
      await answer.fill("Call yourself Aleksandra Wiśniewska-Kowalczyk.");
      await page.getByRole("button", { name: "Send answer", exact: true }).click();
      await requestCount(page, 4);
      await resolve(page, {
        kind: "proposal",
        summary: "Short Turkish voice replies with the new assistant name.",
        profile: { name: "Aleksandra Wiśniewska-Kowalczyk" },
      });
      await expect(page.getByRole("button", { name: "Apply to settings" })).toBeEnabled();
      await capture("changed");
      await page.getByRole("button", { name: "Apply to settings" }).click();
      expect(await page.evaluate(() => (window as any).interviewApplied)).toEqual({
        name: "Aleksandra Wiśniewska-Kowalczyk",
      });
      expect(errors).toEqual([]);
    });

test("language switch regenerates current question and preserves unsent draft and answers", async ({
  page,
}) => {
  await page.goto("/tests/browser/assistant/interview-redesign.html?theme=dark");
  const answer = page.getByRole("textbox", { name: "Your answer" });
  await answer.fill("Keep voice replies short.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await requestCount(page, 1);
  await resolve(page, { kind: "question", question: "Hangi ses?", options: ["Sakin"] });
  await answer.fill("Keep this unsent detail");
  await page.getByRole("button", { name: "Language: Türkçe" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await requestCount(page, 2);
  await expect(page.getByRole("button", { name: "Sakin", exact: true })).toHaveCount(0);
  await expect(answer).toHaveValue("Keep this unsent detail");
  expect(await page.evaluate(() => (window as any).interviewFixture.requests[1])).toMatchObject({
    locale: "en-US",
    current: { language: "Turkish" },
    transcript: [
      expect.objectContaining({ role: "assistant" }),
      { role: "owner", text: "Keep voice replies short." },
    ],
  });
  await resolve(page, { kind: "question", question: "Which voice?", options: ["Calm"] });
  await expect(page.getByText("Which voice?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Calm", exact: true })).toBeVisible();
  await expect(page.getByText("Keep voice replies short.", { exact: true })).toBeVisible();
});

test("cancel fences a late proposal and retains conversation for continuation", async ({
  page,
}) => {
  await page.goto("/tests/browser/assistant/interview-redesign.html?theme=dark");
  await page.getByRole("textbox", { name: "Your answer" }).fill("Keep voice replies short.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await requestCount(page, 1);
  await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
  await resolve(page, { kind: "proposal", summary: "Late result", profile: { name: "Late" } });
  await expect(page.getByText("Late result", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Keep voice replies short.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish and show preview" })).toBeEnabled();
});

test("long quick answers remain reachable in a 320px panel", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/tests/browser/assistant/interview-redesign.html?theme=dark&data=worst");
  await page.getByRole("textbox", { name: "Your answer" }).fill("Short voice updates.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await requestCount(page, 1);
  await resolve(page, { kind: "question", question: longQuestion, options });
  const quickAnswers = page.getByRole("group", { name: "Quick answers" });
  await expect(quickAnswers).toBeVisible();
  expect(await quickAnswers.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await quickAnswers.getByRole("button", { name: options[0], exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText(options[0]!);
  await page.screenshot({ path: `${output}/dark-320-quick-answers-worst.png` });
});

test("interview remains usable with doubled root text size", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tests/browser/assistant/interview-redesign.html?theme=light");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const answer = page.getByRole("textbox", { name: "Your answer" });
  await answer.fill("Keep technical names unchanged: Đặng Thị Ngọc Hân, 王秀英, نور الهدى.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await requestCount(page, 1);
  await expect(page.getByRole("button", { name: "Stop waiting", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${output}/light-1280-double-text.png` });
});

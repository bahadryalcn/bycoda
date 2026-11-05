import { expect, test, type Page, type TestInfo } from "@playwright/test";
const captureRoot =
  process.env.BYCODA_APPROVAL_VERIFICATION_DIR ?? "temp/verification/question-flow";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`fixed choices retain additional notes at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/question-flow.html?theme=${theme}&variant=choices`);
      const form = page.locator("[data-question-form]");
      await form.getByRole("radio", { name: /Windows and macOS/ }).check();
      const note = form.getByRole("textbox", { name: "Additional note (optional)", exact: true });
      const text =
        "Keep existing drafts.\nTürkçe not: seçenek aynı kalsın; klavye desteği korunsun.";
      await note.fill(text);
      await page.getByRole("button", { name: "Hide question", exact: true }).click();
      await page.getByRole("button", { name: "Show question", exact: true }).click();
      await expect(note).toHaveValue(text);
      await expect(form.getByRole("radio", { name: /Windows and macOS/ })).toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await form.screenshot({ path: `${captureRoot}/question-note-${theme}-${width}.png` });
      await form.locator('button[type="submit"]').click();
      await expect(note).toHaveAttribute("readonly", "");
      await page.getByRole("button", { name: "Confirm delivery", exact: true }).click();
      const card = page.locator("[data-question-answer]");
      await expect(card).toContainText("Windows and macOS");
      await expect(card).toContainText("Türkçe not: seçenek aynı kalsın; klavye desteği korunsun.");
      await card.locator(".user-message-row").hover();
      const actions = card.locator(".user-message-actions");
      await expect(actions).toHaveCSS("opacity", "1");
      await actions.getByRole("button", { name: "Copy message", exact: true }).focus();
      await expect(actions).toHaveCSS("opacity", "1");
      const bounds = await actions.evaluate((node) => ({
        bottom: node.getBoundingClientRect().bottom,
        rowBottom: node.closest(".user-message-row")!.getBoundingClientRect().bottom,
      }));
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.rowBottom);
      await card.screenshot({ path: `${captureRoot}/question-answer-note-${theme}-${width}.png` });
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1100]) {
    test(`question lifecycle preserves answers at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/question-flow.html?theme=${theme}`);
      const form = page.locator("[data-question-form]");
      await expect(form.getByRole("status")).toHaveText("Waiting for your answer");
      await page.screenshot({
        path: `${captureRoot}/${test.info().project.name}-legacy-free-answer-${theme}-${width}.png`,
        fullPage: true,
      });
      const answer = form.getByRole("textbox", { name: "Type your answer" });
      await answer.fill("Windows and macOS.\nKeep unfinished drafts and keyboard navigation.");
      await page.getByRole("button", { name: "Hide question", exact: true }).click();
      await page.getByRole("button", { name: "Show question", exact: true }).click();
      await expect(answer).toHaveValue(
        "Windows and macOS.\nKeep unfinished drafts and keyboard navigation.",
      );
      await page.getByRole("button", { name: "Switch session", exact: true }).click();
      await expect(answer).toHaveValue("");
      await page.getByRole("button", { name: "Switch session", exact: true }).click();
      await expect(answer).toHaveValue(
        "Windows and macOS.\nKeep unfinished drafts and keyboard navigation.",
      );
      await page.getByRole("button", { name: "Toggle continuing work", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText(
        "Work may continue while this question is open",
      );
      // Behavior is part of the actual semantic request key. Switching it must
      // not lend an old answer to a different lineage, even with the same ID.
      await expect(answer).toHaveValue("");
      await expect(form.getByRole("button", { name: "Send answer", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Toggle continuing work", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText("Waiting for your answer");
      await expect(answer).toHaveValue(
        "Windows and macOS.\nKeep unfinished drafts and keyboard navigation.",
      );
      await page.getByRole("button", { name: "Toggle continuing work", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText(
        "Work may continue while this question is open",
      );
      await expect(answer).toHaveValue("");
      await expect(page.getByLabel("Send count")).toHaveText("0");
      const continuingAnswer =
        "Windows and macOS.\nNew answer for continuing work; keep unfinished drafts and keyboard navigation.";
      await answer.fill(continuingAnswer);
      const send = form.getByRole("button", {
        name: "Send answer",
        exact: true,
      });
      await expect(send).toBeEnabled();
      await send.focus();
      await expect(send).toBeFocused();
      await send.press("Enter");
      await expect(page.getByLabel("Send count")).toHaveText("1");
      await expect(form.getByRole("status")).toHaveText("Sending answer…");
      const submit = form.locator('button[type="submit"]');
      await expect(submit).toHaveText("Sending answer…");
      await expect(submit).toHaveAttribute("aria-busy", "true");
      await expect(submit).toBeFocused();
      await expect(
        form.getByRole("button", { name: "Cancel question", exact: true }),
      ).not.toHaveAttribute("aria-busy", "true");
      await form.screenshot({
        path: `${captureRoot}/${test.info().project.name}-legacy-question-sending-${theme}-${width}.png`,
      });
      await expect(form.locator('button[type="submit"]')).toHaveAttribute("aria-disabled", "true");
      await form
        .locator("form")
        .evaluate((node) =>
          node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      await expect(page.getByLabel("Send count")).toHaveText("1");
      await page.getByRole("button", { name: "Queue answer", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText("Answer saved · waiting to continue");
      await expect(submit).toHaveText("Waiting");
      await expect(submit).toBeDisabled();
      await expect(form.locator('[aria-busy="true"]')).toHaveCount(0);
      await form.screenshot({
        path: `${captureRoot}/${test.info().project.name}-legacy-question-queued-${theme}-${width}.png`,
      });
      await page
        .getByRole("button", {
          name: "Simulate uncertain delivery",
          exact: true,
        })
        .click();
      await expect(form.getByRole("alert")).toContainText("could not be confirmed");
      await expect(form.locator('button[type="submit"]')).toBeDisabled();
      await expect(answer).toHaveValue(continuingAnswer);
      await expect(answer).toHaveAttribute("readonly", "");
      await expect(answer).toBeEnabled();
      await answer.focus();
      await expect(answer).toBeFocused();
      await page.screenshot({
        path: `${captureRoot}/${test.info().project.name}-legacy-unknown-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Simulate not sent", exact: true }).click();
      await expect(form.getByRole("alert")).toContainText("Your answer is kept");
      await expect(answer).not.toHaveAttribute("readonly", "");
      const retry = form.getByRole("button", {
        name: "Send again",
        exact: true,
      });
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(page.getByLabel("Send count")).toHaveText("2");
      await expect(submit).toHaveAttribute("aria-busy", "true");
      await page.getByRole("button", { name: "Confirm delivery", exact: true }).click();
      const card = page.locator("[data-question-answer]");
      await expect(card).toContainText("Answered");
      await expect(card).toContainText("Windows and macOS");
      await expect(card.locator(".user-message-bubble")).toHaveCount(0);
      const answerRows = card.locator(".user-message-row");
      for (const row of await answerRows.all()) {
        await row.hover();
        const actions = row.locator(".user-message-actions");
        await expect(actions).toHaveCSS("opacity", "1");
        const bounds = await row.evaluate((node) => {
          const row = node.getBoundingClientRect();
          const actions = node.querySelector(".user-message-actions")!.getBoundingClientRect();
          const content = node
            .querySelector(".user-message-hover-zone")!
            .firstElementChild!.getBoundingClientRect();
          return {
            rowBottom: row.bottom,
            actionTop: actions.top,
            actionBottom: actions.bottom,
            contentBottom: content.bottom,
          };
        });
        expect(bounds.actionTop).toBeGreaterThanOrEqual(bounds.contentBottom);
        expect(bounds.actionBottom).toBeLessThanOrEqual(bounds.rowBottom);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      await page.screenshot({
        path: `${captureRoot}/${test.info().project.name}-legacy-answered-${theme}-${width}.png`,
        fullPage: true,
      });
      await card.screenshot({
        path: `${captureRoot}/${test.info().project.name}-legacy-question-answer-${theme}-${width}.png`,
      });
    });
  }
}

async function decisionCapture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await testInfo.attach(`${name}-theme`, {
    contentType: "application/json",
    body: JSON.stringify(
      await page.evaluate(() => {
        const field = document.querySelector("[data-decision-surface] textarea");
        const main = document.querySelector("main");
        const dialog = document.querySelector('[role="dialog"][aria-label="Notifications"]');
        const role = (node: Element | null) =>
          node
            ? {
                background: getComputedStyle(node).backgroundColor,
                color: getComputedStyle(node).color,
              }
            : null;
        return {
          light: document.documentElement.classList.contains("theme-light"),
          page: role(main),
          field: role(field),
          dialog: role(dialog),
        };
      }),
    ),
  });
  await page.screenshot({
    path: `${captureRoot}/${testInfo.project.name}-${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`actual question capacity preserves originals and refuses new input at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/question-flow.html?theme=${theme}&capacity`);
      const surface = page.getByRole("region", {
        name: "Actual question surface",
      });
      const answer = surface.getByRole("textbox", {
        name: "Type your answer",
        exact: true,
      });
      const sends = page.getByLabel("Decision send count", { exact: true });
      await expect(answer).toHaveValue("");
      await expect(surface.getByRole("alert")).toBeVisible();
      expect(
        await answer.evaluate((field: HTMLTextAreaElement) => field.readOnly || field.disabled),
      ).toBe(true);
      await answer.evaluate((field) => field.focus());
      await page.keyboard.type("must not be accepted");
      await expect(answer).toHaveValue("");
      await expect(sends).toHaveText("0");
      await page.getByRole("button", { name: "Capture actual drafts", exact: true }).click();
      const captured = page.getByLabel("Captured question data", {
        exact: true,
      });
      await expect(captured).not.toBeEmpty();
      const retained = JSON.parse((await captured.textContent())!) as {
        snapshot: {
          source?: string;
          prompt?: { requestId: number };
          draft?: { custom: Record<string, string> };
        };
      }[];
      expect(
        retained.filter((entry) => entry.snapshot.source === "retained-question-draft"),
      ).toHaveLength(64);
      expect(
        retained.find((entry) => entry.snapshot.prompt?.requestId === 1000)?.snapshot.draft?.custom
          .answer,
      ).toBe("  Original retained answer\r\n漢🦀\n");
      await decisionCapture(page, testInfo, `question-capacity-refused-${theme}-${width}`);

      await page
        .getByRole("button", {
          name: "Open first retained answer",
          exact: true,
        })
        .click();
      await expect(answer).toHaveValue("  Original retained answer\n漢🦀\n");
      await expect(answer).toBeEditable();
      await page.getByRole("button", { name: "Unmount question", exact: true }).click();
      await expect(surface.locator("textarea")).toHaveCount(0);
      await page.getByRole("button", { name: "Remount question", exact: true }).click();
      await expect(answer).toHaveValue("  Original retained answer\n漢🦀\n");
      await decisionCapture(page, testInfo, `question-original-restored-${theme}-${width}`);

      await page.getByRole("button", { name: "Open new question", exact: true }).click();
      await expect(surface.getByRole("alert")).toBeVisible();
      await page
        .getByRole("button", {
          name: "Release one retained draft",
          exact: true,
        })
        .click();
      await expect(answer).toBeEditable();
      await answer.fill("  New answer after explicit release\n漢🦀\n");
      await expect(sends).toHaveText("0");
      await decisionCapture(page, testInfo, `question-capacity-released-${theme}-${width}`);
      await answer.focus();
      await answer.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(2, 12));
      await page.evaluate(() => {
        const observed = window as typeof window & {
          decisionFixtureCopyEvents?: number;
        };
        observed.decisionFixtureCopyEvents = 0;
        document.addEventListener("copy", () => {
          observed.decisionFixtureCopyEvents = (observed.decisionFixtureCopyEvents ?? 0) + 1;
        });
      });
      await page
        .getByRole("button", {
          name: "Close actual Parent admission",
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Parent gate state", { exact: true })).toHaveText("closed");
      await expect(answer).toHaveAttribute("readonly", "");
      await expect(answer).toBeEnabled();
      expect(
        await answer.evaluate((field: HTMLTextAreaElement) => [
          field.selectionStart,
          field.selectionEnd,
        ]),
      ).toEqual([2, 12]);
      await answer.focus();
      await expect(answer).toBeFocused();
      await page.keyboard.press("ControlOrMeta+C");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as typeof window & { decisionFixtureCopyEvents?: number })
                .decisionFixtureCopyEvents,
          ),
        )
        .toBe(1);
      await answer.press("X");
      await expect(answer).toHaveValue("  New answer after explicit release\n漢🦀\n");
      await expect(surface.locator('button[type="submit"]')).toBeDisabled();
      await surface
        .locator("form")
        .evaluate((form) =>
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      await expect(sends).toHaveText("0");
      await decisionCapture(page, testInfo, `question-closed-copyable-${theme}-${width}`);
      await page
        .getByRole("button", {
          name: "Reopen actual Parent admission",
          exact: true,
        })
        .click();
      await expect(answer).toBeEditable();
      await expect(answer).toHaveValue("  New answer after explicit release\n漢🦀\n");
      await answer.fill("Original reopened answer");
      await expect(sends).toHaveText("0");
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`actual approval intent survives pending unmount and uncertain callback at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/question-flow.html?theme=${theme}&approval`);
      const notices = page.getByRole("button", {
        name: "Notifications",
        exact: true,
      });
      const sheet = page.getByRole("dialog", {
        name: "Notifications",
        exact: true,
      });
      const calls = page.getByLabel("Approval callback count", { exact: true });
      const settlements = page.getByLabel("Approval callback settlements", {
        exact: true,
      });
      const gate = page.getByLabel("Approval gate state", { exact: true });
      const transcript = page.getByRole("region", {
        name: "Actual approval transcript",
        exact: true,
      });
      await expect(transcript.locator(".agent-transcript")).toHaveCount(1);
      await notices.click();
      await expect(sheet).toContainText("Synthetic fixture effect 72");
      const allow = sheet.getByRole("button", { name: "Allow", exact: true });
      await allow.focus();
      await allow.press("Enter");
      await expect(calls).toHaveText("1");
      await expect(settlements).toHaveText("0");
      await expect(allow).toHaveAttribute("aria-busy", "true");
      await expect(allow).toBeFocused();
      await decisionCapture(page, testInfo, `approval-original-pending-${theme}-${width}`);

      // Actual sheet dismissal unmounts the card; the central original work must remain.
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect(
        transcript.getByRole("button", { name: "Allow", exact: true }).last(),
      ).toHaveAttribute("aria-busy", "true");
      await expect(
        transcript.getByRole("button", { name: "Allow", exact: true }).last(),
      ).toBeDisabled();
      await decisionCapture(page, testInfo, `approval-pending-transcript-${theme}-${width}`);
      await page
        .getByRole("button", {
          name: "Close actual approval Parent admission",
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Approval original source ready", { exact: true })).toHaveText(
        "ready",
      );
      await page
        .getByRole("button", {
          name: "Attempt another approval through central hook",
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Approval fixture feedback", { exact: true })).toHaveText(
        "Fresh callback returned false",
      );
      await expect(calls).toHaveText("1");
      await expect(settlements).toHaveText("0");
      await expect(gate).toHaveText("closing");
      await notices.click();
      await expect(allow).toHaveAttribute("aria-busy", "true");
      await expect(allow).toBeDisabled();
      await expect(sheet.getByRole("button", { name: "Deny", exact: true })).toBeDisabled();
      await decisionCapture(page, testInfo, `approval-pending-remounted-closed-${theme}-${width}`);

      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Reject original callback", exact: true }).click();
      await expect(settlements).toHaveText("1");
      await expect(gate).toHaveText("closed");
      await expect(calls).toHaveText("1");
      const captured = page.getByLabel("Captured approval data", {
        exact: true,
      });
      await expect(captured).toContainText('"providerAck":"unproved"');
      await expect(captured).toContainText('"requestId":72');
      await expect(captured).toContainText('"allow"');
      const actualInputs = JSON.parse((await captured.textContent())!) as {
        sessionId?: string;
        snapshot: {
          surface?: string;
          records?: {
            decision: string;
            phase: string;
            callback: string;
            providerAck: string;
            repeatBlocked: boolean;
            original: {
              session: { id: string };
              request: { approval?: { requestId: number } };
            };
          }[];
        };
      }[];
      const profile = actualInputs.find(
        (entry) => entry.snapshot.surface === "approval-decisions",
      )!;
      expect(Object.hasOwn(profile, "sessionId")).toBe(false);
      const original = profile.snapshot.records!.find(
        (record) => record.original.request.approval?.requestId === 72,
      )!;
      expect(original).toMatchObject({
        decision: "allow",
        phase: "uncertain",
        callback: "rejected",
        providerAck: "unproved",
        repeatBlocked: true,
      });
      expect(original.original.session.id).toBe("fixture-decision-approval-session");
      await notices.click();
      await expect(
        sheet.locator('.approval-toast [role="status"][aria-live="polite"]'),
      ).toBeVisible();
      await expect(sheet.getByRole("alert")).toHaveCount(0);
      await expect(allow).toBeDisabled();
      await decisionCapture(
        page,
        testInfo,
        `approval-uncertain-original-retained-${theme}-${width}`,
      );

      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await decisionCapture(page, testInfo, `approval-uncertain-transcript-${theme}-${width}`);
      await page
        .getByRole("button", {
          name: "Reopen actual approval Parent admission",
          exact: true,
        })
        .click();
      await notices.click();
      await expect(allow).toBeDisabled();
      await expect(calls).toHaveText("1");
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      // A new provider occurrence is distinct from retrying an uncertain original decision.
      await page
        .getByRole("button", {
          name: "Simulate original provider resolution",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Simulate a new provider request",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Arm source replacement before next dispatch",
          exact: true,
        })
        .click();
      await notices.click();
      await expect(sheet).toContainText("Synthetic fixture effect 73");
      await expect(allow).toBeEnabled();
      await allow.click();
      await expect(sheet.getByRole("alert")).toBeVisible();
      await expect(calls).toHaveText("1");
      await expect(settlements).toHaveText("1");
      await decisionCapture(page, testInfo, `approval-stale-source-refused-${theme}-${width}`);
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Refresh current request source",
          exact: true,
        })
        .click();
      // The actual retained portal must receive the source/dispatch context
      // through AgentTranscript itself, as in the production pooled pane.
      const pooledAllow = transcript.getByRole("button", { name: "Allow", exact: true }).last();
      await expect(pooledAllow).toBeEnabled();
      await pooledAllow.click();
      await expect(calls).toHaveText("2");
      await expect(pooledAllow).toHaveAttribute("aria-busy", "true");
      await expect(pooledAllow).toBeDisabled();
      await page.getByRole("button", { name: "Complete new callback", exact: true }).click();
      await expect(settlements).toHaveText("2");
      await notices.click();
      await expect(
        sheet.locator('.approval-toast [role="status"][aria-live="polite"]'),
      ).toBeVisible();
      await expect(sheet.getByRole("alert")).toHaveCount(0);
      await expect(allow).toBeDisabled();
      await expect(page.getByLabel("Approval callback identities", { exact: true })).toHaveText(
        '[{"requestId":72,"decision":"allow"},{"requestId":73,"decision":"allow"}]',
      );
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Capture actual approval data",
          exact: true,
        })
        .click();
      await expect(captured).toContainText('"requestId":73');
      const latestInputs = JSON.parse((await captured.textContent())!) as typeof actualInputs;
      const latest = latestInputs
        .find((entry) => entry.snapshot.surface === "approval-decisions")!
        .snapshot.records!.find(
          (record) =>
            record.original.request.approval?.requestId === 73 && record.callback === "fulfilled",
        )!;
      expect(latest).toMatchObject({
        decision: "allow",
        phase: "unconfirmed",
        callback: "fulfilled",
        providerAck: "unproved",
        repeatBlocked: true,
      });
      await notices.click();
      await decisionCapture(
        page,
        testInfo,
        `approval-new-handoff-remains-unproved-${theme}-${width}`,
      );
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    for (const variant of ["approvalOldHost", "approvalLegacy"]) {
      test(`approval identity refusal ${variant} at ${width}px in ${theme}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 950 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`/tests/browser/question-flow.html?theme=${theme}&approval&${variant}`);
        await page.getByRole("button", { name: "Notifications", exact: true }).click();
        const sheet = page.getByRole("dialog", { name: "Notifications", exact: true });
        await sheet.getByRole("button", { name: "Allow", exact: true }).click();
        const message =
          variant === "approvalOldHost"
            ? "Update the Host before responding"
            : "Refresh the conversation or update its execution client";
        await expect(sheet).toContainText(message);
        await expect(page.getByLabel("Approval callback count", { exact: true })).toHaveText("0");
        await decisionCapture(page, testInfo, `approval-refusal-${variant}-${theme}-${width}`);
        await page.keyboard.press("Escape");
        await expect(sheet).not.toBeVisible();
        const transcript = page.getByRole("region", {
          name: "Actual approval transcript",
          exact: true,
        });
        await transcript.getByRole("button", { name: "Allow", exact: true }).first().click();
        await expect(transcript).toContainText(message);
        await expect(page.getByLabel("Approval callback count", { exact: true })).toHaveText("0");
        await decisionCapture(
          page,
          testInfo,
          `approval-refusal-${variant}-inline-${theme}-${width}`,
        );
      });
    }
  }
}

for (const [dismiss, language, theme, width] of [
  ["cancel", "tr", "dark", 390],
  ["decline", "en", "light", 1100],
] as const) {
  test(`${dismiss} shows progress on its own button`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(
      `/tests/browser/question-flow.html?theme=${theme}&lang=${language}&dismiss=${dismiss}`,
    );
    const form = page.locator("[data-question-form]");
    const action = form.getByRole("button", {
      name: language === "tr" ? "Soruyu iptal et" : "Decline",
      exact: true,
    });
    await action.focus();
    await action.press("Enter");
    const pending = form.locator('button[aria-busy="true"]');
    await expect(pending).toHaveCount(1);
    await expect(pending).toHaveText(language === "tr" ? "İptal ediliyor…" : "Sending…");
    await expect(pending).toBeFocused();
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.getByLabel("Send count")).toHaveText("1");
    await pending.press("Enter");
    await expect(page.getByLabel("Send count")).toHaveText("1");
    await form.screenshot({
      path: `${captureRoot}/${test.info().project.name}-legacy-question-${dismiss}-pending-${theme}-${width}.png`,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1100]) {
    test(`question choices remain explicit and keyboard accessible at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/question-flow.html?theme=${theme}&variant=choices`);
      const form = page.locator("[data-question-form]");
      await expect(form.getByRole("status")).toHaveText("Waiting for your answer");
      const first = form.getByRole("radio", {
        name: "Windows and macOS",
        exact: true,
      });
      await first.focus();
      await first.press("Space");
      await expect(first).toBeChecked();
      await expect(page.getByLabel("Send count")).toHaveText("0");
      await first.press("ArrowDown");
      await expect(
        form.getByRole("radio", { name: "Desktop and mobile", exact: true }),
      ).toBeChecked();
      await form.screenshot({
        path: `${captureRoot}/${test.info().project.name}-legacy-question-active-${theme}-${width}.png`,
      });
      await form.getByText("Other", { exact: true }).click();
      const custom = form.getByRole("textbox", { name: "Type your answer" });
      await expect(custom).toBeFocused();
      await custom.fill("Linux first.\nKeep keyboard navigation and drafts.");
      await expect(page.getByLabel("Send count")).toHaveText("0");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await form.getByRole("button", { name: "Send answer", exact: true }).click();
      await expect(page.getByLabel("Send count")).toHaveText("1");
    });
  }
}

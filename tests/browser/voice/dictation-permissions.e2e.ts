import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const captures = join(process.cwd(), "temp/verification/2026-11-04-dictation-permissions");

for (const theme of ["light", "dark"]) {
  test(`dictation zoom 200 percent ${theme}`, async ({ page }) => {
    const output = join(process.cwd(), "temp/verification/voice-dictation-parity");
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(
      `/tests/browser/voice/dictation-permissions.html?theme=${theme}&stress=1&data=worst&surface=settings`,
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await page.getByRole("button", { name: "Dictation dictionary", exact: true }).click();
    await page.getByRole("button", { name: "Text cleanup options", exact: true }).click();
    await page.getByRole("button", { name: "Dictation options", exact: true }).click();
    await page.getByRole("button", { name: "Add term", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Preferred spelling", exact: true })
      .fill("Antineutrophil cytoplasmic antibody");
    await expect(page.getByRole("button", { name: "Save term", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(output, `${theme}-1280-zoom200.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [320, 800, 1280]) {
    test(`dictation stress settings ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/voice-dictation-parity");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `/tests/browser/voice/dictation-permissions.html?theme=${theme}&stress=1&data=worst&surface=settings`,
      );
      await expect(
        page.getByRole("switch", { name: "Enable dictation", exact: true }),
      ).toBeChecked();
      await page.getByRole("button", { name: "Dictation dictionary", exact: true }).click();
      await page.getByRole("button", { name: "Text cleanup options", exact: true }).click();
      await page.getByRole("button", { name: "Dictation options", exact: true }).click();
      await expect(
        page.getByText("Krankenhausinformationssystem-Schnittstellenkompatibilität", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: join(output, `${theme}-${width}-worst.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.getByRole("radio", { name: "Empty", exact: true }).click();
      await expect(page.getByText("No saved terms", { exact: true })).toBeVisible();
      await page.getByRole("radio", { name: "One", exact: true }).click();
      await expect(page.getByText("Jo", { exact: true })).toBeVisible();
      expect(await page.getByRole("button", { name: /^Edit / }).count()).toBe(1);
      await expect(
        page.getByRole("switch", { name: "Clean up dictated text", exact: true }),
      ).toBeChecked();
      expect(errors).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`dictation stress local models and microphone ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/voice-dictation-parity");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `/tests/browser/voice/dictation-permissions.html?theme=${theme}&stress=1&surface=settings&engine=local&recording-fixture=1`,
      );
      await expect(page.getByText("Whisper Small", { exact: true })).toBeVisible();
      await expect(page.getByText("Whisper large-v3-turbo", { exact: true })).toBeVisible();
      await expect(page.getByText("Dictation is ready", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Dictation options", exact: true }).click();
      await expect(page.getByText("Unload idle model", { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Record test", exact: true }).click();
      await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Stop recording", exact: true }).click();
      await expect(page.getByRole("button", { name: "Play recording", exact: true })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: join(output, `${theme}-${width}-local-ready-recording.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Play recording", exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: join(output, `${theme}-${width}-local-recording.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Discard recording", exact: true }).click();
      await expect(page.getByRole("button", { name: "Play recording", exact: true })).toHaveCount(
        0,
      );
    });
  }
}

for (const state of ["error", "loading", "working"]) {
  test(`dictation stress local models ${state}`, async ({ page }) => {
    await page.goto(
      `/tests/browser/voice/dictation-permissions.html?stress=1&surface=settings&engine=local&models=${state}`,
    );
    await expect(
      page.getByText(
        state === "error"
          ? "Could not load local models."
          : state === "loading"
            ? "Loading models…"
            : "Working…",
        { exact: true },
      ),
    ).toBeVisible();
  });
}

for (const state of ["error", "loading"]) {
  test(`dictation stress catalog ${state}`, async ({ page }) => {
    await page.goto(
      `/tests/browser/voice/dictation-permissions.html?stress=1&surface=settings&catalog=${state}`,
    );
    if (state === "error") {
      await expect(
        page.getByText("Could not load transcription models. Retry to refresh the catalog."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    } else {
      await expect(page.getByText("Loading transcription models…")).toBeVisible();
    }
    expect(await page.evaluate(() => (window as any).fixtureDictation.microphoneRequests)).toBe(0);
  });
}
test.beforeAll(async () => {
  await mkdir(captures, { recursive: true });
  await writeFile(
    join(captures, "README.md"),
    "# Dictation permission fixture verification\n\nCaptures use production VoiceSettings, MicrophonePermissionSettings and DictationButton with synthetic Host and microphone boundaries. No native OS dialog, actual microphone, recognizer, installed build or release acceptance is established. Reuse via tests/browser/voice/playwright.dictation-permissions.config.ts.\n",
  );
});

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`dictation-only settings and permission recovery ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/tests/browser/voice/dictation-permissions.html?theme=${theme}`);
      const dictation = page.getByRole("switch", { name: "Enable dictation", exact: true });
      const companion = page.getByRole("switch", { name: "Enable voice companion", exact: true });
      await expect(dictation).toBeChecked();
      await expect(companion).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Dictate", exact: true })).toBeVisible();
      await expect(page.getByText("Dictation is ready", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureDictation.microphoneRequests)).toBe(
        0,
      );
      expect(
        await page.evaluate(() => (window as any).fixtureDictation.inspected.at(-1)),
      ).toMatchObject({ natural: false });
      await page.screenshot({
        path: join(captures, `${theme}-${width}-dictation-only.png`),
        fullPage: true,
        animations: "disabled",
      });

      const check = page.getByRole("button", { name: "Check microphone access", exact: true });
      await check.click();
      const permission = page.locator('[data-setting-id="speech-microphone"]');
      await expect(permission).toContainText("Microphone access is blocked.");
      expect(await page.evaluate(() => (window as any).fixtureDictation.microphoneRequests)).toBe(
        1,
      );
      await page.screenshot({
        path: join(captures, `${theme}-${width}-permission-blocked.png`),
        fullPage: true,
        animations: "disabled",
      });

      await page.evaluate(() => {
        (window as any).fixtureDictation.microphoneResult = "allowed";
      });
      await check.click();
      await expect(permission).toContainText("Microphone allowed");
      expect(await page.evaluate(() => (window as any).fixtureDictation.microphoneStops)).toBe(1);
      await expect(page.getByRole("textbox", { name: "Message draft" })).toHaveValue(
        "Unsent draft remains here.",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test("switches are independent, keyboard accessible and never open the microphone", async ({
  page,
}) => {
  await page.goto("/tests/browser/voice/dictation-permissions.html?dictation=0");
  const dictation = page.getByRole("switch", { name: "Enable dictation", exact: true });
  const companion = page.getByRole("switch", { name: "Enable voice companion", exact: true });
  await expect(dictation).not.toBeChecked();
  await expect(companion).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toHaveCount(0);
  await dictation.focus();
  await dictation.press("Space");
  await expect(dictation).toBeChecked();
  await expect(companion).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toBeVisible();
  await companion.click();
  await expect(companion).toBeChecked();
  await expect(dictation).toBeChecked();
  await dictation.click();
  await expect(dictation).not.toBeChecked();
  await expect(companion).toBeChecked();
  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toHaveCount(0);
  await companion.click();
  await expect(companion).not.toBeChecked();
  // The permission check stays available with both features off; showing it never opens
  // the microphone.
  await expect(
    page.getByRole("button", { name: "Check microphone access", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureDictation.microphoneRequests)).toBe(0);
  await expect(page.getByRole("textbox", { name: "Message draft" })).toHaveValue(
    "Unsent draft remains here.",
  );
});

test("denied dictation preserves the draft, releases recognition and stays retryable", async ({
  page,
}) => {
  await page.goto("/tests/browser/voice/dictation-permissions.html");
  const dictate = page.getByRole("button", { name: "Dictate", exact: true });
  await dictate.click();
  await expect(page.getByRole("region", { name: "Message box fixture" })).toContainText(
    "Microphone access is blocked.",
  );
  await expect(dictate).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Message draft" })).toHaveValue(
    "Unsent draft remains here.",
  );
  expect(await page.evaluate(() => (window as any).fixtureDictation.starts.at(-1))).toMatchObject({
    recognitionOnly: true,
  });
  expect(await page.evaluate(() => (window as any).fixtureDictation.releases)).toBe(1);
  await dictate.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).fixtureDictation.microphoneRequests))
    .toBe(2);
  await expect(dictate).toBeEnabled();
});

for (const platform of ["macOS", "Windows", "Linux"])
  for (const theme of ["light", "dark"])
    for (const width of [1280, 800])
      for (const zoom of [1, 2])
        test(`platform-specific denied access recovery fixture ${platform} ${theme} ${width} zoom ${zoom}`, async ({
          page,
        }) => {
          // Layout/pixel-density emulation of browser zoom, without changing CSS coordinates.
          await page.setViewportSize({ width: width / zoom, height: 1100 / zoom });
          const protocol = await page.context().newCDPSession(page);
          await protocol.send("Emulation.setDeviceMetricsOverride", {
            width: width / zoom,
            height: 1100 / zoom,
            deviceScaleFactor: zoom,
            mobile: false,
            screenWidth: width,
            screenHeight: 1100,
          });
          await page.addInitScript(
            ({ platform }) => {
              Object.defineProperty(navigator, "platform", {
                configurable: true,
                value:
                  platform === "macOS"
                    ? "MacIntel"
                    : platform === "Windows"
                      ? "Win32"
                      : "Linux x86_64",
              });
              (window as any).isTauri = true;
              (window as any).fixtureNativeCalls = [];
              (window as any).__TAURI_INTERNALS__ = {
                metadata: {
                  currentWindow: { label: "fixture" },
                  currentWebview: { label: "fixture" },
                },
                transformCallback: () => 1,
                unregisterCallback: () => {},
                invoke: async (command: string, args: unknown) => {
                  (window as any).fixtureNativeCalls.push({ command, args });
                  if (command === "open_privacy_settings")
                    throw new Error("Synthetic settings launch failure");
                  if (command === "plugin:event|listen") return 1;
                },
              };
            },
            { platform },
          );
          await page.goto(`/tests/browser/voice/dictation-permissions.html?theme=${theme}`);
          await expect(page.getByText("Dictation is ready", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Check microphone access", exact: true }).click();
          const permission = page.locator('[data-setting-id="speech-microphone"]');
          await expect(permission).toContainText("Microphone access is blocked.");
          await expect(permission).toContainText(
            platform === "macOS"
              ? "Privacy & Security > Microphone"
              : platform === "Windows"
                ? "allow microphone access and desktop apps"
                : "app or sandbox microphone permissions",
          );
          await page.getByRole("button", { name: "Dictate", exact: true }).click();
          const composer = page.getByRole("region", { name: "Message box fixture" });
          await expect(composer).toContainText("Microphone access is blocked.");
          const recovery = composer.getByRole("button", {
            name: "Open Privacy Settings",
            exact: true,
          });
          if (platform === "Linux") {
            await expect(recovery).toHaveCount(0);
            await expect(
              permission.getByRole("button", { name: "Open Privacy Settings", exact: true }),
            ).toHaveCount(0);
          } else {
            await expect(recovery).toBeVisible();
            await recovery.click();
            await expect(composer).toContainText(
              "Could not open microphone settings. Open your system settings manually.",
            );
            expect(
              await page.evaluate(() =>
                (window as any).fixtureNativeCalls.filter(
                  (call: any) => call.command === "open_privacy_settings",
                ),
              ),
            ).toEqual([{ command: "open_privacy_settings", args: { pane: "microphone" } }]);
            await expect(permission).toContainText("Microphone access is blocked.");
          }
          expect(
            await page.evaluate(() => (window as any).fixtureDictation.microphoneRequests),
          ).toBe(2);
          await expect(page.getByRole("textbox", { name: "Message draft" })).toHaveValue(
            "Unsent draft remains here.",
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: join(
              captures,
              `${platform}-${theme}-${width}-zoom-${zoom}-denied-native-fixture.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
          for (const surface of ["setup", "companion"]) {
            await page.goto(
              `/tests/browser/voice/dictation-permissions.html?theme=${theme}&surface=${surface}&companion=1&voice-denied=1`,
            );
            if (surface === "setup")
              await page.getByRole("button", { name: "Test microphone", exact: true }).click();
            else {
              await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
              await page.getByRole("button", { name: "Start voice", exact: true }).click();
              // Expanded companion keeps the error and recovery in its body.
              await expect(
                page.getByRole("region", { name: "Voice companion", exact: true }),
              ).toContainText("Microphone access is blocked.");
            }
            const errorSurface =
              surface === "companion"
                ? page.getByRole("region", { name: "Voice companion", exact: true })
                : page;
            const visibleError =
              surface === "companion"
                ? errorSurface.locator("p").filter({ hasText: /Microphone access is blocked\./ })
                : errorSurface.getByText(/Microphone access is blocked\./);
            await expect(visibleError).toBeVisible();
            const action = errorSurface.getByRole("button", {
              name: "Open Privacy Settings",
              exact: true,
            });
            if (platform === "Linux") await expect(action).toHaveCount(0);
            else {
              await expect(action).toHaveCount(1);
              await expect(action).toBeVisible();
            }
            await page.screenshot({
              path: join(
                captures,
                `${platform}-${theme}-${width}-zoom-${zoom}-${surface}-blocked-native-fixture.png`,
              ),
              fullPage: true,
              animations: "disabled",
            });
          }
        });

test("live permission denial returning to prompt clears stale denial without granting capture", async ({
  page,
}) => {
  await page.goto("/tests/browser/voice/dictation-permissions.html");
  const permission = page.locator('[data-setting-id="speech-microphone"]');
  await page.getByRole("button", { name: "Check microphone access", exact: true }).click();
  await expect(permission).toContainText("Microphone access is blocked.");
  await page.evaluate(() => {
    const status = (window as any).fixturePermissionStatus;
    status.state = "denied";
    status.dispatchEvent(new Event("change"));
  });
  await expect(permission).toContainText("Microphone access is blocked.");
  await page.evaluate(() => {
    const status = (window as any).fixturePermissionStatus;
    status.state = "prompt";
    status.dispatchEvent(new Event("change"));
  });
  await expect(permission).toContainText("Not checked");
  const help = permission.getByRole("button", { name: "Microphone access: Help", exact: true });
  await help.focus();
  await help.press("Enter");
  await expect(
    page.getByText("Microphone permission is requested only", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(permission).not.toContainText("Microphone access is blocked.");
  await expect(permission).not.toContainText("Microphone allowed");
  expect(await page.evaluate(() => (window as any).fixtureDictation.microphoneRequests)).toBe(1);
});

test("Turkish dictation controls and permission recovery are localized", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1100 });
  await page.goto("/tests/browser/voice/dictation-permissions.html?lang=tr&theme=light");
  await expect(
    page.getByRole("switch", { name: "Dikteyi etkinleştir", exact: true }),
  ).toBeChecked();
  await expect(page.getByText("Dikte hazır", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mikrofon erişimini kontrol et", exact: true }).click();
  await expect(page.locator('[data-setting-id="speech-microphone"]')).toContainText(
    "Mikrofon erişimi engellendi.",
  );
  await page.screenshot({
    path: join(captures, "tr-light-800-permission-blocked.png"),
    fullPage: true,
    animations: "disabled",
  });
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`settings feedback error visual ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(`/tests/browser/voice/dictation-permissions.html?theme=${theme}`);
      await page.getByRole("button", { name: "Dictate", exact: true }).click();
      const feedback = page.locator('.settings-feedback[data-state="error"]');
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText("Microphone access is blocked.");
      await expect(page.getByRole("textbox", { name: "Message draft" })).toHaveValue(
        "Unsent draft remains here.",
      );
      await feedback.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(captures, `feedback-${theme}-${width}.png`),
        animations: "disabled",
      });
    });

import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_VOICE_CALL_SETTINGS, VoiceCallSettingsStore } from "./voice-call-settings";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function store() {
  const directory = await mkdtemp(join(tmpdir(), "voice-call-settings-"));
  directories.push(directory);
  const path = join(directory, "voice", "call-settings.json");
  return { path, settings: new VoiceCallSettingsStore(path, async () => ({ grok: true, openai: false })) };
}

it("reads defaults with sign-in booleans and persists a validated change", async () => {
  const { path, settings } = await store();
  await expect(settings.get()).resolves.toEqual({
    settings: DEFAULT_VOICE_CALL_SETTINGS,
    signedIn: { grok: true, openai: false },
  });
  const saved = await settings.set({ mode: "grok", grokVoice: "ara", persona: "  Calm  ", turnEndSilence: 2 });
  expect(saved.settings).toMatchObject({ mode: "grok", grokVoice: "ara", persona: "Calm", turnEndSilence: 2 });
  const file = await readFile(path, "utf8");
  expect(JSON.parse(file)).toMatchObject({ mode: "grok", grokVoice: "ara" });
  // Choices only: nothing that looks like a key, model or path is stored.
  expect(Object.keys(JSON.parse(file)).sort()).toEqual(
    ["grokVoice", "languageLock", "mode", "openaiVoice", "persona", "turnEndSilence"].sort(),
  );
});

it("refuses unknown speakers and languages and keeps the previous settings", async () => {
  const { settings } = await store();
  await settings.set({ openaiVoice: "cedar" });
  await expect(settings.set({ openaiVoice: "eve" })).rejects.toThrow("Unknown OpenAI Realtime speaker.");
  await expect(settings.set({ grokVoice: "marin" })).rejects.toThrow("Unknown Grok Voice speaker.");
  await expect(settings.set({ languageLock: "klingon-xx-yy" })).rejects.toThrow();
  expect((await settings.read()).openaiVoice).toBe("cedar");
});

it("reads a damaged file as the defaults instead of failing the call", async () => {
  const { path, settings } = await store();
  await settings.set({ mode: "openai" });
  await writeFile(path, "{ not json");
  await expect(settings.read()).resolves.toEqual(DEFAULT_VOICE_CALL_SETTINGS);
});

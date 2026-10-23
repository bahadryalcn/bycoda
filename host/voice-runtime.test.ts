import { expect, it } from "vitest";
import { voiceRuntimeConfig } from "./voice-runtime";
it("accepts custom model paths as data and rejects malformed runtime options", () => {
  expect(
    voiceRuntimeConfig({
      python: " C:\\Voice\\python.exe ",
      whisperPath: "G:\\Models\\whisper",
      natural: true,
    }),
  ).toEqual({ python: "C:\\Voice\\python.exe", whisperPath: "G:\\Models\\whisper", natural: true });
  for (const value of [
    null,
    [],
    { python: 4 },
    { python: "x\ncommand" },
    { ttsPath: "a".repeat(4097) },
    { natural: "true" },
  ])
    expect(() => voiceRuntimeConfig(value)).toThrow();
});

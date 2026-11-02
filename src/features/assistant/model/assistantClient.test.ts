// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
vi.mock("../../connections/model/hostFeatureClient", () => ({
  hostToolRequest: vi.fn(),
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string, params?: Record<string, string>) =>
    key.replace(/\{(p\d+)\}/g, (_, name) => params?.[name] ?? ""),
  useLocale: () => "tr",
}));
import { possessiveName, assistantIdentity } from "./assistantClient";

it.each([
  ["Arif", "Arif'in"],
  ["Ayşe", "Ayşe'nin"],
  ["Mert", "Mert'in"],
  ["Umut", "Umut'un"],
  ["Gül", "Gül'ün"],
  ["Ali", "Ali'nin"],
  ["Kai", "Kai'nin"],
  ["Jarvis", "Jarvis'in"],
  ["ALİ", "ALİ'nin"],
])("uses Turkish possessive for %s", (name, expected) => {
  expect(possessiveName(name)).toBe(expected);
});
it("uses setup navigation until a name exists, and keeps the chosen name unchanged", () => {
  expect(assistantIdentity(undefined, "en")).toMatchObject({
    name: "",
    title: "Set up",
    room: "Set up",
    setupComplete: false,
  });
  const profile = {
    name: "Arif",
    showTitle: true,
    setupComplete: true,
    voiceSetupComplete: false,
  } as any;
  expect(assistantIdentity(profile, "en")).toMatchObject({
    title: "Assistant Arif",
    room: "Room · Arif",
  });
  expect(
    assistantIdentity({ ...profile, showTitle: false }, "tr"),
  ).toMatchObject({ title: "Arif", room: "Arif'in room" });
  expect(assistantIdentity({ ...profile, name: "X" }, "tr").room).toBe(
    "Room · X",
  );
});

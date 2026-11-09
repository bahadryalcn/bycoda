// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../../connections/model/hostFeatureClient", () => ({
  hostToolRequest: vi.fn(),
}));
vi.mock("./assistantHostRead", () => ({
  captureAssistantHostRead: vi.fn(async () => ({ environmentId: "env" })),
}));
// The real parse always returns a new object; cloning keeps that behavior under test.
vi.mock("../../../shared/model/host-contracts/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/model/host-contracts/assistant")>()),
  AssistantResponseValidationSchema: { parse: (value: unknown) => structuredClone(value) },
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string, params?: Record<string, string>) =>
    key.replace(/\{(p\d+)\}/g, (_, name) => params?.[name] ?? ""),
  useLocale: () => "tr",
}));
import { hostToolRequest } from "../../connections/model/hostFeatureClient";
import {
  possessiveName,
  assistantIdentity,
  refreshAssistant,
  useAssistantSnapshot,
} from "./assistantClient";

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
  expect(assistantIdentity({ ...profile, showTitle: false }, "tr")).toMatchObject({
    title: "Arif",
    room: "Arif'in room",
  });
  expect(assistantIdentity({ ...profile, name: "X" }, "tr").room).toBe("Room · X");
});

it("does not re-notify consumers for an unchanged 15 s poll, and notifies once for a changed one", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  let renders = 0;
  let latest: ReturnType<typeof useAssistantSnapshot> | undefined;
  function Consumer() {
    renders++;
    latest = useAssistantSnapshot();
    return null;
  }
  const snapshot = (name: string) => ({ snapshot: { profile: { name } } });
  try {
    vi.mocked(hostToolRequest).mockResolvedValue(snapshot("Arif") as never);
    await act(async () => root.render(createElement(Consumer)));
    await act(() => refreshAssistant());
    expect(latest?.snapshot?.profile?.name).toBe("Arif");
    const rendersAfterLoad = renders;
    const calls = vi.mocked(hostToolRequest).mock.calls.length;

    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(vi.mocked(hostToolRequest).mock.calls.length).toBe(calls + 1);
    expect(renders).toBe(rendersAfterLoad);

    vi.mocked(hostToolRequest).mockResolvedValue(snapshot("Mert") as never);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(renders).toBe(rendersAfterLoad + 1);
    expect(latest?.snapshot?.profile?.name).toBe("Mert");
    expect(latest?.loading).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

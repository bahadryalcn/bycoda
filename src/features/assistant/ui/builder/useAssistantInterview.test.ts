// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAssistantInterview } from "./useAssistantInterview";
import { requestAssistantInterview } from "../../model/assistantBuilderClient";
import type { AssistantProfileInterviewResult } from "../../../../shared/model/host-contracts/assistant-builder";
import {
  interviewFirstQuestion,
  resolveInterviewLanguage,
} from "../../model/assistantInterviewLanguage";

vi.mock("../../../../shared/i18n", () => ({ getLocale: () => "de", t: (text: string) => text }));
vi.mock("../../model/assistantBuilderClient", () => ({
  requestAssistantInterview: vi.fn(),
  assistantBuilderFailureDetail: (error: Error) => error.message,
}));

let root: Root | undefined;
let container: HTMLDivElement;
let interview: ReturnType<typeof useAssistantInterview>;
it.each(["tr-TR", "en-US", "de-DE", "fr-FR", "es-ES", "pt-PT", "zh-CN", "ja-JP"])(
  "keeps supported interview language %s",
  (language) => {
    expect(resolveInterviewLanguage(language, "de")).toBe(language);
    expect(interviewFirstQuestion(language).length).toBeGreaterThan(10);
  },
);
async function mount(language: string) {
  function Harness() {
    interview = useAssistantInterview({ harness: "codex", model: "test" }, { language });
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(Harness)));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.resetAllMocks();
});

it.each(["tr-TR", "Turkish"])(
  "starts in profile language %s independently of app locale",
  async (language) => {
    await mount(language);
    expect(interview.language).toBe("tr-TR");
    expect(interview.transcript[0]?.text).toContain("Asistanınızın");
    expect(requestAssistantInterview).not.toHaveBeenCalled();
  },
);

it("resolves auto from app locale and changes an unanswered question without a request", async () => {
  await mount("auto");
  expect(interview.language).toBe("de-DE");
  await act(async () => interview.setLanguage("ja-JP"));
  expect(interview.language).toBe("ja-JP");
  expect(interview.transcript).toEqual([
    { role: "assistant", text: expect.stringContaining("アシスタント") },
  ]);
  expect(requestAssistantInterview).not.toHaveBeenCalled();
});

it("regenerates the active question in selected language while preserving answers and profile", async () => {
  const request = vi.mocked(requestAssistantInterview);
  request.mockResolvedValueOnce({ kind: "question", question: "Hangi ses?", options: ["Sakin"] });
  await mount("Turkish");
  await act(async () => interview.answer("Read my daily notes"));
  request.mockResolvedValueOnce({ kind: "question", question: "Which voice?", options: ["Calm"] });
  await act(async () => interview.setLanguage("en-US"));
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      locale: "en-US",
      current: { language: "Turkish" },
      transcript: [
        expect.objectContaining({ role: "assistant" }),
        { role: "owner", text: "Read my daily notes" },
      ],
    }),
  );
  expect(interview.options).toEqual(["Calm"]);
  expect(interview.transcript.at(-1)?.text).toBe("Which voice?");
});

it("ignores old-language results after switching during a request and retries in selected language", async () => {
  const request = vi.mocked(requestAssistantInterview);
  let completeOld!: (value: AssistantProfileInterviewResult) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeOld = resolve;
      }),
  );
  await mount("tr-TR");
  await act(async () => interview.answer("Keep answers brief"));
  request.mockRejectedValueOnce(new Error("offline"));
  await act(async () => interview.setLanguage("en-US"));
  await act(async () =>
    completeOld({ kind: "question", question: "Eski soru", options: ["Eski"] }),
  );
  expect(interview.failure).toBe("offline");
  expect(interview.options).toEqual([]);
  expect(interview.transcript.at(-1)?.role).toBe("owner");
  request.mockResolvedValueOnce({ kind: "question", question: "Which voice?", options: [] });
  await act(async () => interview.retry());
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ locale: "en-US" }));
  expect(interview.transcript.filter((turn) => turn.role === "owner")).toHaveLength(1);
  expect(interview.busy).toBe(false);
});

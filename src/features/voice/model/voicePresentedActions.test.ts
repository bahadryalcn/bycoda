import { expect, it } from "vitest";
import {
  VoicePresentedActionButtonSchema,
  voicePresentedActionResponse,
  voicePresentedRequestKey,
} from "./voicePresentedActions";

it("identifies identical operations while keeping edited form inputs distinct", () => {
  const action = {
    family: "workspace",
    action: "workspace.sessions.create",
    label: "Create",
  } as const;
  const request = (input: Record<string, unknown>, label = action.label) =>
    voicePresentedRequestKey(VoicePresentedActionButtonSchema.parse({ ...action, label, input }));
  const initial = request({ projectPath: "/alpha", prompt: "First draft", submit: false });
  expect(request({ submit: false, prompt: "First draft", projectPath: "/alpha" })).toBe(initial);
  expect(request({ projectPath: "/alpha", prompt: "Updated draft", submit: false })).not.toBe(
    initial,
  );
  expect(request({ projectPath: "/beta", prompt: "First draft", submit: false })).not.toBe(initial);
});

it("returns comparable receipt states and a bounded plain-text preview for a result", () => {
  const result = {
    entries: [{ title: "Open task" }],
    authorization: "Bearer private",
    data: "x".repeat(6000),
  };
  expect(voicePresentedActionResponse("queued", result, true)).toEqual({ status: "queued" });
  expect(voicePresentedActionResponse("completed", result, false)).toEqual({ status: "completed" });
  const shown = voicePresentedActionResponse(undefined, result, true);
  expect(shown.status).toBe("returned");
  expect(shown.preview).toContain("Open task");
  expect(shown.preview).not.toContain("Bearer private");
  expect(shown.preview!.length).toBeLessThanOrEqual(4000);
});

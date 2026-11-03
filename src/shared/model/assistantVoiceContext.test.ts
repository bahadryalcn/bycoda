import { expect, it } from "vitest";
import { AssistantVoiceDisclosureSchema } from "./assistantVoiceContext";
it("keeps the legacy verified disclosure wire unchanged and separates unscoped operation identity", () => {
  const base = { id: "ticket", contextId: "context", requestId: "request" },
    verified = { ...base, verified: true, projectIds: ["project"] };
  expect(AssistantVoiceDisclosureSchema.parse(verified)).toEqual(verified);
  const source = {
    environmentId: "host",
    projectId: "project",
    threadId: "thread",
    family: "conversation",
    action: "desktop.status",
  };
  expect(AssistantVoiceDisclosureSchema.parse({ ...base, verified: false, source })).toEqual({
    ...base,
    verified: false,
    source,
  });
  expect(
    AssistantVoiceDisclosureSchema.safeParse({ ...base, verified: false, source, projectIds: [] })
      .success,
  ).toBe(false);
  expect(
    AssistantVoiceDisclosureSchema.safeParse({
      ...base,
      verified: false,
      source: { ...source, approved: true },
    }).success,
  ).toBe(false);
});

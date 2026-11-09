import { expect, it } from "vitest";
import { newSession } from "../model/session";
import { assistantSessionManagement, sessionMessageAuthor } from "../model/sessionProvenance";
import { sanitizeSessionForPersist } from "./sessionStore";

it("round-trips real Room provenance without inventing a job or supervision grant", () => {
  const session = newSession("codex", "/room-target");
  const author = {
    kind: "assistant-room" as const,
    name: "Assistant",
    threadId: "real-room",
    reason: "kickoff" as const,
    operationId: "original-send",
  };
  session.blocks = [{ id: "room-work", role: "user", text: "Explicit work", author }];
  expect(sessionMessageAuthor(author)).toEqual(author);
  // Native storage keeps an accepted stamp; a client save never supplies one.
  expect(sanitizeSessionForPersist(session).blocks[0]).not.toHaveProperty("author");
  expect(sessionMessageAuthor({ ...author, jobId: "invented" })).toBeUndefined();
  expect(sessionMessageAuthor({ ...author, supervisionId: "invented" })).toBeUndefined();
  expect(sessionMessageAuthor({ ...author, reason: "approve" })).toBeUndefined();
});

it("never supplies Host provenance in a client save, so a Host-projected copy saves", () => {
  const session = newSession("codex", "/fixture");
  session.managedBy = { assistant: true, jobId: "job", managedAt: 123 };
  const author = {
    kind: "assistant" as const,
    name: "Owner Name",
    jobId: "job",
    reason: "nudge" as const,
    operationId: "operation",
  };
  session.blocks = [{ id: "user", role: "user", text: "Continue", author }];
  // The native boundary rejects any stamp it did not already store.
  const payload = sanitizeSessionForPersist(session);
  expect(payload).not.toHaveProperty("managedBy");
  expect(payload.blocks[0]).not.toHaveProperty("author");
  expect(payload.blocks[0].text).toBe("Continue");
});
it("does not turn malformed display provenance into an assistant-management grant", () => {
  expect(
    assistantSessionManagement({ assistant: false, jobId: "job", managedAt: 123 }),
  ).toBeUndefined();
  expect(
    assistantSessionManagement({ assistant: true, jobId: "job", managedAt: -1 }),
  ).toBeUndefined();
  expect(
    sessionMessageAuthor({
      kind: "assistant",
      name: "Name",
      jobId: "job",
      reason: "approve",
      operationId: "id",
    }),
  ).toBeUndefined();
});
it("round-trips explicit manual supervision provenance without a fabricated job identity", () => {
  const session = newSession("codex", "/manual"),
    author = {
      kind: "assistant-manual" as const,
      name: "Owner Name",
      supervisionId: "grant",
      reason: "nudge" as const,
      operationId: "manual-operation",
    };
  session.managedBy = { assistant: true, supervisionId: "grant", managedAt: 123 };
  session.blocks = [{ id: "manual", role: "user", text: "Continue", author }];
  expect(assistantSessionManagement(session.managedBy)).not.toHaveProperty("jobId");
  expect(sessionMessageAuthor(author)).toEqual(author);
  expect(assistantSessionManagement({ ...session.managedBy, jobId: "fake-job" })).toBeUndefined();
  expect(sessionMessageAuthor({ ...author, jobId: "fake-job" })).toBeUndefined();
  expect(assistantSessionManagement({ ...session.managedBy, jobId: "" })).toBeUndefined();
});

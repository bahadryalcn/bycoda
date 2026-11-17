import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDesktopRelay } from "./conversation-desktop-relay";
import { createHostDispatcher } from "../transport/dispatch";

const principal = { kind: "session" as const, sessionId: "s", projectId: "p", provider: "codex" };
const relays: ConversationDesktopRelay[] = [];
async function setup(authorized = () => true) {
  const relay = new ConversationDesktopRelay("host");
  relays.push(relay);
  await relay.take("desktop");
  const result = relay.call(
    "secrets.input.authorize",
    { name: "API key", purpose: "Deploy" },
    "/p",
    principal,
    authorized,
  );
  void result.catch(() => undefined);
  const [desktop] = await relay.take("desktop");
  const {
    requests: [request],
  } = await relay.secretInputs("s");
  return { relay, result, desktop: desktop!, request: request! };
}
afterEach(() => {
  relays.splice(0).forEach((relay) => relay.close());
  vi.useRealTimers();
});

describe("transient secret input registry", () => {
  it("lists session metadata and settles exact value once, abandoning desktop authority", async () => {
    const { relay, request, desktop, result } = await setup();
    expect(await relay.secretInputs("other")).toEqual({ requests: [] });
    expect(request).toMatchObject({
      kind: "secret",
      remote: true,
      sessionId: "s",
      fieldLabel: "API key",
    });
    expect(request.signature).toHaveLength(64);
    await relay.answerSecretInput({
      id: request.id,
      signature: request.signature,
      value: " phone value ",
    });
    await expect(result).resolves.toEqual({ value: " phone value " });
    expect(await relay.secretInputs("s")).toEqual({ requests: [] });
    expect(await relay.authorize(String(desktop.id), "secrets.input.authorize", "desktop")).toEqual(
      { authorized: false },
    );
    await expect(relay.finish(request.id, { value: "late" })).rejects.toThrow();
    await expect(relay.answerSecretInput({ ...request, value: "replay" })).rejects.toThrow();
    await expect(
      relay.answerSecretInput({ id: request.id, signature: request.signature, cancelled: true }),
    ).rejects.toThrow();
  });
  it("desktop answer wins over a later phone answer", async () => {
    const { relay, request, result } = await setup();
    await relay.finish(request.id, { value: "desktop" });
    await expect(result).resolves.toEqual({ value: "desktop" });
    await expect(
      relay.answerSecretInput({ id: request.id, signature: request.signature, value: "phone" }),
    ).rejects.toThrow();
  });
  it("cancels without extra fields", async () => {
    const { relay, request, result } = await setup();
    await relay.answerSecretInput({
      id: request.id,
      signature: request.signature,
      cancelled: true,
    });
    await expect(result).resolves.toEqual({ cancelled: true });
  });
  it("rejects forged signatures, unknown ids, malformed and oversized UTF-8 input without consuming", async () => {
    const { relay, request, result } = await setup();
    for (const answer of [
      { id: request.id, signature: "f".repeat(64), value: "x" },
      { id: "unknown", signature: request.signature, value: "x" },
      { id: request.id, signature: request.signature, value: "é".repeat(4097) },
      { id: request.id, signature: request.signature, value: "" },
      { id: request.id, signature: request.signature, value: "x", cancelled: true },
    ])
      await expect(relay.answerSecretInput(answer)).rejects.toThrow();
    await relay.answerSecretInput({
      id: request.id,
      signature: request.signature,
      value: "é".repeat(4096),
    });
    await expect(result).resolves.toEqual({ value: "é".repeat(4096) });
  });
  it("refuses expired entries even before timer cleanup", async () => {
    vi.useFakeTimers();
    const { relay, request, result } = await setup();
    vi.setSystemTime(request.deadline);
    await expect(
      relay.answerSecretInput({ id: request.id, signature: request.signature, cancelled: true }),
    ).rejects.toThrow();
    expect(await relay.secretInputs("s")).toEqual({ requests: [] });
    relay.close();
    await expect(result).rejects.toThrow();
  });
  it("rechecks session authority and concurrent answers consume only once", async () => {
    let valid = true;
    const { relay, request, result } = await setup(() => valid);
    valid = false;
    await expect(
      relay.answerSecretInput({ id: request.id, signature: request.signature, value: "x" }),
    ).rejects.toThrow();
    expect(await relay.secretInputs("s")).toEqual({ requests: [] });
    valid = true;
    const answers = await Promise.allSettled([
      relay.answerSecretInput({ id: request.id, signature: request.signature, value: "first" }),
      relay.finish(request.id, { value: "second" }),
    ]);
    expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
    expect(answers.filter((answer) => answer.status === "rejected")).toHaveLength(1);
    await expect(result).resolves.toEqual({
      value: answers[0]!.status === "fulfilled" ? "first" : "second",
    });
  });
  it("refuses scoped and revoked principals before list or answer dispatch", async () => {
    const { relay, request } = await setup();
    const answer = { id: request.id, signature: request.signature, cancelled: true };
    const dispatcher = createHostDispatcher({
      environmentId: "host",
      environment: {} as never,
      projects: {} as never,
      operations: {
        "secrets.input.answer": (params) => relay.answerSecretInput(params),
        "secrets.input.list": () => relay.secretInputs("s"),
      },
    });
    for (const kind of ["conversation", "social", "runtime-logs", "peer"] as const) {
      const context = {
        environmentId: "host",
        principal: { kind, id: "limited" },
        authorized: () => true,
      };
      await expect(dispatcher.dispatch("secrets.input.answer", answer, context)).rejects.toThrow();
      await expect(
        dispatcher.dispatch("secrets.input.list", { sessionId: "s" }, context),
      ).rejects.toThrow();
    }
    await expect(
      dispatcher.dispatch("secrets.input.answer", answer, {
        environmentId: "host",
        principal: { kind: "device", id: "guest" },
        authorized: () => false,
      }),
    ).rejects.toThrow();
    await expect(relay.answerSecretInput(answer, () => false)).rejects.toThrow();
    expect((await relay.secretInputs("s")).requests).toHaveLength(1);
  });
  it("discards the answer if session authority changes during owner admission", async () => {
    let valid = true;
    const { relay, request } = await setup(() => valid);
    await expect(
      relay.answerSecretInput(
        { id: request.id, signature: request.signature, value: "discard" },
        async () => {
          valid = false;
          return true;
        },
      ),
    ).rejects.toThrow();
    expect(await relay.secretInputs("s")).toEqual({ requests: [] });
  });
});

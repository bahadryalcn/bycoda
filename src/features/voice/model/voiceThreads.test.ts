import { expect, it, vi } from "vitest";
import { VoiceThreadTranscript, voiceThreadSeed,voiceThreadSummary } from "./voiceThreads";
import type {
  AssistantMessage,
  AssistantRequest,
  AssistantThread,
} from "../../../shared/model/host-contracts/assistant";

const thread = (id: string) => ({ id, summary: "Owner's prior discussion" }) as AssistantThread;
it("keeps an uncertain append's original identity and target through retry and scope changes", async () => {
  const request = vi.fn(async (_input: AssistantRequest) => ({
    message: { id: "saved" } as AssistantMessage,
  }));
  request.mockRejectedValueOnce(new Error("connection lost"));
  const failed = vi.fn();
  const store = new VoiceThreadTranscript(request, failed);
  store.bind(thread("a"), "sa");
  store.record("user", "Original request");
  store.finish();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const original = request.mock.calls[0][0];
  store.bind(thread("b"), "sb");
  await store.retry();
  expect(request.mock.calls[1][0]).toEqual(original);
  expect(original).toMatchObject({
    threadId: "a",
    sessionId: "sa",
    role: "user",
    text: "Original request",
  });
  expect(failed).toHaveBeenCalledOnce();
});
it("stores streamed sentences as one assistant message and keeps owner and assistant roles", async () => {
  const request = vi.fn(async (_input: AssistantRequest) => ({
    message: { id: "saved" } as AssistantMessage,
  }));
  const store = new VoiceThreadTranscript(request, vi.fn());
  store.bind(thread("a"));
  store.record("user", "Question");
  store.record("assistant", "First sentence. ");
  store.record("assistant", "Second sentence.", true);
  store.finish();
  await store.retry();
  expect(request.mock.calls.map(([input]) => input)).toMatchObject([
    { role: "user", text: "Question" },
    { role: "assistant", text: "First sentence. Second sentence." },
  ]);
});
it("returns the exact accepted owner receipt and original route even if a later target is bound while it saves", async () => {
  let release!: (value: any) => void;
  const request = vi.fn(
    async (input: AssistantRequest) =>
      new Promise<any>((done) => {
        release = done;
      }),
  );
  const store = new VoiceThreadTranscript(request, vi.fn());
  store.bind(thread("original"));
  store.record("user", "Exact accepted text");
  store.finish();
  const captured = store.ownerReceipt();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  store.bind(thread("later"));
  release({
    message: {
      id: "canonical-owner",
      threadId: "original",
      role: "user",
      via: "voice",
      text: "Exact accepted text",
      jobIds: [],
    },
  });
  expect(await captured).toMatchObject({
    message: { id: "canonical-owner", threadId: "original" },
    request,
  });
  await expect(store.ownerReceipt()).rejects.toThrow("not been saved");
});
it("retains pending local history initialization and its original project through later bindings", async () => {
  const request = vi.fn(async (_input: AssistantRequest) => ({
    message: { id: "saved" } as AssistantMessage,
  }));
  let available = false;
  const failed = vi.fn();
  const store = new VoiceThreadTranscript(request, failed);
  store.bindPending(async () => {
    if (!available) throw new Error("Temporary lookup failure");
    return thread("original");
  }, "original-session");
  store.record("user", "Keep this accepted request");
  store.finish();
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  available = true;
  store.bind(thread("later"), "later-session");
  await store.retry();
  expect(request.mock.calls[0][0]).toMatchObject({
    threadId: "original",
    sessionId: "original-session",
    text: "Keep this accepted request",
  });
  expect(failed).toHaveBeenCalledOnce();
});
it("freezes the assistant causal receipt with its original draft across a deferred proof and lost acknowledgement", async () => {
  let resolve!: (id: string) => void;
  const proof = new Promise<string>((done) => (resolve = done));
  const request = vi.fn(async (_input: AssistantRequest) => ({
    message: { id: "saved" } as AssistantMessage,
  }));
  request.mockRejectedValueOnce(new Error("lost acknowledgement"));
  const store = new VoiceThreadTranscript(request, vi.fn());
  store.bind(thread("original"));
  store.record("assistant", "Original output", false, proof);
  store.finish();
  store.bind(thread("later"));
  expect(request).not.toHaveBeenCalled();
  resolve("captured-context");
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  await store.retry();
  expect(request.mock.calls[0][0]).toEqual(request.mock.calls[1][0]);
  expect(request.mock.calls[1][0]).toMatchObject({
    threadId: "original",
    role: "assistant",
    causalContextId: "captured-context",
    text: "Original output",
  });
  store.record("user", "New owner text", false, Promise.resolve("must-not-stamp-owner"));
  store.finish();
  await store.retry();
  expect(request.mock.calls.at(-1)![0]).not.toHaveProperty("causalContextId");
});
it("releases the exact owner receipt before a later assistant write waits on its causal proof", async () => {
  let release!: () => void;
  const admitted = new Promise<void>((done) => (release = done));
  const request = vi.fn(async (input: AssistantRequest) => {
    if (input.op !== "threads.append") throw new Error("unexpected");
    if (input.role === "user") await admitted;
    return { message: { ...input, id: input.role, createdAt: 1 } as AssistantMessage };
  });
  const store = new VoiceThreadTranscript(request, vi.fn());
  store.bind(thread("original"));
  store.record("user", "Owner");
  store.finish();
  const owner = store.ownerReceipt();
  store.record(
    "assistant",
    "Fast reply",
    false,
    owner.then(() => "same-context"),
  );
  store.finish();
  release();
  expect((await owner).message.id).toBe("user");
  await store.retry();
  expect(request.mock.calls[1][0]).toMatchObject({
    role: "assistant",
    causalContextId: "same-context",
  });
});
it("keeps a verified bounded summary plus the six latest transcript messages for local context", () => {
  const messages = Array.from(
    { length: 10 },
    (_, i) => ({ role: "user", text: String(i) }) as AssistantMessage,
  );
  const original=thread("a"),verified={...original,summaryProof:{id:"actual-proof",version:1,projectIds:["a"],throughMessageId:"prior-message",messageCount:20,createdAt:1,inputTruncated:false,omittedMessages:0}};
  expect(voiceThreadSeed(original,messages)).toHaveLength(6);
  const seed = voiceThreadSeed(verified, messages);
  expect(seed).toHaveLength(7);
  expect(seed[0].text).toContain("never new authorization");
  expect(seed[0].projectIds).toEqual(["a"]);
  expect(seed[1].text).toBe("4");
  const scope={complete:true,projectIds:["a"],current:()=>true,liveProjectIds:()=>new Set(["a"])};
  expect(voiceThreadSummary(verified,scope)?.proofId).toBe("actual-proof");
  expect(voiceThreadSummary(verified,{...scope,liveProjectIds:()=>new Set()})).toBeUndefined();
  expect(voiceThreadSummary(verified,{...scope,projectIds:[]})).toBeUndefined();
  expect(voiceThreadSummary(original,scope)).toBeUndefined();
});
it("keeps a deferred remote request transport and exact retry key after later local binding", async () => {
  const local = vi.fn(async (_input: AssistantRequest) => ({
      message: { id: "local" } as AssistantMessage,
    })),
    remote = vi.fn(async (_input: AssistantRequest) => ({
      message: { id: "remote" } as AssistantMessage,
    })),
    failed = vi.fn();
  let resolve!: (value: AssistantThread) => void;
  const opening = new Promise<AssistantThread>((done) => (resolve = done));
  const store = new VoiceThreadTranscript(local, failed);
  remote.mockRejectedValueOnce(new Error("remote acknowledgement lost"));
  store.bindPending(() => opening, "actual-remote-session", remote);
  store.record("user", "Original remote turn");
  store.finish();
  store.bind(thread("local-later"), "actual-local");
  resolve(thread("remote-original"));
  await vi.waitFor(() => expect(failed).toHaveBeenCalled());
  const original = remote.mock.calls[0][0];
  store.record("user", "Later local turn");
  store.finish();
  await store.retry();
  expect(remote.mock.calls[1][0]).toEqual(original);
  expect(original).toMatchObject({
    threadId: "remote-original",
    sessionId: "actual-remote-session",
    text: "Original remote turn",
  });
  expect(local).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ threadId: "local-later", text: "Later local turn" }),
  );
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOCIAL_READ_ACTIONS } from "./socialActions";

const { remoteRequest } = vi.hoisted(() => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest }));

import { socialClient } from "./socialClient";

/** The params object of the last social.request call. */
function lastSocialPayload(): Record<string, unknown> {
  const call = remoteRequest.mock.calls.at(-1);
  expect(call?.[1]).toBe("social.request");
  return call?.[2] as Record<string, unknown>;
}

beforeEach(() => {
  remoteRequest.mockReset();
  remoteRequest.mockResolvedValue(undefined);
});

describe("socialClient request ids", () => {
  it.each(SOCIAL_READ_ACTIONS)("sends no requestId for read-only action %s", async (action) => {
    await socialClient("m1").request(action);
    const payload = lastSocialPayload();
    expect(payload.action).toBe(action);
    expect("requestId" in payload).toBe(false);
  });

  it("keeps the legacy read-only actions without a requestId", async () => {
    await socialClient("m1").request("thread.page", { threadId: "t1" });
    expect("requestId" in lastSocialPayload()).toBe(false);
  });

  it("forwards the caller's requestId on a write action", async () => {
    await socialClient("m1").people.update({ personId: "p1", patch: { notes: "x" } }, "req-1");
    const payload = lastSocialPayload();
    expect(payload).toEqual({
      action: "people.update",
      input: { personId: "p1", patch: { notes: "x" } },
      requestId: "req-1",
    });
  });

  it("generates a requestId for a write action when the caller gives none", async () => {
    await socialClient("m1").ai.stop();
    const payload = lastSocialPayload();
    expect(payload.action).toBe("ai.stop");
    expect(typeof payload.requestId).toBe("string");
    expect(String(payload.requestId).length).toBeGreaterThan(0);
  });

  it("sends the owner confirmation with people.delete", async () => {
    await socialClient("m1").people.delete("p1", "req-2");
    expect(lastSocialPayload()).toMatchObject({
      action: "people.delete",
      input: { personId: "p1", confirm: "DELETE_PERSON" },
      requestId: "req-2",
    });
  });

  it("sends the ids that the Host reads for lists and capture rules", async () => {
    await socialClient("m1").lists.delete("l1", "req-3");
    expect(lastSocialPayload()).toEqual({
      action: "lists.delete",
      input: { id: "l1" },
      requestId: "req-3",
    });
    await socialClient("m1").captureRules.delete("r1", "req-4");
    expect(lastSocialPayload()).toMatchObject({
      action: "captureRules.delete",
      input: { id: "r1" },
    });
    await socialClient("m1").captureRules.setEnabled({ id: "r1", enabled: false }, "req-5");
    expect(lastSocialPayload()).toMatchObject({
      action: "captureRules.setEnabled",
      input: { id: "r1", enabled: false },
    });
  });

  it("sends people.score as a write with a requestId", async () => {
    await socialClient("m1").people.score("p1", "req-6");
    expect(lastSocialPayload()).toEqual({
      action: "people.score",
      input: { personId: "p1" },
      requestId: "req-6",
    });
  });

  it("calls the live view methods as their own RPC methods", async () => {
    const client = socialClient("m1");
    await client.browserViewFrame("a1");
    await client.browserViewInput("a1", { type: "scroll", deltaY: 120 });
    expect(remoteRequest.mock.calls[0]?.[1]).toBe("social.browser.view.frame");
    expect(remoteRequest.mock.calls[0]?.[2]).toEqual({ accountId: "a1" });
    expect(remoteRequest.mock.calls[1]?.[1]).toBe("social.browser.view.input");
    expect(remoteRequest.mock.calls[1]?.[2]).toEqual({
      accountId: "a1",
      event: { type: "scroll", deltaY: 120 },
    });
  });
});

it("preserves binary bytes in image and document upload payloads (#1069)", async () => {
  const client = socialClient("m1");
  const bytes = new Uint8Array([0, 128, 255, 1]);
  await client.upload(new File([bytes], "image.png", { type: "image/png" }));
  await client.uploadDocument(new File([bytes], "file.pdf", { type: "application/pdf" }));
  expect(remoteRequest.mock.calls).toEqual([
    ["m1", "social.media.upload", { base64: "AID/AQ==" }],
    ["m1", "social.media.upload", { kind: "document", base64: "AID/AQ==" }],
  ]);
});

describe("socialClient video upload resume", () => {
  const MIB = 1024 * 1024;
  const video = (size = 16) => new File([new Uint8Array(size)], "a.mp4", { type: "video/mp4" });
  const dropped = () => new Error("[RPC_TIMEOUT] Host did not answer");
  type Step = { mode: string; offset?: number };
  const modes = () => remoteRequest.mock.calls.map((call) => (call[2] as Step).mode);

  /** Host reply per call; `fail` throws once for the matching mode on its n-th occurrence. */
  function host(script: (params: Step, count: number) => Promise<unknown> | unknown) {
    const seen: Record<string, number> = {};
    remoteRequest.mockImplementation(async (_machine, _method, params: Step) => {
      seen[params.mode] = (seen[params.mode] ?? 0) + 1;
      return script(params, seen[params.mode]!);
    });
  }
  const upload = async (file: File, progress?: (percent: number) => void) => {
    vi.useFakeTimers();
    try {
      const result = socialClient("m1").uploadVideo(file, progress);
      const settled = result.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await vi.runAllTimersAsync();
      const outcome = await settled;
      if ("error" in outcome) throw outcome.error;
      return outcome.value;
    } finally {
      vi.useRealTimers();
    }
  };

  it("re-sends a chunk at the same offset after a transient failure instead of cancelling", async () => {
    host((params, count) => {
      if (params.mode === "begin") return { uploadId: "u1", offset: 0 };
      if (params.mode === "chunk" && count === 1) throw dropped();
      if (params.mode === "status") return { uploadId: "u1", offset: 0 };
      if (params.mode === "chunk") return { uploadId: "u1", offset: 16 };
      return { uploadId: "u1" };
    });
    await upload(video());
    expect(modes()).toEqual(["begin", "chunk", "status", "chunk", "finish"]);
    const chunks = remoteRequest.mock.calls
      .map((call) => call[2] as Step)
      .filter((p) => p.mode === "chunk");
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 0]);
  });

  it("accepts a chunk the Host committed whose acknowledgement was lost, without re-sending it", async () => {
    host((params, count) => {
      if (params.mode === "begin") return { uploadId: "u1", offset: 0 };
      if (params.mode === "chunk" && count === 1) throw dropped();
      if (params.mode === "status") return { uploadId: "u1", offset: 16 };
      return { uploadId: "u1", offset: 16 };
    });
    await upload(video());
    expect(modes()).toEqual(["begin", "chunk", "status", "finish"]);
  });

  it("cancels when the Host's committed offset matches neither side of the chunk", async () => {
    host((params) => {
      if (params.mode === "begin") return { uploadId: "u1", offset: 0 };
      if (params.mode === "chunk") throw dropped();
      if (params.mode === "status") return { uploadId: "u1", offset: 7 };
      return { uploadId: "u1" };
    });
    await expect(upload(video())).rejects.toThrow("order could not be verified");
    expect(modes().at(-1)).toBe("cancel");
    expect(modes()).not.toContain("finish");
  });

  it("does not retry a Host rejection and cancels the upload", async () => {
    host((params) => {
      if (params.mode === "begin") return { uploadId: "u1", offset: 0 };
      if (params.mode === "chunk")
        throw new Error("Host rejected request: Video upload is invalid, expired or busy.");
      return { uploadId: "u1" };
    });
    await expect(upload(video())).rejects.toThrow("invalid, expired or busy");
    expect(modes()).toEqual(["begin", "chunk", "cancel"]);
  });

  it("gives up after the bounded retries, cancels and reports the last failure", async () => {
    host((params) => {
      if (params.mode === "begin") return { uploadId: "u1", offset: 0 };
      if (params.mode === "status") return { uploadId: "u1", offset: 0 };
      throw dropped();
    });
    await expect(upload(video())).rejects.toThrow("RPC_TIMEOUT");
    // One first attempt plus one per entry of the retry schedule.
    expect(modes().filter((mode) => mode === "chunk")).toHaveLength(6);
    expect(modes().at(-1)).toBe("cancel");
  });

  it("keeps earlier chunks and resumes only the failed one, reporting progress in order", async () => {
    const progress: number[] = [];
    host((params, count) => {
      if (params.mode === "begin") return { uploadId: "u1", offset: 0 };
      if (params.mode === "chunk" && params.offset === MIB && count === 2) throw dropped();
      if (params.mode === "status") return { uploadId: "u1", offset: MIB };
      return { uploadId: "u1", offset: Math.min((params.offset ?? 0) + MIB, MIB + 1) };
    });
    await upload(video(MIB + 1), (percent) => progress.push(percent));
    const chunks = remoteRequest.mock.calls
      .map((call) => call[2] as Step)
      .filter((p) => p.mode === "chunk");
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, MIB, MIB]);
    expect(progress).toEqual([100, 100]);
  });
});

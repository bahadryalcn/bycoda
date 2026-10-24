import { describe, expect, it } from "vitest";
import { previewBlock } from "../../../../host/transcriptPage";
import type { Attachment, Block } from "../../sessions/model/session";
import { keepFullContent, keepFullTranscript, sameRemoteBlock } from "./remotePreview";

// Wire forms come from the host's own projection, so these cases follow it.
const file = (id: string, path: string): Attachment => ({
  id,
  name: `${id}.mkv`,
  mimeType: "video/x-matroska",
  kind: "file",
  size: 1_000_000,
  path,
});
const message = (over: Partial<Block> = {}): Block => ({
  id: "u1",
  role: "user",
  text: "look at [file1] and [file2]",
  attachments: [file("f1", "C:/Users/me/a.mkv"), file("f2", "C:/Users/me/b.mkv")],
  ...over,
});
const bigOutput = (output: string): Block =>
  ({
    id: "t1",
    role: "tool",
    text: "Shell",
    tool: { callId: "c1", title: "Shell", kind: "execute", status: "completed", output },
  }) as Block;
const wire = (block: Block, revision = 3) => previewBlock(block, revision);

describe("the host's shrunk form of a block", () => {
  it("is what the projection really makes of an attachment message", () => {
    const shrunk = wire(message());
    expect(shrunk.remoteContent).toBeDefined();
    expect(shrunk.attachments?.map((item) => item.path)).toEqual([undefined, undefined]);
  });

  it("is the same message as the full block, whatever revision it was stamped with", () => {
    expect(sameRemoteBlock(message(), wire(message(), 3))).toBe(true);
    expect(sameRemoteBlock(wire(message(), 3), wire(message(), 9))).toBe(true);
  });

  it("is the same tool row when its output was clipped", () => {
    const full = bigOutput("line\n".repeat(60_000));
    const shrunk = wire(full);
    expect(shrunk.tool?.output?.length).toBeLessThan(full.tool!.output!.length);
    expect(shrunk.tool?.outputTruncated).toBe(true);
    expect(sameRemoteBlock(full, shrunk)).toBe(true);
  });

  it("is not the same message once the visible text or an attachment differs", () => {
    const shrunk = wire(message());
    expect(sameRemoteBlock(message({ text: "something else entirely" }), shrunk)).toBe(false);
    expect(
      sameRemoteBlock(
        message({ attachments: [file("other", "C:/Users/me/c.mkv"), ...message().attachments!] }),
        shrunk,
      ),
    ).toBe(false);
  });

  it("needs the host to have shrunk it: two plain blocks are compared as they are", () => {
    const plain = { id: "a", role: "assistant", text: "hello" } as Block;
    expect(sameRemoteBlock(plain, { ...plain })).toBe(false);
    expect(sameRemoteBlock(plain, { ...plain, text: "hello" })).toBe(false);
  });
});

describe("keeping the full content the desktop already has", () => {
  it("keeps the local block when the host only sent its shrunk form", () => {
    const full = message();
    expect(keepFullContent(full, wire(full))).toBe(full);
  });

  it("keeps the clipped output and the file paths of an untouched transcript", () => {
    const mine = [
      message(),
      bigOutput("x".repeat(200_000)),
      { id: "a", role: "assistant", text: "ok" } as Block,
    ];
    const theirs = mine.map((block) => wire(block));
    const kept = keepFullTranscript(mine, theirs);
    expect(kept[0]).toBe(mine[0]);
    expect(kept[1]).toBe(mine[1]);
    expect(kept[2]).toBe(theirs[2]);
  });

  it("takes what the host changed but restores the files its shrunk copy dropped", () => {
    const full = message();
    const stamped = wire({ ...full, durationMs: 4_200 });
    const kept = keepFullContent(full, stamped);
    expect(kept.durationMs).toBe(4_200);
    expect(kept.attachments?.map((item) => item.path)).toEqual([
      "C:/Users/me/a.mkv",
      "C:/Users/me/b.mkv",
    ]);
  });

  it("takes the host block when it is already a shrunk copy here, or not shrunk at all", () => {
    const stored = wire(message(), 2);
    expect(keepFullContent(stored, wire(message(), 5)).remoteContent?.revision).toBe(5);
    const whole = { id: "u9", role: "user", text: "hi" } as Block;
    expect(keepFullContent(message(), whole)).toBe(whole);
  });

  it("returns the host transcript itself when nothing was shrunk", () => {
    const theirs = [{ id: "a", role: "assistant", text: "x" } as Block];
    expect(keepFullTranscript([], theirs)).toBe(theirs);
  });
});

describe("what the shrunk form may hide", () => {
  it("is not the same message once the host removed a flag the preview cannot show", () => {
    const queued = message({ draft: true, followUpDelivery: "pending" } as Partial<Block>);
    const delivered = message();
    expect(sameRemoteBlock(queued, wire(delivered))).toBe(false);
    const taken = keepFullContent(queued, wire(delivered));
    expect(taken).not.toBe(queued);
    expect(taken.draft).toBeUndefined();
    // The files this desktop holds are restored on the block it takes.
    expect(taken.attachments?.[0]?.path).toBe("C:/Users/me/a.mkv");
  });

  it("is not the same string when the clipped one is as long as the local value", () => {
    const local = message({ text: "see [file1]" });
    const edited = { ...wire(message({ text: "see [file1]" })), text: "see [file1]…" } as Block;
    expect(sameRemoteBlock(local, edited)).toBe(false);
  });

  it("is still the same block when only dropped fields and clipped output differ", () => {
    const full = bigOutput("line\n".repeat(60_000));
    expect(sameRemoteBlock(full, wire(full))).toBe(true);
    expect(sameRemoteBlock(message(), wire(message()))).toBe(true);
  });

  it("never vouches for a block whose array lost a middle element to the budget", () => {
    const nest = (inner: unknown, levels: number): unknown =>
      levels === 0 ? inner : [nest(inner, levels - 1)];
    const block = (inner: unknown, levels: number) =>
      ({
        id: "t2",
        role: "tool",
        text: "x".repeat(70_000),
        results: nest(inner, levels),
      }) as unknown as Block;
    // The projection only drops an array element that is an object or array
    // nested 16 deep, and keeps the primitives beside it. Those shift against
    // the full array and can never pass for one of the dropped objects.
    const deep = block([{ k: "a" }, "mid", { k: "b" }], 14);
    const projected = JSON.parse(JSON.stringify(wire(deep))) as Block;
    expect(projected.remoteContent).toBeTruthy();
    expect(sameRemoteBlock(deep, projected)).toBe(false);
    // The same content nearer the surface is only cut from the end, and still
    // the same message.
    const shallow = block(
      Array.from({ length: 40_000 }, (_, i) => ({ k: i })),
      2,
    );
    expect(sameRemoteBlock(shallow, wire(shallow))).toBe(true);
  });
});

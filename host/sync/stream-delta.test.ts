import { expect, it } from "vitest";
import type { SessionSync } from "../../src/features/connections/model/protocol";
import {
  createStreamDeltaState,
  expandStreamDelta,
  rememberStreamDelta,
  rememberStreamSnapshot,
} from "../../src/features/connections/model/sessionStreamDelta";
import { StreamDeltaEncoder, tailStreamKey, tailStreamSessionId } from "./stream-delta";

const view = (revision: number, texts: Record<string, string>, history = false) =>
  ({
    kind: "snapshot",
    value: {
      projectId: "p",
      revision,
      status: "running",
      updatedAt: 0,
      ...(history ? { history: { before: 5, revision, totalBlocks: 9 } } : {}),
      session: {
        id: "s",
        blocks: Object.entries(texts).map(([id, text]) => ({
          id,
          role: "assistant",
          text,
        })),
      },
    },
  }) as unknown as SessionSync;
const delta = (base: number, revision: number, texts: Record<string, string>, ids?: string[]) =>
  ({
    kind: "delta",
    base,
    value: {
      projectId: "p",
      revision,
      status: "running",
      updatedAt: 0,
      session: { id: "s" },
    },
    blockIds: ids ?? Object.keys(texts),
    blocks: Object.entries(texts).map(([id, text]) => ({
      id,
      role: "assistant",
      text,
    })),
  }) as unknown as SessionSync;

const long = "x".repeat(2000);

it("omits an unchanged id list and sends a streaming block as an append, and the receiver rebuilds it", () => {
  const encoder = new StreamDeltaEncoder();
  const state = createStreamDeltaState();
  const snapshot = view(1, { a: "first", b: long });
  encoder.encode("k", snapshot);
  if (snapshot.kind === "snapshot") rememberStreamSnapshot(state, snapshot.value.session.blocks);
  const next = delta(1, 2, { b: long + " more" }, ["a", "b"]);
  const wire = encoder.encode("k", next) as unknown as Record<string, unknown>;
  expect(wire).not.toHaveProperty("blockIds");
  expect(wire.textAppends).toEqual([{ id: "b", baseLength: 2000, text: " more" }]);
  expect(JSON.stringify(wire).length).toBeLessThan(600);
  const expanded = expandStreamDelta(JSON.parse(JSON.stringify(wire)), state) as {
    blockIds: string[];
    blocks: { id: string; text: string }[];
  };
  expect(expanded.blockIds).toEqual(["a", "b"]);
  expect(expanded.blocks[0]?.text).toBe(long + " more");
  rememberStreamDelta(state, expanded.blockIds, expanded.blocks);
  // The next append builds on the rebuilt text.
  const third = encoder.encode("k", delta(2, 3, { b: long + " more!" }, ["a", "b"])) as unknown as {
    textAppends: unknown;
  };
  expect(third.textAppends).toEqual([{ id: "b", baseLength: 2005, text: "!" }]);
});

it("sends the id list when it changed and never compacts against an uncommitted revision", () => {
  const encoder = new StreamDeltaEncoder();
  encoder.encode("k", view(1, { a: "first", b: long }));
  const grown = encoder.encode("k", delta(1, 2, { c: "new" }, ["a", "b", "c"])) as unknown as {
    blockIds: string[];
  };
  expect(grown.blockIds).toEqual(["a", "b", "c"]);
  // The hub's committed revision is still 1 (event 2 was dropped): send everything.
  const resent = encoder.encode("k", delta(1, 3, { b: long + "!", c: "new" }, ["a", "b", "c"]));
  expect(resent).toHaveProperty("blockIds");
  expect(resent).not.toHaveProperty("textAppends");
});

it("leaves short and rewritten text whole", () => {
  const encoder = new StreamDeltaEncoder();
  encoder.encode("k", view(1, { a: "short", b: long }));
  const wire = encoder.encode(
    "k",
    delta(1, 2, { a: "short and more", b: "rewritten" + long }, ["a", "b"]),
  ) as unknown as { textAppends?: unknown };
  expect(wire.textAppends).toBeUndefined();
});

it("remembers a windowed stream's first block only for the committed revision", () => {
  const encoder = new StreamDeltaEncoder();
  encoder.encode("k", view(4, { w1: "a", w2: "b" }, true));
  expect(encoder.windowStart("k", 4)).toBe("w1");
  expect(encoder.windowStart("k", 5)).toBeUndefined();
  expect(encoder.windowStart("other", 4)).toBeUndefined();
  encoder.retain(() => false);
  expect(encoder.windowStart("k", 4)).toBeUndefined();
});

it("rejects an append that does not follow the receiver's text", () => {
  const state = createStreamDeltaState();
  rememberStreamSnapshot(state, [{ id: "b", text: "short" }]);
  expect(() =>
    expandStreamDelta(
      {
        blocks: [{ id: "b", text: "" }],
        textAppends: [{ id: "b", baseLength: 2000, text: "x" }],
      },
      state,
    ),
  ).toThrow("previous text");
  expect(() => expandStreamDelta({ blocks: [] }, createStreamDeltaState())).toThrow("block list");
});

it("keeps a stream whose principal id contains colons while its session is subscribed", () => {
  const encoder = new StreamDeltaEncoder();
  const key = tailStreamKey("crew:alpha:7", "session-1");
  expect(tailStreamSessionId(key)).toBe("session-1");
  encoder.encode(key, view(4, { w1: "a" }, true));
  encoder.retain((candidate) => tailStreamSessionId(candidate) === "session-1");
  expect(encoder.windowStart(key, 4)).toBe("w1");
  encoder.retain((candidate) => tailStreamSessionId(candidate) === "other");
  expect(encoder.windowStart(key, 4)).toBeUndefined();
});

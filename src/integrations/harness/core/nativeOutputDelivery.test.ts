import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import vectors from "./nativeOutputDelivery.fixture.json";
import type {
  NativeOutputChannel,
  NativeOutputMetadata,
  NativeOutputState,
} from "./nativeOutputDelivery";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
});

it("bounds diagnostic outcomes without disabling long streams or evicting retained work ownership", async () => {
  const api = await import("./nativeOutputDelivery");
  let retained: ReturnType<typeof api.captureNativeOutputWork> = null;
  const items = Array.from({ length: 4096 }, () => "delta");
  for (let sequence = 1; sequence <= 9; sequence++) {
    const tokens = api.observeNativeOutputBatch(
      "session",
      "stdout",
      items,
      wire("stdout", items, { sequence }),
    )!;
    expect(tokens).toHaveLength(items.length);
    for (let index = 0; index < tokens.length; index++)
      api.deliverNativeOutputItem(tokens[index], () => {
        if (sequence === 1 && index === 0) retained = api.captureNativeOutputWork();
      });
    await vi.waitFor(() =>
      expect(api.inspectNativeOutputDelivery("session").streams[0].deliveredThrough).toBe(sequence),
    );
  }
  const stream = api.inspectNativeOutputDelivery("session").streams[0];
  expect(stream.outcomes).toHaveLength(32768);
  expect(stream.unavailableReason).toBeNull();
  const joined = api.joinNativeOutputWorks([retained!], "session");
  expect(joined).not.toBeNull();
  joined!.finish();
  retained!.finish();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const ids = {
  processEpoch: "11111111-1111-4111-8111-111111111111",
  streamEpoch: "22222222-2222-4222-8222-222222222222",
  storeInstance: "33333333-3333-4333-8333-333333333333",
  ownerEpoch: "44444444-4444-4444-8444-444444444444",
};
// Independent Node Buffer codec, checked against Python goldens below.
function wire(
  channel: NativeOutputChannel,
  items: readonly string[],
  extra: Partial<NativeOutputMetadata> = {},
): NativeOutputMetadata {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(items.length);
  const frame = Buffer.concat([
    Buffer.from("bycoda-native-output-items-v1\0"),
    Buffer.from([channel === "stdout" ? 1 : channel === "stderr" ? 2 : 3]),
    count,
    ...items.flatMap((item) => {
      const value = Buffer.from(item);
      const length = Buffer.alloc(8);
      length.writeBigUInt64LE(BigInt(value.length));
      return [length, value];
    }),
  ]);
  return {
    ...ids,
    version: 1,
    qualified: false,
    sessionId: "session",
    streamKind: channel === "sse" ? "sse" : "process",
    sourceStoreId: "store",
    sourceProfileId: "profile",
    processId: channel === "sse" ? null : 42,
    channel,
    sequence: 1,
    itemCount: items.length,
    utf8Bytes: items.reduce((sum, item) => sum + Buffer.byteLength(item), 0),
    payloadSha256: createHash("sha256").update(frame).digest("hex"),
    digestEncoding: "bycoda-output-items-le/v1",
    available: true,
    unavailableReason: null,
    ...extra,
  };
}
function terminal(
  metadata: NativeOutputMetadata,
  extra: Partial<NativeOutputState> = {},
): NativeOutputState {
  const {
    processEpoch,
    streamEpoch,
    streamKind,
    sessionId,
    logicalSessionId,
    sourceStoreId,
    sourceProfileId,
    storeInstance,
    processId,
    ownerEpoch,
  } = metadata;
  return {
    version: 1,
    qualified: false,
    processEpoch,
    streamEpoch,
    streamKind,
    sessionId,
    ...(logicalSessionId === undefined ? {} : { logicalSessionId }),
    sourceStoreId,
    sourceProfileId,
    storeInstance,
    processId,
    ownerEpoch,
    lastSequence: metadata.sequence,
    state: "sealed",
    reason: null,
    ...extra,
  };
}
const load = () => import("./nativeOutputDelivery");

it.each([false, true])(
  "invalidates only original A while same-route B remains retained (B exited: %s)",
  async (bExited) => {
    const api = await load();
    const a = wire("stdout", ["A"]);
    const b = wire("stdout", ["B"], {
      streamEpoch: "55555555-5555-4555-8555-555555555555",
    });
    const [aItem] = api.observeNativeOutputBatch("session", "stdout", ["A"], a)!;
    const [bItem] = api.observeNativeOutputBatch("session", "stdout", ["B"], b)!;
    let aWork!: NonNullable<ReturnType<typeof api.captureNativeOutputWork>>;
    let bWork!: NonNullable<ReturnType<typeof api.captureNativeOutputWork>>;
    api.deliverNativeOutputItem(aItem, () => {
      aWork = api.captureNativeOutputWork()!;
    });
    api.deliverNativeOutputItem(bItem, () => {
      bWork = api.captureNativeOutputWork()!;
    });
    await vi.waitFor(() => {
      expect(
        api
          .inspectNativeOutputDelivery("session")
          .streams.every((stream) => stream.receivedThrough === 1),
      ).toBe(true);
    });
    if (bExited) api.observeNativeOutputState("session", terminal(b));
    const before = api
      .inspectNativeOutputDelivery("session")
      .streams.find((stream) => stream.streamEpoch === b.streamEpoch);
    api.invalidateNativeOutputConstruction("session", a.streamEpoch, "original-A-closed");
    const after = api.inspectNativeOutputDelivery("session");
    expect(after.streams.find((stream) => stream.streamEpoch === a.streamEpoch)).toMatchObject({
      unavailableReason: "original-A-closed",
      pendingCausalWork: 1,
    });
    expect(after.streams.find((stream) => stream.streamEpoch === b.streamEpoch)).toEqual(before);
    expect(after.retentionUnavailable).toBe(false);
    expect(after.qualified).toBe(false);
    aWork.finish();
    bWork.finish();
  },
);

it("retains original invalidation before delayed A metadata or terminal without poisoning B", async () => {
  const api = await load();
  const a = wire("stdout", ["late-A"]);
  const b = wire("stdout", ["B"], { streamEpoch: "55555555-5555-4555-8555-555555555555" });
  const [bItem] = api.observeNativeOutputBatch("session", "stdout", ["B"], b)!;
  api.deliverNativeOutputItem(bItem, () => api.markNativeOutputSupportedNoEffect("fixture-read"));
  await vi.waitFor(() =>
    expect(api.inspectNativeOutputDelivery("session").streams[0].receivedThrough).toBe(1),
  );
  const before = api.inspectNativeOutputDelivery("session").streams[0];
  api.invalidateNativeOutputConstruction("session", a.streamEpoch, "A-retired-before-metadata");
  api.invalidateNativeOutputConstruction("session", a.streamEpoch, "later-duplicate-reason");
  api.observeNativeOutputState("session", terminal(a, { state: "unsealed", lastSequence: 0 }));
  expect(api.observeNativeOutputBatch("session", "stdout", ["late-A"], a)).toBeUndefined();
  const after = api.inspectNativeOutputDelivery("session");
  expect(
    after.streams.find((stream) => stream.streamEpoch === a.streamEpoch)?.unavailableReason,
  ).toBe("A-retired-before-metadata");
  expect(after.streams.find((stream) => stream.streamEpoch === b.streamEpoch)).toEqual(before);
  expect(after.retentionUnavailable).toBe(false);
});

it("matches the exact process route and stream epoch rather than registry epoch, logical alias or SSE", async () => {
  const api = await load();
  const process = wire("stdout", ["A"]);
  const alias = wire("stdout", ["alias"], {
    sessionId: "session#other",
    logicalSessionId: "session",
    processEpoch: "55555555-5555-4555-8555-555555555555",
  });
  const sse = wire("sse", ["event"], {
    processEpoch: "66666666-6666-4666-8666-666666666666",
  });
  for (const metadata of [process, alias, sse]) {
    const items = metadata === process ? ["A"] : metadata === alias ? ["alias"] : ["event"];
    const tokens = api.observeNativeOutputBatch(
      metadata.sessionId,
      metadata.channel,
      items,
      metadata,
    )!;
    for (const item of tokens)
      api.deliverNativeOutputItem(item, () =>
        api.markNativeOutputSupportedNoEffect("fixture-read"),
      );
  }
  await vi.waitFor(() =>
    expect(
      api
        .inspectNativeOutputDelivery("session")
        .streams.every((stream) => stream.receivedThrough === 1),
    ).toBe(true),
  );
  const before = api.inspectNativeOutputDelivery("session");
  api.invalidateNativeOutputConstruction(
    "session",
    ids.processEpoch,
    "registry-is-not-construction",
  );
  expect(api.inspectNativeOutputDelivery("session")).toEqual(before);
  api.invalidateNativeOutputConstruction("session", process.streamEpoch, "A-only");
  const after = api.inspectNativeOutputDelivery("session");
  expect(
    after.streams.find((stream) => stream.processEpoch === process.processEpoch)?.unavailableReason,
  ).toBe("A-only");
  expect(after.streams.filter((stream) => stream.processEpoch !== process.processEpoch)).toEqual(
    before.streams.filter((stream) => stream.processEpoch !== process.processEpoch),
  );
});

it("preserves legacy session quarantine while known construction invalidation remains scoped", async () => {
  const api = await load();
  const metadata = wire("stdout", ["legacy-owner"]);
  api.observeNativeOutputBatch("session", "stdout", ["legacy-owner"], metadata);
  api.invalidateNativeOutputConstruction(
    "session",
    "legacy-missing-construction",
    "legacy-unknown",
  );
  expect(api.inspectNativeOutputDelivery("session")).toMatchObject({ retentionUnavailable: true });
  api.invalidateNativeOutputConstruction("session", metadata.streamEpoch, "known-original");
  expect(api.inspectNativeOutputDelivery("session")).toMatchObject({
    retentionUnavailable: true,
    streams: [{ unavailableReason: "legacy-unknown" }],
  });
});

it("retains unidentified invocation quarantine before its first metadata without upgrading a later exact identity", async () => {
  const api = await load();
  api.quarantineNativeOutputSession("session", "invoked-source-unknown");
  expect(api.inspectNativeOutputDelivery("session")).toMatchObject({
    retentionUnavailable: true,
    streams: [],
  });
  const metadata = wire("stdout", ["late-source"]);
  api.observeNativeOutputBatch("session", "stdout", ["late-source"], metadata);
  api.invalidateNativeOutputConstruction("session", metadata.streamEpoch, "later-exact-identity");
  expect(api.inspectNativeOutputDelivery("session")).toMatchObject({
    retentionUnavailable: true,
    qualified: false,
  });
});

it("does not lose delayed construction quarantine when tracker ownership is globally retired", async () => {
  const api = await load();
  const a = wire("stdout", ["late-A"]);
  const b = wire("stdout", ["B"], { streamEpoch: "55555555-5555-4555-8555-555555555555" });
  api.observeNativeOutputBatch("session", "stdout", ["B"], b);
  api.invalidateNativeOutputConstruction("session", a.streamEpoch, "A-original-retired");
  // This is the same conservative invalidation invoked by the HMR disposer.
  api.invalidateNativeOutputDelivery("tracker-reloaded");
  api.observeNativeOutputBatch("session", "stdout", ["late-A"], a);
  const observed = api.inspectNativeOutputDelivery("session");
  expect(
    observed.streams.find((stream) => stream.streamEpoch === a.streamEpoch)?.unavailableReason,
  ).toBe("A-original-retired");
  expect(
    observed.streams.find((stream) => stream.streamEpoch === b.streamEpoch)?.unavailableReason,
  ).toBe("tracker-reloaded");
  expect(observed.qualified).toBe(false);
});

it("keeps unresolved construction tombstones at capacity and quarantines overflow and future sources", async () => {
  const api = await load();
  const b = wire("stdout", ["B"]);
  api.observeNativeOutputBatch("session", "stdout", ["B"], b);
  const construction = (index: number) =>
    `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  for (let index = 0; index < 512; index++)
    api.invalidateNativeOutputConstruction("session", construction(index), `retired-${index}`);
  expect(api.inspectNativeOutputDelivery("session").retentionUnavailable).toBe(false);
  api.invalidateNativeOutputConstruction("session", construction(512), "unretained-overflow");
  expect(api.inspectNativeOutputDelivery("session")).toMatchObject({
    retentionUnavailable: true,
    streams: [{ unavailableReason: "construction-invalidation-capacity" }],
  });
  const delayed = wire("stdout", ["late-A"], { streamEpoch: construction(0) });
  api.observeNativeOutputBatch("session", "stdout", ["late-A"], delayed);
  const future = wire("stdout", ["new-source"], { streamEpoch: construction(513) });
  api.observeNativeOutputBatch("session", "stdout", ["new-source"], future);
  const observed = api.inspectNativeOutputDelivery("session");
  expect(
    observed.streams.find((stream) => stream.streamEpoch === delayed.streamEpoch)
      ?.unavailableReason,
  ).toBe("retired-0");
  expect(
    observed.streams.find((stream) => stream.streamEpoch === future.streamEpoch)?.unavailableReason,
  ).toBe("construction-invalidation-capacity");
  expect(observed.retentionUnavailable).toBe(true);
  expect(observed.qualified).toBe(false);
});

it("joins retained original inputs atomically and preserves all constituents through alias/projection", async () => {
  const api = await load();
  const lines = ["first-fragment", "completing-fragment"];
  const tokens = api.observeNativeOutputBatch("session", "stdout", lines, wire("stdout", lines))!;
  const works = tokens.map((token) => {
    let work!: NonNullable<ReturnType<typeof api.captureNativeOutputWork>>;
    api.deliverNativeOutputItem(token, () => {
      work = api.captureNativeOutputWork()!;
    });
    return work;
  });
  const joined = api.joinNativeOutputWorks(works, "session")!;
  expect(joined).not.toBeNull();
  works.forEach((work) => work.finish());
  const event = {},
    alias = {};
  api.captureNativeOutputWorkEvent(joined, event);
  api.transferNativeOutputEventOrigin(event, alias);
  const origin = api.getNativeOutputEventOrigin(alias)!;
  expect(origin).toBe(joined.origin);
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
  await vi.waitFor(() => expect(api.getNativeOutputEventOriginComparisons(origin)).toHaveLength(2));
  const comparisons = api.getNativeOutputEventOriginComparisons(origin)!;
  expect(comparisons.map((item) => item.itemIndex)).toEqual([0, 1]);
  expect(Object.isFrozen(comparisons)).toBe(true);
  api.markNativeOutputEventsApplied("session", [alias]);
  api.markNativeOutputOriginProjectionAccepted(origin, "session");
  joined.finish();
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    pendingCausalWork: 0,
    queuedEvents: 1,
    appliedEvents: 1,
    outcomes: [{ outcome: "accepted-projection" }, { outcome: "accepted-projection" }],
  });
  api.discardNativeOutputItems([tokens[0]], "late-member-retirement");
  expect(api.getNativeOutputEventOriginComparisons(origin)).toBeNull();
});

it("retains zero-event parser outcomes after batch advance and requires an explicit supported no-effect", async () => {
  const api = await load();
  const lines = ["unfinished-json", "known-no-effect"];
  const tokens = api.observeNativeOutputBatch("session", "stdout", lines, wire("stdout", lines))!;
  api.deliverNativeOutputItem(tokens[0], () => undefined);
  api.deliverNativeOutputItem(tokens[1], () =>
    api.markNativeOutputSupportedNoEffect("fixture-known-control"),
  );
  await vi.waitFor(() =>
    expect(api.inspectNativeOutputDelivery("session").streams[0].pendingBatches).toBe(0),
  );
  expect(api.inspectNativeOutputDelivery("session").streams[0].outcomes).toMatchObject([
    { outcome: "pending-parser", reason: null },
    { outcome: "supported-no-effect", reason: "fixture-known-control" },
  ]);
});

it.each(["forged", "finished", "recipient", "store", "session"])(
  "rejects %s join members without minting partial lineage",
  async (kind) => {
    const api = await load();
    const metadata = wire("stdout", ["original"]);
    const [first] = api.observeNativeOutputBatch("session", "stdout", ["original"], metadata)!;
    let a!: NonNullable<ReturnType<typeof api.captureNativeOutputWork>>;
    api.deliverNativeOutputItem(first, () => {
      a = api.captureNativeOutputWork()!;
    });
    let b = a;
    if (kind === "forged") b = { ...a };
    else if (kind === "finished") a.finish();
    else {
      const other = wire("stdout", ["other"], {
        streamEpoch: "66666666-6666-4666-8666-666666666666",
        ...(kind === "recipient"
          ? { ownerEpoch: "other-owner" }
          : kind === "store"
            ? { sourceStoreId: "other-store" }
            : { sessionId: "other-session" }),
      });
      const [token] = api.observeNativeOutputBatch(other.sessionId, "stdout", ["other"], other)!;
      api.deliverNativeOutputItem(token, () => {
        b = api.captureNativeOutputWork()!;
      });
    }
    expect(api.joinNativeOutputWorks([a, b], "session")).toBeNull();
    a.finish();
    b.finish();
    expect(api.inspectNativeOutputDelivery("session").streams[0].pendingCausalWork).toBe(0);
  },
);

it("invalidates a whole joined comparison when only one original stream becomes unavailable", async () => {
  const api = await load();
  const works = [ids.streamEpoch, "66666666-6666-4666-8666-666666666666"].map((streamEpoch) => {
    const [item] = api.observeNativeOutputBatch(
      "session",
      "stdout",
      ["part"],
      wire("stdout", ["part"], { streamEpoch }),
    )!;
    let work!: NonNullable<ReturnType<typeof api.captureNativeOutputWork>>;
    api.deliverNativeOutputItem(item, () => {
      work = api.captureNativeOutputWork()!;
    });
    return { item, work };
  });
  const joined = api.joinNativeOutputWorks(works.map((entry) => entry.work))!;
  await vi.waitFor(() =>
    expect(api.getNativeOutputEventOriginComparisons(joined.origin)).toHaveLength(2),
  );
  api.discardNativeOutputItems([works[1].item], "one-member-unavailable");
  expect(api.getNativeOutputEventOriginComparisons(joined.origin)).toBeNull();
  expect(api.getNativeOutputEventOriginComparison(works[0].work.origin)).not.toBeNull();
  joined.finish();
  works.forEach((entry) => entry.work.finish());
});

it("matches independent Python framing vectors including BOM, Unicode, boundaries and an empty line", async () => {
  const api = await load();
  for (const vector of vectors.cases) {
    const frame = api.frameNativeOutputItems(vector.channel as NativeOutputChannel, vector.items);
    expect(Buffer.from(frame).toString("hex")).toBe(vector.frameHex);
    expect(wire(vector.channel as NativeOutputChannel, vector.items).payloadSha256).toBe(
      vector.sha256,
    );
    expect(wire(vector.channel as NativeOutputChannel, vector.items).utf8Bytes).toBe(
      vector.utf8Bytes,
    );
  }
  expect(() => api.frameNativeOutputItems("stdout", ["\ud800"])).toThrow("UTF8");
  expect(() =>
    api.frameNativeOutputItems("stdout", ["x".repeat(700_000), "x".repeat(700_000)]),
  ).toThrow("CAPACITY");
});

it("distinguishes verified reception, callback delivery, real application and missing durable/provider proof", async () => {
  const api = await load();
  const items = ["hello", "漢"];
  const metadata = wire("stdout", items);
  const tokens = api.observeNativeOutputBatch("session", "stdout", items, metadata)!;
  await vi.waitFor(() =>
    expect(api.inspectNativeOutputDelivery("session").streams[0].receivedThrough).toBe(1),
  );
  expect(api.inspectNativeOutputDelivery("session").streams[0].deliveredThrough).toBe(0);
  const events = items.map((text) => ({ type: "message.delta", text }));
  for (let i = 0; i < items.length; i++)
    api.deliverNativeOutputItem(tokens[i], () =>
      api.captureNativeOutputEvent("session", events[i]),
    );
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    deliveredThrough: 1,
    queuedEvents: 2,
    appliedEvents: 0,
  });
  api.markNativeOutputEventsApplied("session", events);
  api.markNativeOutputEventsApplied("session", events); // idempotent actual event receipts
  api.observeNativeOutputState("session", terminal(metadata));
  expect(api.inspectNativeOutputDelivery("session")).toMatchObject({
    qualified: false,
    coverage: "unverified",
    streams: [{ appliedEvents: 2, applicationThrough: null, nativeState: "sealed" }],
  });
});

it("keeps legacy delivery on a bad digest and permanently reports unavailable rather than fabricating an empty prefix", async () => {
  const api = await load();
  const items = ["original"];
  const tokens = api.observeNativeOutputBatch(
    "session",
    "stdout",
    items,
    wire("stdout", items, { payloadSha256: "0".repeat(64) }),
  )!;
  const handler = vi.fn();
  api.deliverNativeOutputItem(tokens[0], () => handler(items[0]));
  await vi.waitFor(() =>
    expect(api.inspectNativeOutputDelivery("session").streams[0].unavailableReason).toBe(
      "payload-digest",
    ),
  );
  expect(handler).toHaveBeenCalledExactlyOnceWith("original");
  expect(api.inspectNativeOutputDelivery("session").streams[0].deliveredThrough).toBe(0);
});

it.each(["gap", "replay", "source", "channel", "owner"] as const)(
  "rejects %s changes without suppressing an ordinary provider handler",
  async (kind) => {
    const api = await load();
    const items = ["kept"];
    const metadata = wire("stdout", items);
    if (kind !== "gap") {
      const tokens = api.observeNativeOutputBatch("session", "stdout", items, metadata)!;
      api.deliverNativeOutputItem(tokens[0], () => {});
    }
    const changed = {
      ...metadata,
      sequence: kind === "gap" ? 2 : kind === "replay" ? 1 : 2,
      ...(kind === "source" ? { storeInstance: "55555555-5555-4555-8555-555555555555" } : {}),
      ...(kind === "channel" ? { streamKind: "sse" as const } : {}),
      ...(kind === "owner" ? { ownerEpoch: null } : {}),
    };
    expect(api.observeNativeOutputBatch("session", "stdout", items, changed)).toBeUndefined();
    expect(api.inspectNativeOutputDelivery("session").streams[0].unavailableReason).not.toBeNull();
  },
);

it("does not infer final output from an unsealed EXIT hint, and rejects output after a final seal", async () => {
  const api = await load();
  const items = ["line"];
  const metadata = wire("stdout", items);
  const tokens = api.observeNativeOutputBatch("session", "stdout", items, metadata)!;
  api.deliverNativeOutputItem(tokens[0], () => {});
  api.observeNativeOutputState("session", terminal(metadata, { state: "unsealed" }));
  expect(api.inspectNativeOutputDelivery("session").streams[0].nativeState).toBe("unsealed");
  api.observeNativeOutputState("session", terminal(metadata));
  api.observeNativeOutputBatch("session", "stdout", items, { ...metadata, sequence: 2 });
  expect(api.inspectNativeOutputDelivery("session").streams[0].unavailableReason).toBe(
    "output-after-seal",
  );
});

it("rejects a forged token, cross-session application and provider handler failures", async () => {
  const api = await load();
  const event = {};
  api.deliverNativeOutputItem({ kind: "native-output-item" }, () =>
    api.captureNativeOutputEvent("session", event),
  );
  const tokens = api.observeNativeOutputBatch("session", "stdout", ["x"], wire("stdout", ["x"]))!;
  api.deliverNativeOutputItem(tokens[0], () => api.captureNativeOutputEvent("session", event));
  api.markNativeOutputEventsApplied("other", [event]);
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    appliedEvents: 0,
    unavailableReason: "event-session-changed",
  });
  const other = wire("stdout", ["x"], {
    sessionId: "failure",
    streamEpoch: "66666666-6666-4666-8666-666666666666",
  });
  const failureTokens = api.observeNativeOutputBatch("failure", "stdout", ["x"], other)!;
  expect(() =>
    api.deliverNativeOutputItem(failureTokens[0], () => {
      throw new Error("parser");
    }),
  ).toThrow("parser");
  expect(api.inspectNativeOutputDelivery("failure").streams[0].unavailableReason).toBe(
    "handler-failed",
  );
});

it("retains hash permits until actual work settles, even after invalidation", async () => {
  const api = await load();
  const waiting: Array<(value: ArrayBuffer) => void> = [];
  vi.spyOn(crypto.subtle, "digest").mockImplementation(
    () => new Promise<ArrayBuffer>((resolve) => waiting.push(resolve)),
  );
  for (let i = 0; i < 33; i++) {
    const name = `session-${i}`;
    const metadata = wire("stdout", ["x"], {
      sessionId: name,
      streamEpoch: `${i.toString(16).padStart(8, "0")}-2222-4222-8222-222222222222`,
    });
    api.observeNativeOutputBatch(name, "stdout", ["x"], metadata);
  }
  await vi.waitFor(() => expect(waiting).toHaveLength(32));
  expect(api.inspectNativeOutputDelivery("session-32").streams[0].unavailableReason).toBe(
    "renderer-capacity",
  );
  api.invalidateNativeOutputDelivery("closed");
  api.observeNativeOutputBatch(
    "after-close",
    "stdout",
    ["x"],
    wire("stdout", ["x"], {
      sessionId: "after-close",
      streamEpoch: "77777777-7777-4777-8777-777777777777",
    }),
  );
  expect(api.inspectNativeOutputDelivery("after-close").streams[0].unavailableReason).toBe(
    "renderer-capacity",
  );
  const expected = Buffer.from(wire("stdout", ["x"]).payloadSha256, "hex");
  for (const resolve of waiting)
    resolve(expected.buffer.slice(expected.byteOffset, expected.byteOffset + expected.byteLength));
  await vi.waitFor(() =>
    expect(api.inspectNativeOutputDelivery("session-0").streams[0].unavailableReason).toBe(
      "closed",
    ),
  );
});

it("owns deferred descendants before scheduling and keeps original event origins through awaits", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["deferred"],
    wire("stdout", ["deferred"]),
  )!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const event = {};
  let job!: Promise<void>;
  api.deliverNativeOutputItem(item, () => {
    job = api.runNativeOutputWork(async (work) => {
      await held;
      api.nativeOutputSink(work, () => api.captureNativeOutputEvent("session", event))();
    });
  });
  expect(api.inspectNativeOutputDelivery("session").streams[0].pendingCausalWork).toBe(1);
  // A detached/expired observer cannot release actual work.
  await Promise.race([job, Promise.resolve("waiter-deadline")]);
  expect(api.inspectNativeOutputDelivery("session").streams[0].pendingCausalWork).toBe(1);
  release();
  await job;
  const origin = api.getNativeOutputEventOrigin(event)!;
  expect(origin).not.toBeNull();
  expect(api.getNativeOutputEventOrigin(event)).toBe(origin);
  const write = api.retainNativeOutputEventOrigin(origin, "session")!;
  expect(write).not.toBeNull();
  expect(api.retainNativeOutputEventOrigin({ kind: "native-output-origin" }, "session")).toBeNull();
  write.finish();
  write.finish();
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    pendingCausalWork: 0,
    finishedCausalWork: 2,
    applicationThrough: null,
  });
});

it("a failed descendant stays unavailable and late use cannot acquire fresh event lineage", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["failure"],
    wire("stdout", ["failure"]),
  )!;
  let job!: Promise<unknown>;
  let work: ReturnType<typeof api.captureNativeOutputWork> = null;
  api.deliverNativeOutputItem(item, () => {
    job = api.runNativeOutputWork(async (owned) => {
      work = owned;
      await Promise.resolve();
      throw new Error("actual failure");
    });
  });
  await expect(job).rejects.toThrow("actual failure");
  const event = {};
  work!.run(() => api.captureNativeOutputEvent("session", event));
  expect(api.getNativeOutputEventOrigin(event)).toBeNull();
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "causal-work-rejected",
    applicationThrough: null,
  });
});

it("keeps logical construction binding separate from opaque child routing and rejects target mismatch", async () => {
  const api = await load();
  const metadata = wire("stdout", ["logical"], {
    sessionId: "session#17",
    logicalSessionId: "session",
  });
  const [item] = api.observeNativeOutputBatch("session#17", "stdout", ["logical"], metadata)!;
  const event = {};
  api.deliverNativeOutputItem(item, () => api.captureNativeOutputEvent("session", event));
  const origin = api.getNativeOutputEventOrigin(event)!;
  expect(api.retainNativeOutputEventOrigin(origin, "other")).toBeNull();
  expect(api.retainNativeOutputEventOrigin(origin, "session#17")).toBeNull();
  const own = api.retainNativeOutputEventOrigin(origin, "session")!;
  expect(own).not.toBeNull();
  own.finish();
  api.observeNativeOutputState("session#17", terminal(metadata));
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    unavailableReason: "causal-session-changed",
    nativeState: "sealed",
    applicationThrough: null,
  });
});

it("preserves an early queued origin across clone/requeue but rejects applied event replay", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["clone"],
    wire("stdout", ["clone"]),
  )!;
  const original = {},
    clone = {};
  api.deliverNativeOutputItem(item, () => api.captureNativeOutputEvent("session", original));
  const origin = api.getNativeOutputEventOrigin(original);
  api.transferNativeOutputEventOrigin(original, clone);
  api.captureNativeOutputEvent("session", clone);
  expect(api.getNativeOutputEventOrigin(clone)).toBe(origin);
  api.markNativeOutputEventsApplied("session", [clone]);
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    queuedEvents: 1,
    appliedEvents: 1,
  });
  api.captureNativeOutputEvent("session", clone);
  expect(api.inspectNativeOutputDelivery("session").streams[0].unavailableReason).toBe(
    "event-requeued-after-apply",
  );
});

it("bounds actual descendant leases and retains a capacity fault after successful settlements", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["many"],
    wire("stdout", ["many"]),
  )!;
  const jobs: NonNullable<ReturnType<typeof api.captureNativeOutputWork>>[] = [];
  api.deliverNativeOutputItem(item, () => {
    for (let n = 0; n < 128; n++) jobs.push(api.captureNativeOutputWork()!);
    expect(api.captureNativeOutputWork()).toBeNull();
  });
  expect(jobs.every(Boolean)).toBe(true);
  expect(api.inspectNativeOutputDelivery("session").streams[0].pendingCausalWork).toBe(128);
  for (const job of jobs) job.finish();
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "causal-work-capacity",
  });
});

it("accounts descendant file/HTTP input without treating its data as Native sealed output", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["poll"],
    wire("stdout", ["poll"]),
  )!;
  api.deliverNativeOutputItem(item, () =>
    api.captureNativeOutputWork({ additionalInput: true })!.finish(),
  );
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    additionalUnsealedInputs: 1,
    unavailableReason: "additional-input-unsealed",
    applicationThrough: null,
  });
});

it("owns a timer before scheduling and never releases a running callback on clear", async () => {
  const api = await load();
  vi.useFakeTimers();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["timer"],
    wire("stdout", ["timer"]),
  )!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const event = {};
  let timer!: ReturnType<typeof setTimeout>;
  try {
    api.deliverNativeOutputItem(item, () => {
      timer = api.scheduleNativeOutputCallback(async (work) => {
        await gate;
        api.nativeOutputSink(work, () => api.captureNativeOutputEvent("session", event))();
      }, 10);
    });
    expect(api.inspectNativeOutputDelivery("session").streams[0].pendingCausalWork).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    api.cancelNativeOutputCallback(timer);
    expect(api.inspectNativeOutputDelivery("session").streams[0].pendingCausalWork).toBe(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.getNativeOutputEventOrigin(event)).not.toBeNull();
    expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
      pendingCausalWork: 0,
      unavailableReason: "causal-timer-retired",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("retains active work when tracker ownership is invalidated for reload", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["reload"],
    wire("stdout", ["reload"]),
  )!;
  let work: ReturnType<typeof api.captureNativeOutputWork> = null;
  api.deliverNativeOutputItem(item, () => {
    work = api.captureNativeOutputWork();
  });
  api.invalidateNativeOutputDelivery("tracker-reloaded");
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    pendingCausalWork: 1,
    unavailableReason: "tracker-reloaded",
  });
  work!.finish();
  expect(api.inspectNativeOutputDelivery("session").streams[0]).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "tracker-reloaded",
    applicationThrough: null,
  });
});

it("exposes one exact immutable original descriptor and zero-based index only after the real digest settles", async () => {
  const api = await load();
  const actualDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
    await held;
    return actualDigest(algorithm, data);
  });
  const items = ["\uFEFFfirst", "漢", "last"];
  const metadata = {
    ...wire("stdout", items, { sessionId: "route#17", logicalSessionId: "session" }),
  };
  const expected: Record<string, unknown> = { ...metadata };
  delete expected.available;
  delete expected.unavailableReason;
  const tokens = api.observeNativeOutputBatch("route#17", "stdout", items, metadata)!;
  const handles = tokens.map((token) => {
    const event = {};
    api.deliverNativeOutputItem(token, () => api.captureNativeOutputEvent("session", event));
    return api.getNativeOutputEventOrigin(event)!;
  });
  expect(handles.every(Boolean)).toBe(true);
  for (const origin of handles)
    expect(api.getNativeOutputEventOriginComparison(origin, "session")).toBeNull();
  // Mutating the caller's objects cannot rewrite the original accepted bytes,
  // binding or index while the digest is still pending.
  metadata.payloadSha256 = "0".repeat(64);
  metadata.ownerEpoch = "replacement";
  metadata.logicalSessionId = "different";
  items.push("not accepted");
  release();
  await vi.waitFor(() =>
    expect(api.getNativeOutputEventOriginComparison(handles[0], "session")).not.toBeNull(),
  );
  const claims = handles.map((origin) =>
    api.getNativeOutputEventOriginComparison(origin, "session")!,
  );
  expect(claims.map((claim) => claim.itemIndex)).toEqual([0, 1, 2]);
  expect(claims[0]).toEqual({
    version: 1,
    qualified: false,
    kind: "native-output-item-comparison",
    batch: expected,
    itemIndex: 0,
  });
  expect(claims.every((claim) => claim.batch === claims[0].batch)).toBe(true);
  expect(Object.isFrozen(claims[0])).toBe(true);
  expect(Object.isFrozen(claims[0].batch)).toBe(true);
  expect(Reflect.set(claims[0], "itemIndex", 99)).toBe(false);
  expect(Reflect.set(claims[0].batch, "ownerEpoch", "forged")).toBe(false);
  expect(api.getNativeOutputEventOriginComparison(handles[0], "session")).toBe(claims[0]);
  expect(api.getNativeOutputEventOriginComparison(handles[0], "other")).toBeNull();
  expect(api.getNativeOutputEventOriginComparison(handles[0], "session")).toBe(claims[0]);
  expect(api.getNativeOutputEventOriginComparison({ kind: "native-output-origin" })).toBeNull();
  expect(
    api.getNativeOutputEventOriginComparison(JSON.parse(JSON.stringify(handles[0]))),
  ).toBeNull();
  expect(api.inspectNativeOutputDelivery("session")).toMatchObject({
    qualified: false,
    coverage: "unverified",
  });
  expect(api.inspectNativeOutputDelivery("session").streams[0].applicationThrough).toBeNull();
});

it("does not expose a comparison while the original synchronous handler is still delivering", async () => {
  const api = await load();
  const data = wire("stdout", ["delivered"]);
  const [item] = api.observeNativeOutputBatch("session", "stdout", ["delivered"], data)!;
  await vi.waitFor(() =>
    expect(api.inspectNativeOutputDelivery("session").streams[0].receivedThrough).toBe(1),
  );
  const event = {};
  let origin!: NonNullable<ReturnType<typeof api.getNativeOutputEventOrigin>>;
  api.deliverNativeOutputItem(item, () => {
    api.captureNativeOutputEvent("session", event);
    origin = api.getNativeOutputEventOrigin(event)!;
    expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
  });
  expect(api.getNativeOutputEventOriginComparison(origin)).toMatchObject({
    itemIndex: 0,
    batch: { sequence: 1, itemCount: 1 },
  });
  api.markNativeOutputEventsApplied("session", [event]);
  expect(api.getNativeOutputEventOriginComparison(origin)).not.toBeNull();
  expect(api.inspectNativeOutputDelivery("session").streams[0].applicationThrough).toBeNull();
});

it.each(["stdout", "stderr", "sse"] as const)(
  "preserves the exact %s descriptor without synthesizing a logical target",
  async (channel) => {
    const api = await load();
    const metadata = wire(channel, ["payload"]);
    const [item] = api.observeNativeOutputBatch("session", channel, ["payload"], metadata)!;
    const event = {};
    api.deliverNativeOutputItem(item, () => api.captureNativeOutputCurrentEvent(event));
    const origin = api.getNativeOutputEventOrigin(event)!;
    await vi.waitFor(() => expect(api.getNativeOutputEventOriginComparison(origin)).not.toBeNull());
    const claim = api.getNativeOutputEventOriginComparison(origin)!;
    expect(claim.batch).toMatchObject({
      channel,
      sessionId: "session",
      ownerEpoch: ids.ownerEpoch,
      processId: channel === "sse" ? null : 42,
      streamKind: channel === "sse" ? "sse" : "process",
    });
    expect(claim.batch).not.toHaveProperty("logicalSessionId");
    expect(claim.batch).not.toHaveProperty("available");
    expect(claim.batch).not.toHaveProperty("unavailableReason");
  },
);

it.each([
  { ownerEpoch: "other-recipient" },
  { sourceStoreId: "other-store" },
  { sourceProfileId: "other-profile" },
  { storeInstance: "55555555-5555-4555-8555-555555555555" },
  { logicalSessionId: "other-logical" },
  { processId: 43 },
])("revokes comparison eligibility permanently after a real binding change %j", async (change) => {
  const api = await load();
  const metadata = wire("stdout", ["original"]);
  const [item] = api.observeNativeOutputBatch("session", "stdout", ["original"], metadata)!;
  const event = {};
  api.deliverNativeOutputItem(item, () => api.captureNativeOutputCurrentEvent(event));
  const origin = api.getNativeOutputEventOrigin(event)!;
  await vi.waitFor(() => expect(api.getNativeOutputEventOriginComparison(origin)).not.toBeNull());
  const earlier = api.getNativeOutputEventOriginComparison(origin)!;
  expect(
    api.observeNativeOutputBatch(
      "session",
      "stdout",
      ["next"],
      wire("stdout", ["next"], { sequence: 2, ...change }),
    ),
  ).toBeUndefined();
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
  api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["next"],
    wire("stdout", ["next"], { sequence: 2 }),
  );
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
  expect(earlier).toMatchObject({
    qualified: false,
    batch: { ownerEpoch: ids.ownerEpoch, sequence: 1 },
  });
});

it("never exposes a descriptor after digest failure even if later bytes would be correct", async () => {
  const api = await load();
  const metadata = wire("stdout", ["hash"], { payloadSha256: "0".repeat(64) });
  const [item] = api.observeNativeOutputBatch("session", "stdout", ["hash"], metadata)!;
  const event = {};
  api.deliverNativeOutputItem(item, () => api.captureNativeOutputCurrentEvent(event));
  const origin = api.getNativeOutputEventOrigin(event)!;
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
  await vi.waitFor(() =>
    expect(api.inspectNativeOutputDelivery("session").streams[0].unavailableReason).toBe(
      "payload-digest",
    ),
  );
  api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["hash"],
    wire("stdout", ["hash"], { sequence: 2 }),
  );
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
});

it("rechecks reload invalidation instead of treating a previously returned frozen claim as proof", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["reload"],
    wire("stdout", ["reload"]),
  )!;
  const event = {};
  api.deliverNativeOutputItem(item, () => api.captureNativeOutputCurrentEvent(event));
  const origin = api.getNativeOutputEventOrigin(event)!;
  await vi.waitFor(() => expect(api.getNativeOutputEventOriginComparison(origin)).not.toBeNull());
  const comparison = api.getNativeOutputEventOriginComparison(origin)!;
  api.invalidateNativeOutputDelivery("tracker-reloaded");
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
  expect(Object.isFrozen(comparison)).toBe(true);
  vi.resetModules();
  const next = await load();
  expect(next.getNativeOutputEventOriginComparison(origin)).toBeNull();
});

it("keeps existing comparison claims ineligible after the bounded stream inventory overflows", async () => {
  const api = await load();
  const [item] = api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["cap"],
    wire("stdout", ["cap"]),
  )!;
  const event = {};
  api.deliverNativeOutputItem(item, () => api.captureNativeOutputCurrentEvent(event));
  const origin = api.getNativeOutputEventOrigin(event)!;
  await vi.waitFor(() => expect(api.getNativeOutputEventOriginComparison(origin)).not.toBeNull());
  for (let index = 0; index < 512; index++) {
    const metadata = wire("stdout", ["other"], {
      sessionId: `scope-${index}`,
      streamEpoch: `${index.toString(16).padStart(8, "0")}-5555-4555-8555-555555555555`,
    });
    api.observeNativeOutputState(
      metadata.sessionId,
      terminal(metadata, { lastSequence: 0, state: "unsealed" }),
    );
  }
  expect(api.inspectNativeOutputDelivery("session").retentionUnavailable).toBe(true);
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
  api.observeNativeOutputBatch(
    "session",
    "stdout",
    ["next"],
    wire("stdout", ["next"], { sequence: 2 }),
  );
  expect(api.getNativeOutputEventOriginComparison(origin)).toBeNull();
});

it.each([false, true])(
  "keeps worker proof pending and compares exact original digest (wrong=%s)",
  async (wrong) => {
    const worker = {
      onmessage: null as null | ((event: MessageEvent<unknown>) => void),
      onerror: null as null | (() => void),
      onmessageerror: null as null | (() => void),
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          return worker;
        }
      },
    );
    const api = await load();
    const items = ["original"];
    const metadata = wire("stdout", items);
    const expectedDigest = metadata.payloadSha256;
    const tokens = api.observeNativeOutputBatch("session", "stdout", items, metadata)!;
    const handler = vi.fn();
    api.deliverNativeOutputItem(tokens[0], handler);
    items[0] = "changed";
    metadata.payloadSha256 = "f".repeat(64);
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls[0][0].items).toEqual(["original"]);
    expect(api.inspectNativeOutputDelivery("session").streams[0].receivedThrough).toBe(0);
    const id = worker.postMessage.mock.calls[0][0].id;
    worker.onmessage?.({
      data: { id, digest: wrong ? "0".repeat(64) : expectedDigest },
    } as MessageEvent<unknown>);
    await vi.waitFor(() => {
      const stream = api.inspectNativeOutputDelivery("session").streams[0];
      if (wrong) expect(stream.unavailableReason).toBe("payload-digest");
      else expect(stream.deliveredThrough).toBe(1);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  },
);

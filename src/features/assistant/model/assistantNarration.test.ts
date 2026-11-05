import { describe, expect, it, vi } from "vitest";
import {
  AssistantNarration,
  type NarrationGates,
  type NarrationReceipt,
  type NarrationSource,
} from "./assistantNarration";

const source: NarrationSource = {
  hostId: "host",
  eventId: "event",
  generation: "voice-1",
  kind: "completed",
  text: "Work completed.",
};
const gates: NarrationGates = {
  enabled: true,
  connected: true,
  present: true,
  quiet: false,
  dnd: false,
  busy: false,
};
function fixture() {
  const receipts = new Map<string, NarrationReceipt>();
  const ports = {
    current: vi.fn(async (_source: NarrationSource) => ({ source, gates })),
    claim: vi.fn(async (item: NarrationSource) => {
      if (receipts.has(item.eventId)) return false;
      receipts.set(item.eventId, { ...item, state: "pending" });
      return true;
    }),
    settle: vi.fn(async (item: NarrationSource, state: "delivered" | "unknown") => {
      receipts.set(item.eventId, { ...item, state });
    }),
    speak: vi.fn(async (_item: NarrationSource, _signal: AbortSignal) => {}),
  };
  return { ports, receipts };
}
describe("assistant narration", () => {
  it.each(["enabled", "connected", "present", "quiet", "dnd", "busy"] as const)(
    "honors %s gate",
    async (key) => {
      const f = fixture();
      f.ports.current.mockResolvedValue({
        source,
        gates: { ...gates, [key]: key === "quiet" || key === "dnd" || key === "busy" },
      });
      await new AssistantNarration(f.ports).deliver(source);
      expect(f.ports.claim).not.toHaveBeenCalled();
      expect(f.ports.speak).not.toHaveBeenCalled();
    },
  );
  it("rechecks exact source after claim and never speaks a changed event", async () => {
    const f = fixture();
    f.ports.current
      .mockResolvedValueOnce({ source, gates })
      .mockResolvedValueOnce({ source: { ...source, generation: "voice-2" }, gates });
    await new AssistantNarration(f.ports).deliver(source);
    expect(f.ports.speak).not.toHaveBeenCalled();
    expect(f.receipts.get(source.eventId)?.state).toBe("unknown");
  });
  it("retains uncertain receipt on lost speech acknowledgement across restart", async () => {
    const f = fixture();
    f.ports.speak.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await new AssistantNarration(f.ports).deliver(source);
    await new AssistantNarration(f.ports).deliver(source);
    expect(f.ports.speak).toHaveBeenCalledTimes(1);
    expect(f.receipts.get(source.eventId)?.state).toBe("unknown");
  });
  it("stop while claim waits prevents playback without cancelling Host work", async () => {
    const f = fixture();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claim = f.ports.claim;
    f.ports.claim = vi.fn(async (item) => {
      await wait;
      return claim(item);
    });
    const owner = new AssistantNarration(f.ports);
    const pending = owner.deliver(source);
    await vi.waitFor(() => expect(f.ports.claim).toHaveBeenCalled());
    owner.stopAudio();
    release();
    await pending;
    expect(f.ports.speak).not.toHaveBeenCalled();
    expect(f.receipts.get(source.eventId)?.state).toBe("unknown");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountCapabilities } from "../../../src/integrations/social/capabilities";
import { collectAudience } from "./audience-collect";
import { personIdFor } from "./audience-person";
import { AI, NOW, OWNER, account, fixture } from "./audience-test-support";
import { saveList } from "./audience-lists";

vi.mock("../../../src/integrations/social/capabilities", () => ({ accountCapabilities: vi.fn() }));

const unsupported = [
  {
    operation: "audience.collect",
    status: "unsupported",
    reason: "Not supported.",
    reasonCode: "api.not_supported",
    scopes: [],
    source: "test",
  },
];
const available = [
  {
    operation: "audience.collect",
    status: "available",
    reason: "",
    reasonCode: "api.ready",
    scopes: [],
    source: "test",
  },
];

const sample = {
  people: [
    { platformId: "u1", name: "Ada", kind: "comment", ref: "post-1", at: NOW, text: "hi" },
    { platformId: "u2", name: "Bob", kind: "like", ref: "post-1", at: NOW },
  ],
  next: "cursor-2",
} as const;

describe("audience.collect", () => {
  beforeEach(() => {
    vi.mocked(accountCapabilities).mockReturnValue(unsupported as never);
  });

  it("answers with the reason code when the operation is unsupported (no silent success)", async () => {
    const f = await fixture();
    expect(
      await collectAudience(f.ctx(OWNER), {
        source: { kind: "own_post_comments", accountId: "acc-x" },
      }),
    ).toEqual({
      collected: 0,
      skipped: 0,
      unsupported: "api.not_supported",
    });
  });

  it("collects people, skips suppressed ones and fills the target list", async () => {
    vi.mocked(accountCapabilities).mockReturnValue(available as never);
    const adapter = { collectAudience: vi.fn(async () => sample) };
    const f = await fixture({ adapter: adapter as never });
    await saveList(f.ctx(OWNER), { id: "team", name: "Team", kind: "static" });
    await f.store.putSuppression({
      id: "sup-u2",
      handle: { platform: "x", platformId: "u2" },
      channel: "all",
      reason: "manual",
      source: "test",
      at: NOW,
    });
    const result = await collectAudience(f.ctx(OWNER), {
      source: { kind: "own_post_comments", accountId: "acc-x" },
      targetListId: "team",
    });
    expect(result).toEqual({ collected: 1, skipped: 1, next: "cursor-2" });
    expect(adapter.collectAudience).toHaveBeenCalledWith(
      expect.anything(),
      "token-test",
      { kind: "own_post_comments", accountId: "acc-x" },
      undefined,
    );
    const personId = personIdFor("acc-x", "u1");
    expect((await f.store.listInteractions(personId)).map((item) => item.kind)).toEqual([
      "comment",
    ]);
    expect((await f.store.listMembers("team")).personIds).toEqual([personId]);
    expect(await f.store.getPerson(personIdFor("acc-x", "u2"))).toBeUndefined();
  });

  it("refuses a non-owner at suggest level and charges collected people at autonomous level", async () => {
    vi.mocked(accountCapabilities).mockReturnValue(available as never);
    const adapter = { collectAudience: vi.fn(async () => sample) };
    const f = await fixture({ adapter: adapter as never, levels: {} });
    await expect(
      collectAudience(f.ctx(AI), { source: { kind: "own_post_comments", accountId: "acc-x" } }),
    ).rejects.toThrow("Needs owner approval");
    expect(adapter.collectAudience).not.toHaveBeenCalled();

    f.levels["acc-x"] = "autonomous";
    const result = await collectAudience(f.ctx(AI), {
      source: { kind: "own_post_comments", accountId: "acc-x" },
    });
    expect(result.collected).toBe(2);
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(NOW);
    expect(await f.store.getCounter("acc-x", "audience", day)).toBe(2);
  });

  it("rejects a source the principal cannot read", async () => {
    const f = await fixture({ accounts: [account({ grants: {} })] });
    await expect(
      collectAudience(f.ctx(AI), { source: { kind: "own_post_comments", accountId: "acc-x" } }),
    ).rejects.toThrow("no permission");
  });
});

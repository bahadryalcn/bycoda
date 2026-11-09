import { describe, expect, it, vi } from "vitest";
import { publishCampaign, saveCampaign, saveRepeatProgram } from "./contentPublish";

const variants = [
  { accountId: "x1", text: "Hi", media: [], scheduledAt: 1, factIds: [] },
  { accountId: "y1", text: "Hi", media: [], scheduledAt: 1, factIds: [] },
];
const saved = {
  id: "c1",
  revision: 2,
  name: "Launch",
  projectIds: ["p1"],
  variants,
  paused: false,
  createdAt: 1,
};

type Reply = unknown | ((action: string) => unknown);

function fakeClient(replies: Record<string, Reply> = {}) {
  const request = vi.fn(async (action: string) => {
    const reply = replies[action];
    if (typeof reply === "function") return (reply as (action: string) => unknown)(action);
    if (reply !== undefined) return reply;
    return action === "campaigns.create" ? saved : {};
  });
  return { request };
}

const available = { status: "available" };
const input = { name: "Launch", projectIds: ["p1"], variants };
const actions = (client: ReturnType<typeof fakeClient>) =>
  client.request.mock.calls.map(([action]) => action);

describe("saveCampaign", () => {
  it("creates a new draft without an id or revision", async () => {
    const client = fakeClient();
    await expect(saveCampaign(client as never, input)).resolves.toEqual(saved);
    expect(client.request.mock.calls[0]).toEqual(["campaigns.create", input]);
  });

  it("revises a saved draft with the revision the owner last saw", async () => {
    const client = fakeClient();
    await saveCampaign(client as never, { ...input, campaignId: "c1", revision: 5 });
    expect(client.request.mock.calls[0]![1]).toEqual({ ...input, id: "c1", expectedRevision: 5 });
  });
});

describe("publishCampaign partial and failed results", () => {
  it("returns every refused target and the saved campaign when only some targets are blocked", async () => {
    const client = fakeClient({
      "campaigns.preview": {
        campaign: saved,
        targets: [
          { accountId: "x1", capability: available },
          { accountId: "y1", contentError: "Too long.", capability: available },
          { accountId: "z1", capability: { status: "pending", reasonCode: "api.pending" } },
        ],
      },
    });
    const result = await publishCampaign(client as never, input);
    expect(result.scheduled).toBe(false);
    expect(result.campaign).toEqual(saved);
    expect(result.blocked.map((target) => target.accountId)).toEqual(["y1", "z1"]);
    expect(actions(client)).toEqual(["campaigns.create", "campaigns.preview"]);
  });

  it("treats a target with no capability at all as refused", async () => {
    const client = fakeClient({
      "campaigns.preview": { campaign: saved, targets: [{ accountId: "x1" }] },
    });
    const result = await publishCampaign(client as never, input);
    expect(result.blocked).toEqual([{ accountId: "x1" }]);
    expect(result.scheduled).toBe(false);
  });

  it("previews the saved campaign by id and approves the saved revision", async () => {
    const client = fakeClient({
      "campaigns.preview": {
        campaign: { ...saved, revision: 9 },
        targets: [{ accountId: "x1", capability: available }],
      },
    });
    await publishCampaign(client as never, input);
    expect(client.request.mock.calls[1]).toEqual(["campaigns.preview", { id: "c1" }]);
    expect(client.request.mock.calls[2]).toEqual([
      "campaigns.approveReviewed",
      { id: "c1", expectedRevision: 2 },
    ]);
    expect(client.request.mock.calls[3]).toEqual(["campaigns.schedule", { id: "c1" }]);
  });

  it("schedules nothing when the preview has no targets to refuse and no targets at all", async () => {
    const client = fakeClient({ "campaigns.preview": { campaign: saved, targets: [] } });
    const result = await publishCampaign(client as never, input);
    expect(result).toEqual({ campaign: saved, blocked: [], scheduled: true });
  });

  it("stops after a failed save without previewing", async () => {
    const client = fakeClient({
      "campaigns.create": () => {
        throw new Error("Revision conflict.");
      },
    });
    await expect(
      publishCampaign(client as never, { ...input, campaignId: "c1", revision: 1 }),
    ).rejects.toThrow("Revision conflict.");
    expect(actions(client)).toEqual(["campaigns.create"]);
  });

  it("does not schedule when approval fails", async () => {
    const client = fakeClient({
      "campaigns.preview": {
        campaign: saved,
        targets: [{ accountId: "x1", capability: available }],
      },
      "campaigns.approveReviewed": () => {
        throw new Error("Revision changed.");
      },
    });
    await expect(publishCampaign(client as never, input)).rejects.toThrow("Revision changed.");
    expect(actions(client)).toEqual([
      "campaigns.create",
      "campaigns.preview",
      "campaigns.approveReviewed",
    ]);
  });
});

describe("saveRepeatProgram media and link", () => {
  const base = {
    projectId: "p1",
    name: "Weekly tip",
    text: "Tip",
    accountIds: ["x1"],
    factIds: ["f1"],
    repeat: { enabled: true, minMinutes: 60, maxMinutes: 120, totalPosts: 5 },
    startsAt: 1000,
    language: "en",
  };

  async function configOf(patch: Partial<Parameters<typeof saveRepeatProgram>[1]>) {
    const request = vi.fn(async () => ({ id: "program1" }));
    const result = await saveRepeatProgram({ request } as never, { ...base, media: [], ...patch });
    const [action, payload] = request.mock.calls[0] as unknown as [
      string,
      { config: Record<string, unknown> },
    ];
    return { action, config: payload.config, result };
  }

  it("keeps the attached media as existing images and returns the Host answer", async () => {
    const media = [{ kind: "image" as const, uploadId: "u1" }];
    const { action, config, result } = await configOf({ media });
    expect(action).toBe("programs.configure");
    expect(config).toMatchObject({ image: { mode: "existing", media } });
    expect(result).toEqual({ id: "program1" });
  });

  it("puts the link into the brief only when there is one", async () => {
    const withLink = await configOf({ link: "https://example.com" });
    expect(withLink.config).toMatchObject({ brief: { link: "https://example.com" } });
    const without = await configOf({});
    expect((without.config.brief as Record<string, unknown>).link).toBeUndefined();
  });
});

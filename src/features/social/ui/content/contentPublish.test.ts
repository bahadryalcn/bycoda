import { describe, expect, it, vi } from "vitest";
import { draftFromAiPlan } from "./contentAi";
import { publishCampaign, saveRepeatProgram } from "./contentPublish";

const variants = [{ accountId: "x1", text: "Hi", media: [], scheduledAt: 1, factIds: [] }];

function fakeClient(preview: unknown) {
  const request = vi.fn(async (action: string) => {
    if (action === "campaigns.create")
      return {
        id: "c1",
        revision: 2,
        name: "Launch",
        projectIds: ["p1"],
        variants,
        paused: false,
        createdAt: 1,
      };
    if (action === "campaigns.preview") return preview;
    return {};
  });
  return { request };
}

describe("publishCampaign", () => {
  it("saves, checks, approves the saved revision and schedules, in that order", async () => {
    const client = fakeClient({
      campaign: { id: "c1", revision: 2 },
      targets: [{ accountId: "x1", capability: { status: "available" } }],
    });
    const result = await publishCampaign(client, { name: "Launch", projectIds: ["p1"], variants });
    expect(result.scheduled).toBe(true);
    expect(client.request.mock.calls.map(([action]) => action)).toEqual([
      "campaigns.create",
      "campaigns.preview",
      "campaigns.approveReviewed",
      "campaigns.schedule",
    ]);
    expect(client.request.mock.calls[2]![1]).toEqual({ id: "c1", expectedRevision: 2 });
  });

  it("stops before approval when a target is refused, and returns every refusal", async () => {
    const client = fakeClient({
      campaign: { id: "c1", revision: 2 },
      targets: [
        { accountId: "x1", contentError: "Too long.", capability: { status: "available" } },
        {
          accountId: "y1",
          capability: { status: "expired", reason: "", reasonCode: "api.token_expired" },
        },
      ],
    });
    const result = await publishCampaign(client, { name: "Launch", projectIds: ["p1"], variants });
    expect(result.scheduled).toBe(false);
    expect(result.blocked.map((target) => target.accountId)).toEqual(["x1", "y1"]);
    expect(client.request.mock.calls.map(([action]) => action)).toEqual([
      "campaigns.create",
      "campaigns.preview",
    ]);
  });

  it("sends the revision on edit so a stale draft cannot overwrite a newer one", async () => {
    const client = fakeClient({ campaign: { id: "c1", revision: 3 }, targets: [] });
    await publishCampaign(client, {
      campaignId: "c1",
      revision: 2,
      name: "Launch",
      projectIds: ["p1"],
      variants,
    });
    expect(client.request.mock.calls[0]![1]).toMatchObject({ id: "c1", expectedRevision: 2 });
  });
});

describe("saveRepeatProgram", () => {
  it("saves a repeat program through programs.configure with the repeat interval", async () => {
    const request = vi.fn(async () => ({}));
    await saveRepeatProgram({ request } as never, {
      projectId: "p1",
      name: "Weekly tip",
      text: "Tip",
      accountIds: ["x1"],
      factIds: ["f1"],
      media: [],
      repeat: { enabled: true, minMinutes: 60, maxMinutes: 120, totalPosts: 5 },
      startsAt: 1000,
      language: "en",
    });
    const [action, input] = request.mock.calls[0] as unknown as [
      string,
      { config: Record<string, unknown> },
    ];
    expect(action).toBe("programs.configure");
    expect(input.config).toMatchObject({
      name: "Weekly tip",
      projectId: "p1",
      accountIds: ["x1"],
      strategy: "repeat",
      totalPosts: 5,
      image: { mode: "none" },
      brief: { description: "Tip", language: "en", factIds: ["f1"] },
      schedule: {
        mode: "interval",
        minIntervalMinutes: 60,
        maxIntervalMinutes: 120,
        startsAt: 1000,
      },
    });
  });
});

describe("draftFromAiPlan", () => {
  it("takes the first campaigns.create variant and ignores other steps", () => {
    expect(
      draftFromAiPlan({
        planId: "p",
        steps: [
          { id: "1", action: "campaigns.status", input: {}, summary: "", needsApproval: false },
          {
            id: "2",
            action: "campaigns.create",
            input: {
              name: " Launch ",
              variants: [{ text: " Hello world ", link: "https://example.com" }],
            },
            summary: "",
            needsApproval: true,
          },
        ],
      }),
    ).toEqual({ text: "Hello world", name: "Launch", link: "https://example.com" });
  });

  it("returns nothing when the plan has no post text", () => {
    expect(
      draftFromAiPlan({
        planId: "p",
        steps: [
          {
            id: "1",
            action: "campaigns.create",
            input: { variants: [{ text: "  " }] },
            summary: "",
            needsApproval: true,
          },
        ],
      }),
    ).toBeUndefined();
    expect(draftFromAiPlan({ planId: "p", steps: [] })).toBeUndefined();
  });
});

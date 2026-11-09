import { describe, expect, it, vi } from "vitest";
import type { CampaignVariant } from "../../model/social";
import { publishCampaign, saveCampaign, saveRepeatProgram } from "./contentPublish";

const variants: CampaignVariant[] = [
  { accountId: "x1", text: "Hi", media: [], scheduledAt: 1, factIds: [] },
];
const input = { name: "Launch", projectIds: ["p1"], variants };
const saved = {
  id: "c1",
  revision: 2,
  name: "Launch",
  projectIds: ["p1"],
  variants,
  paused: false,
  createdAt: 1,
};
const available = { status: "available" as const, reason: "", reasonCode: "api.ready" };

type Handlers = Partial<Record<string, (payload: unknown) => unknown>>;

/** A Host double that answers each action from `handlers`; unknown actions return an empty object. */
function host(handlers: Handlers) {
  const request = vi.fn(async (action: string, payload?: unknown) => {
    const handler = handlers[action];
    return handler ? handler(payload) : {};
  });
  return { request };
}

const actions = (client: { request: ReturnType<typeof vi.fn> }) =>
  client.request.mock.calls.map(([action]) => action);

describe("saveCampaign", () => {
  it("creates a new campaign without an id or revision", async () => {
    const client = host({ "campaigns.create": () => saved });
    await saveCampaign(client as never, input);
    expect(client.request).toHaveBeenCalledWith("campaigns.create", {
      name: "Launch",
      projectIds: ["p1"],
      variants,
    });
    expect(client.request.mock.calls[0]![1]).not.toHaveProperty("id");
    expect(client.request.mock.calls[0]![1]).not.toHaveProperty("expectedRevision");
  });

  it("lets a rejected save reach the caller so the draft can stay open", async () => {
    const client = host({
      "campaigns.create": () => {
        throw new Error("The campaign was changed by someone else.");
      },
    });
    await expect(
      saveCampaign(client as never, { ...input, campaignId: "c1", revision: 1 }),
    ).rejects.toThrow("changed by someone else");
  });
});

describe("publishCampaign refusals and failures", () => {
  it("refuses a target the Host cannot publish to, without approving or scheduling", async () => {
    const client = host({
      "campaigns.create": () => saved,
      "campaigns.preview": () => ({
        campaign: saved,
        targets: [
          { accountId: "x1", capability: available },
          {
            accountId: "y1",
            capability: { status: "pending", reason: "", reasonCode: "api.pending" },
          },
        ],
      }),
    });
    const result = await publishCampaign(client as never, input);
    expect(result.scheduled).toBe(false);
    expect(result.blocked.map((target) => target.accountId)).toEqual(["y1"]);
    expect(actions(client)).toEqual(["campaigns.create", "campaigns.preview"]);
  });

  it("treats a target with no capability answer as refused", async () => {
    const client = host({
      "campaigns.create": () => saved,
      "campaigns.preview": () => ({ campaign: saved, targets: [{ accountId: "x1" }] }),
    });
    const result = await publishCampaign(client as never, input);
    expect(result.blocked).toHaveLength(1);
    expect(actions(client)).not.toContain("campaigns.approveReviewed");
  });

  it("returns the saved campaign when refused, so the caller can keep its id and revision", async () => {
    const client = host({
      "campaigns.create": () => saved,
      "campaigns.preview": () => ({
        campaign: saved,
        targets: [{ accountId: "x1", contentError: "Too long.", capability: available }],
      }),
    });
    const result = await publishCampaign(client as never, input);
    expect(result.campaign).toMatchObject({ id: "c1", revision: 2 });
  });

  it("does not preview, approve or schedule when the save fails", async () => {
    const client = host({
      "campaigns.create": () => {
        throw new Error("Host offline");
      },
    });
    await expect(publishCampaign(client as never, input)).rejects.toThrow("Host offline");
    expect(actions(client)).toEqual(["campaigns.create"]);
  });

  it("does not schedule when the approval of the saved revision fails", async () => {
    const client = host({
      "campaigns.create": () => saved,
      "campaigns.preview": () => ({
        campaign: saved,
        targets: [{ accountId: "x1", capability: available }],
      }),
      "campaigns.approveReviewed": () => {
        throw new Error("The post changed after the review.");
      },
    });
    await expect(publishCampaign(client as never, input)).rejects.toThrow(
      "changed after the review",
    );
    expect(actions(client)).toEqual([
      "campaigns.create",
      "campaigns.preview",
      "campaigns.approveReviewed",
    ]);
  });

  it("reports a failed schedule as an error even though the post was saved and approved", async () => {
    const client = host({
      "campaigns.create": () => saved,
      "campaigns.preview": () => ({
        campaign: saved,
        targets: [{ accountId: "x1", capability: available }],
      }),
      "campaigns.schedule": () => {
        throw new Error("Scheduling is offline.");
      },
    });
    await expect(publishCampaign(client as never, input)).rejects.toThrow("Scheduling is offline.");
    expect(actions(client)).toEqual([
      "campaigns.create",
      "campaigns.preview",
      "campaigns.approveReviewed",
      "campaigns.schedule",
    ]);
  });

  it("approves and schedules exactly the campaign the Host saved", async () => {
    const client = host({
      "campaigns.create": () => ({ ...saved, id: "c9", revision: 7 }),
      "campaigns.preview": () => ({
        campaign: saved,
        targets: [{ accountId: "x1", capability: available }],
      }),
    });
    await publishCampaign(client as never, input);
    expect(client.request).toHaveBeenCalledWith("campaigns.preview", { id: "c9" });
    expect(client.request).toHaveBeenCalledWith("campaigns.approveReviewed", {
      id: "c9",
      expectedRevision: 7,
    });
    expect(client.request).toHaveBeenCalledWith("campaigns.schedule", { id: "c9" });
  });
});

describe("saveRepeatProgram", () => {
  const base = {
    projectId: "p1",
    name: "Weekly tip",
    text: "Tip",
    accountIds: ["x1"],
    factIds: [],
    media: [],
    repeat: { enabled: true, minMinutes: 60, maxMinutes: 120, totalPosts: 5 },
    startsAt: 1000,
    language: "en",
  };

  it("sends one programs.configure request and nothing that starts the program", async () => {
    const client = host({});
    await saveRepeatProgram(client as never, base);
    expect(actions(client)).toEqual(["programs.configure"]);
    const config = (client.request.mock.calls[0]![1] as { config: Record<string, unknown> }).config;
    expect(config).not.toHaveProperty("enabled");
  });

  it("uses existing media when the post has media and no image otherwise", async () => {
    const withMedia = host({});
    await saveRepeatProgram(withMedia as never, {
      ...base,
      media: [{ kind: "image", uploadId: "u1" }],
    });
    const config = (withMedia.request.mock.calls[0]![1] as { config: { image: unknown } }).config;
    expect(config.image).toMatchObject({
      mode: "existing",
      media: [{ kind: "image", uploadId: "u1" }],
    });

    const without = host({});
    await saveRepeatProgram(without as never, base);
    const empty = (without.request.mock.calls[0]![1] as { config: { image: unknown } }).config;
    expect(empty.image).toMatchObject({ mode: "none", media: [] });
  });

  it("carries the link only when there is one", async () => {
    const withLink = host({});
    await saveRepeatProgram(withLink as never, {
      ...base,
      link: "https://example.com/?utm_source=a",
    });
    const linked = (
      withLink.request.mock.calls[0]![1] as { config: { brief: Record<string, unknown> } }
    ).config;
    expect(linked.brief.link).toBe("https://example.com/?utm_source=a");

    const without = host({});
    await saveRepeatProgram(without as never, base);
    const plain = (
      without.request.mock.calls[0]![1] as { config: { brief: Record<string, unknown> } }
    ).config;
    expect(plain.brief).not.toHaveProperty("link");
  });

  it("lets a rejected save reach the caller", async () => {
    const client = host({
      "programs.configure": () => {
        throw new Error("Program limit reached.");
      },
    });
    await expect(saveRepeatProgram(client as never, base)).rejects.toThrow(
      "Program limit reached.",
    );
  });
});

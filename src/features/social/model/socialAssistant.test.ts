import { describe, expect, it } from "vitest";
import type { SocialAccount } from "./social";
import { defaultProgram } from "./socialProgram";
import {
  assistantBaseConfig,
  assistantEligibleAccounts,
  proposalChangedKeys,
  proposalRisks,
  weeklyPostBound,
} from "./socialAssistant";

const context = {
  machineLabel: "This computer",
  projectId: "p",
  projectName: "Project",
  accountIds: ["a"],
  profile: {
    projectId: "p",
    productName: "Demo",
    brandVoice: "Plain",
    facts: [{ id: "f1", topic: "T", text: "X", source: "https://example.test", verifiedAt: 1 }],
  },
};

describe("assistant starting configuration", () => {
  it("uses only the selection, the saved voice and verified facts, at the strictest approval", () => {
    const config = assistantBaseConfig({
      request: "  A week of   posts\nabout the release ",
      context,
      language: "en",
      useFacts: true,
      now: 1,
    });
    expect(config.accountIds).toEqual(["a"]);
    expect(config.projectId).toBe("p");
    expect(config.name).toBe("A week of posts about the release");
    expect(config.brief.voice).toBe("Plain");
    expect(config.brief.factIds).toEqual(["f1"]);
    expect(config.approval.mode).toBe("approved");
    expect(config.textAgent).toBeUndefined();
  });

  it("leaves facts out when the owner turns them off", () => {
    expect(
      assistantBaseConfig({ request: "x", context, language: "en", useFacts: false }).brief.factIds,
    ).toEqual([]);
  });

  it("offers only accounts with draft access to the selected project", () => {
    const account = (id: string, grants: SocialAccount["grants"]) =>
      ({ id, grants }) as unknown as SocialAccount;
    expect(
      assistantEligibleAccounts(
        [account("a", { p: ["draft"] }), account("b", { p: ["read"] }), account("c", {})],
        "p",
      ).map((item) => item.id),
    ).toEqual(["a"]);
  });
});

describe("proposal review helpers", () => {
  const base = assistantBaseConfig({
    request: "x",
    context,
    language: "en",
    useFacts: true,
    now: 1,
  });

  it("warns when a suggestion removes review steps or facts", () => {
    const proposal = {
      ...base,
      approval: { mode: "automatic" as const, steps: [] },
      brief: { ...base.brief, factIds: [] },
    };
    expect(proposalRisks(proposal, base).map((risk) => risk.id)).toEqual(
      expect.arrayContaining(["approval-automatic", "facts-dropped"]),
    );
    expect(proposalRisks(base, base)).toEqual([]);
  });

  it("lists only changed fields for a refinement", () => {
    const proposal = { ...base, totalPosts: 3, schedule: { ...base.schedule, times: ["10:00"] } };
    expect(proposalChangedKeys(proposal, base).sort()).toEqual(["schedule", "totalPosts"]);
  });

  it("bounds weekly posts from times and frequency schedules", () => {
    const config = defaultProgram("p", 1);
    expect(
      weeklyPostBound({
        ...config,
        schedule: { ...config.schedule, mode: "times", times: ["09:00", "18:00"], days: [1, 2, 3] },
      }),
    ).toBe(6);
    expect(
      weeklyPostBound({
        ...config,
        schedule: { ...config.schedule, mode: "frequency", frequency: 2, period: "week" },
      }),
    ).toBe(2);
    expect(
      weeklyPostBound({ ...config, schedule: { ...config.schedule, mode: "interval" } }),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { SocialList } from "../../model/audience";
import {
  ALL_STAGES,
  IYS_STATES,
  PIPELINE_STAGES,
  channelLabel,
  errorMessage,
  interactionLabel,
  isCommentersList,
  iysLabel,
  sourceLabel,
  stageLabel,
} from "./audienceModel";

describe("stage order", () => {
  it("runs from new to customer and ends the line with closed and opted out", () => {
    expect(PIPELINE_STAGES).toEqual(["new", "contacted", "replied", "interested", "customer"]);
    expect(ALL_STAGES).toEqual([...PIPELINE_STAGES, "closed", "opted_out"]);
  });

  it("names every stage in plain words", () => {
    expect(ALL_STAGES.map(stageLabel)).toEqual([
      "New",
      "Contacted",
      "Replied",
      "Interested",
      "Customer",
      "Closed",
      "Opted out",
    ]);
  });
});

describe("channel and consent labels", () => {
  it("names every outreach channel", () => {
    expect(
      (["dm", "comment", "mention", "email", "whatsapp", "telegram"] as const).map(channelLabel),
    ).toEqual(["Direct message", "Comment", "Mention", "Email", "WhatsApp", "Telegram"]);
  });

  it("names the three IYS states, with unknown shown as not checked", () => {
    expect(IYS_STATES).toEqual(["unknown", "approved", "rejected"]);
    expect(IYS_STATES.map(iysLabel)).toEqual(["Not checked", "Approved", "Rejected"]);
  });
});

describe("source and interaction labels", () => {
  it("says where a person came from in plain language", () => {
    expect(sourceLabel("comment")).toBe("Commented on your post");
    expect(sourceLabel("follower")).toBe("Follows you");
    expect(sourceLabel("import")).toBe("Imported from a file");
    expect(sourceLabel("manual")).toBe("Added by you");
    expect(sourceLabel("migration")).toBe("Existing contact");
    expect(sourceLabel("email")).toBe("Email");
  });

  it("names the kinds of activity shown in the timeline", () => {
    expect(interactionLabel("dm")).toBe("Direct message");
    expect(interactionLabel("follower")).toBe("Follower");
    expect(interactionLabel("search")).toBe("Search match");
    expect(interactionLabel("reply")).toBe("Reply");
    expect(interactionLabel("import")).toBe("Imported");
  });
});

describe("errorMessage", () => {
  it("shows the Host reason of an Error and a generic sentence for anything else", () => {
    expect(errorMessage(new Error("Rate limit reached."))).toBe("Rate limit reached.");
    expect(errorMessage(new Error(""))).toBe("Something went wrong. Try again.");
    expect(errorMessage("boom")).toBe("Something went wrong. Try again.");
    expect(errorMessage(undefined)).toBe("Something went wrong. Try again.");
  });
});

describe("isCommentersList", () => {
  it("is true only for the ready-made commenters list", () => {
    const base = { id: "l", name: "Commenters", kind: "static", projectIds: [], createdAt: 1 };
    expect(isCommentersList({ ...base, system: "commenters" } as SocialList)).toBe(true);
    expect(isCommentersList(base as SocialList)).toBe(false);
  });
});

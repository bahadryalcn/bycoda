import { describe, expect, it } from "vitest";
import {
  movePoolEntry,
  planContentBlockers,
  planContentWarnings,
  planSuggestBlockedReason,
  publishingPlanTime,
  publishingSchedule,
  publishingScheduleSummary,
  scheduleFields,
  type PublishingScheduleFields,
} from "./publishingPlanForm";

const fields: PublishingScheduleFields = {
  timeZone: "Europe/Istanbul",
  startTime: "09:00",
  endTime: "18:00",
  minHours: "2",
  maxHours: "5",
};

describe("Publishing plan form", () => {
  it("converts owner hour ranges without losing fractional-hour precision", () => {
    const result = publishingSchedule({ ...fields, minHours: "1.5", maxHours: "2.25" });
    expect(result.schedule).toEqual({
      timeZone: "Europe/Istanbul",
      startTime: "09:00",
      endTime: "18:00",
      minIntervalMinutes: 90,
      maxIntervalMinutes: 135,
    });
    expect(scheduleFields(result.schedule!)).toEqual({
      ...fields,
      minHours: "1.5",
      maxHours: "2.25",
    });
  });

  it("rejects malformed times, timezones, empty values, inverted and non-minute intervals", () => {
    for (const change of [
      { startTime: "25:00" },
      { endTime: "9:00" },
      { timeZone: "Istanbul/unknown" },
      { minHours: "" },
      { minHours: "0" },
      { minHours: "6" },
      { maxHours: "169" },
      { minHours: "0.123" },
    ])
      expect(publishingSchedule({ ...fields, ...change }).error).toBeTruthy();
  });

  it("explains overnight windows, full days and fixed intervals honestly", () => {
    expect(
      publishingScheduleSummary(
        publishingSchedule({ ...fields, startTime: "22:00", endTime: "03:00" }).schedule!,
      ),
    ).toContain("crosses midnight");
    expect(
      publishingScheduleSummary(
        publishingSchedule({ ...fields, startTime: "00:00", endTime: "00:00", maxHours: "2" })
          .schedule!,
      ),
    ).toContain("all day, every 2 hours");
    expect(publishingScheduleSummary(publishingSchedule(fields).schedule!)).toContain(
      "at least 2 and at most 5 hours",
    );
    expect(publishingScheduleSummary(publishingSchedule(fields).schedule!)).toContain(
      "waits for the next start time",
    );
  });

  it("formats run dates in the selected timezone and handles unavailable dates", () => {
    expect(publishingPlanTime(Date.UTC(2026, 9, 12, 6), "Europe/Istanbul")).toMatch(/0?9:00/);
    expect(publishingPlanTime(undefined, "Europe/Istanbul")).toBe("—");
    expect(publishingPlanTime(Number.NaN, "Europe/Istanbul")).toBe("—");
  });

  const content = {
    name: "Plan",
    accountCount: 1,
    accountFound: true,
    projectId: "p",
    availableCampaignIds: ["a", "b"],
    campaignIds: ["a"],
  };

  it("lists the reasons the first step cannot continue, with the fix where one exists", () => {
    expect(planContentBlockers(content)).toEqual([]);
    expect(planContentBlockers({ ...content, name: "  " }).map((item) => item.id)).toEqual(["name"]);
    expect(planContentBlockers({ ...content, campaignIds: [] }).map((item) => item.id)).toEqual([
      "empty-pool",
    ]);
    expect(planContentBlockers({ ...content, campaignIds: ["gone"] }).map((item) => item.id)).toEqual([
      "stale-pool",
    ]);
    const none = planContentBlockers({ ...content, availableCampaignIds: [], campaignIds: [] });
    expect(none.map((item) => [item.id, item.fix])).toEqual([["no-campaigns", "content"]]);
    const noAccount = planContentBlockers({ ...content, accountCount: 0, accountFound: false });
    expect(noAccount[0]).toMatchObject({ id: "no-account", fix: "accounts" });
    expect(planContentBlockers({ ...content, projectId: "" }).map((item) => item.id)).toEqual([
      "choose-project",
    ]);
  });

  it("keeps activation-only problems as warnings that never block saving a paused plan", () => {
    const base = { accountFound: true, publishGranted: true, campaignIds: ["a", "b"] };
    expect(planContentWarnings({ ...base, approvedCampaignIds: ["a", "b"] })).toEqual([]);
    const warnings = planContentWarnings({
      ...base,
      publishGranted: false,
      approvedCampaignIds: ["a"],
    });
    expect(warnings.map((item) => [item.id, item.fix])).toEqual([
      ["grant", "accounts"],
      ["approval", "content"],
    ]);
    expect(warnings[1].text).toContain("1 of 2 campaigns");
    expect(planContentWarnings({ ...base, approvedCampaignIds: undefined })[0].id).toBe("approval");
  });

  it("explains in a fixed order why the AI suggestion cannot be asked", () => {
    const ready = {
      hostOnline: true,
      accountFound: true,
      projectId: "p",
      publishGranted: true,
      agent: "ready" as const,
      eligibleCount: 3,
      narrowedCount: 0,
    };
    expect(planSuggestBlockedReason(ready)).toBe("");
    expect(planSuggestBlockedReason({ ...ready, agent: "checking" })).toBe("");
    expect(planSuggestBlockedReason({ ...ready, agent: "unknown" })).toBe("");
    expect(planSuggestBlockedReason({ ...ready, hostOnline: false, agent: "missing" })).toBe(
      "The computer is offline.",
    );
    expect(planSuggestBlockedReason({ ...ready, publishGranted: false })).toContain("Accounts");
    expect(planSuggestBlockedReason({ ...ready, agent: "missing" })).toContain("text agent");
    expect(planSuggestBlockedReason({ ...ready, eligibleCount: 0 })).toContain("active campaign");
    expect(planSuggestBlockedReason({ ...ready, eligibleCount: 51 })).toContain("at most 50");
    expect(planSuggestBlockedReason({ ...ready, eligibleCount: 51, narrowedCount: 5 })).toBe("");
  });

  it("moves pool entries without crossing or moving the already published prefix", () => {
    expect(movePoolEntry(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(movePoolEntry(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(movePoolEntry(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(movePoolEntry(["a", "b", "c"], 1, -1, 1)).toEqual(["a", "b", "c"]);
    expect(movePoolEntry(["a", "b", "c"], 0, 1, 1)).toEqual(["a", "b", "c"]);
    expect(movePoolEntry(["a", "b", "c"], 1, 1, 1)).toEqual(["a", "c", "b"]);
  });
});

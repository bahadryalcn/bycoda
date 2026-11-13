import type { CaptureRule } from "../../../src/features/social/model/audience";
import type { Sequence } from "../../../src/features/social/model/outreach";

/** Query-only data for the actual audience controls; no platform requests. */
export const surfaceSequences: Sequence[] = ["Birinci", "İkinci"].map((name, index) => ({
  id: `surface-sequence-${index}`,
  name: `${name} dizi`,
  listId: "surface-list",
  status: "draft",
  stopOnReply: true,
  pacing: { perHour: 2, perDay: 10, warmupDays: 7 },
  createdAt: 1,
  steps: ["first", "second"].map((id) => ({
    id,
    channel: "dm",
    delayHours: 24,
    template: "Demo mesaj",
    personalize: false,
  })),
}));

export const surfaceCaptureRules: CaptureRule[] = ["Birinci", "İkinci"].map((name, index) => ({
  id: `surface-rule-${index}`,
  name: `${name} toplama kuralı`,
  enabled: false,
  source: { kind: "followers", accountId: "x" },
  filter: {},
  targetListId: "surface-list",
  createdAt: 1,
}));

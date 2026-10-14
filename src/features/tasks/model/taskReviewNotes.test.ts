import { describe, expect, it } from "vitest";
import { NO_VERDICT } from "./hostTasks";
import {
  addReviewNotes,
  openReviewNotesPrompt,
  resolveReviewFindings,
  reviewFindings,
  unreadReviewNotes,
  reviewRepairStop,
  coalesceReviewNotes,
  resolveReviewedNotes,
} from "./taskReviewNotes";

describe("review notes", () => {
  const fail = { verdict: "fail" as const, note: "Friday is missing." };
  const json = (reviewNotes: unknown[]) => `\`\`\`json\n${JSON.stringify({ reviewNotes })}\n\`\`\``;

  it("requires explicit external classification and an action, never classifies legacy prose", () => {
    const required = reviewFindings(
      json([
        {
          finding: "Device acceptance missing",
          category: "external",
          suggestion: "Provide a device and test TalkBack",
        },
      ]),
      fail,
    );
    expect(reviewRepairStop(required, undefined)?.reason).toBe("external");
    expect(
      reviewRepairStop(
        reviewFindings(
          json([{ finding: "Device acceptance missing", category: "external" }]),
          fail,
        ),
        undefined,
      ),
    ).toBeUndefined();
    expect(
      reviewRepairStop(
        reviewFindings("Physical device missing\nVERDICT: FAIL - Missing evidence.", fail),
        undefined,
      ),
    ).toBeUndefined();
    expect(
      reviewRepairStop([...required, { finding: "Reset broken", kind: "finding" }], undefined),
    ).toBeUndefined();
  });

  it("resolves only explicitly verified known findings during FAIL, and reopens contradictory findings", () => {
    let id = 0;
    const notes = addReviewNotes(
      [],
      [
        { finding: "Reset broken", kind: "finding" },
        { finding: "Device acceptance missing", kind: "finding" },
      ],
      "r1",
      1,
      () => `note-${++id}`,
    );
    const reply =
      "```json\n" +
      JSON.stringify({
        reviewNotes: [{ finding: "Device acceptance missing" }],
        resolvedNoteIds: [notes[0].id],
      }) +
      "\n```";
    const fixed = resolveReviewedNotes(notes, reply, 2);
    expect(fixed[0].resolvedAt).toBe(2);
    expect(fixed[1].resolvedAt).toBeUndefined();
    expect(
      resolveReviewedNotes(notes, json([{ finding: "Device acceptance missing" }]), 2),
    ).toEqual(notes);
    expect(
      resolveReviewedNotes(
        notes,
        '```json\n{"reviewNotes":[],"resolvedNoteIds":["unknown"]}\n```',
        2,
      ),
    ).toEqual(notes);
    expect(
      addReviewNotes(
        fixed,
        [{ finding: "Reset broken", kind: "finding" }],
        "r2",
        3,
        () => "unused",
      )[0].resolvedAt,
    ).toBeUndefined();
  });

  it("recognizes unchanged defects across line movement without conflating different files or fixes", () => {
    expect(
      reviewRepairStop(
        [
          {
            finding: "docs/module.md:27-42 — TalkBack acceptance missing.",
            kind: "finding",
          },
        ],
        ["docs/module.md:31-37 — TalkBack acceptance missing."],
      )?.reason,
    ).toBe("no_progress");
    expect(
      reviewRepairStop(
        [{ finding: "docs/other.md:27 — Missing.", kind: "finding" }],
        ["docs/module.md:27 — Missing."],
      ),
    ).toBeUndefined();
    expect(
      reviewRepairStop(
        [{ finding: "Missing reset", kind: "finding" }],
        ["Missing reset", "Missing favorites"],
      ),
    ).toBeUndefined();
  });

  it("coalesces old location duplicates without losing review history or open state", () => {
    const one = addReviewNotes(
      [],
      [
        {
          finding: "docs/module.md:31-37 — Missing acceptance.",
          kind: "finding",
        },
      ],
      "review1",
      1,
      () => "one",
    )[0];
    const two = addReviewNotes(
      [],
      [
        {
          finding: "docs/module.md:27-42 — Missing acceptance.",
          kind: "finding",
        },
      ],
      "review2",
      2,
      () => "two",
    )[0];
    const merged = coalesceReviewNotes([{ ...one, resolvedAt: 1, readAt: 1 }, two]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "one",
      sessionIds: ["review1", "review2"],
      occurrences: 2,
    });
    expect(merged[0].readAt).toBeUndefined();
    expect(merged[0].resolvedAt).toBeUndefined();
    expect(coalesceReviewNotes(merged)).toEqual(merged);
  });

  it("extracts bounded actionable findings and retains old review evidence", () => {
    expect(
      reviewFindings(
        json([
          {
            finding: "file.ts:42 skips Friday.",
            suggestion: "Include Friday.",
          },
        ]),
        fail,
      ),
    ).toEqual([
      {
        finding: "file.ts:42 skips Friday.",
        suggestion: "Include Friday.",
        kind: "finding",
      },
    ]);
    expect(
      reviewFindings("file.ts:42 skips Friday.\nVERDICT: FAIL - Friday is missing.", fail),
    ).toEqual([
      {
        finding: "Friday is missing.",
        details: "file.ts:42 skips Friday.",
        kind: "finding",
      },
    ]);
    const many = reviewFindings(
      json(
        Array.from({ length: 20 }, () => ({
          finding: "x".repeat(5000),
          suggestion: "y".repeat(5000),
        })),
      ),
      fail,
    );
    expect(many).toHaveLength(12);
    expect(many[0].finding).toHaveLength(2000);
    expect(many[0].suggestion).toHaveLength(1000);
    expect(reviewFindings("```json\n{bad}\n```", fail)[0].finding).toBe(fail.note);
    expect(reviewFindings("No verdict.", { verdict: "fail", note: NO_VERDICT })).toEqual([]);
  });

  it("retains only optional suggestions from a passed review", () => {
    expect(
      reviewFindings(
        json([{ finding: "Old defect" }, { finding: "Consider a shortcut", kind: "suggestion" }]),
        { verdict: "pass", note: "" },
      ),
    ).toEqual([{ finding: "Consider a shortcut", kind: "suggestion" }]);
  });

  it("retains the FAIL reason when structured notes contain only optional suggestions", () => {
    expect(
      reviewFindings(json([{ finding: "Optional shortcut", kind: "suggestion" }]), fail)[0],
    ).toMatchObject({
      finding: "Friday is missing.",
      kind: "finding",
    });
  });

  it("deduplicates repeated findings, retains source history and reopens recurrences unread", () => {
    const initial = addReviewNotes(
      [],
      [{ finding: "Friday is missing.", kind: "finding" }],
      "review-1",
      1,
      () => "note-1",
    );
    const read = initial.map((note) => ({ ...note, readAt: 2 }));
    expect(
      addReviewNotes(
        read,
        [{ finding: "FRIDAY  is missing.", kind: "finding" }],
        "review-1",
        3,
        () => "unused",
      ),
    ).toEqual(read);
    const repeated = addReviewNotes(
      read,
      [{ finding: "FRIDAY  is missing.", kind: "finding" }],
      "review-2",
      3,
      () => "unused",
    );
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({
      id: "note-1",
      occurrences: 2,
      readAt: 2,
      sessionIds: ["review-1", "review-2"],
    });
    const fixed = resolveReviewFindings(repeated, 4);
    const reopened = addReviewNotes(
      fixed,
      [{ finding: "Friday is missing.", kind: "finding" }],
      "review-3",
      5,
      () => "unused",
    );
    expect(reopened[0]).toMatchObject({ id: "note-1", occurrences: 3 });
    expect(reopened[0].resolvedAt).toBeUndefined();
    expect(unreadReviewNotes(reopened)).toBe(1);
  });

  it("closes required findings on PASS and keeps optional suggestions open", () => {
    let id = 0;
    const notes = addReviewNotes(
      [],
      [
        { finding: "Required fix", kind: "finding" },
        { finding: "Optional shortcut", kind: "suggestion" },
      ],
      "review",
      1,
      () => String(++id),
    );
    const fixed = resolveReviewFindings(notes, 2);
    expect(fixed[0].resolvedAt).toBe(2);
    expect(fixed[1].resolvedAt).toBeUndefined();
    expect(unreadReviewNotes(fixed)).toBe(2);
    expect(openReviewNotesPrompt(fixed)).not.toContain("Required fix");
    expect(openReviewNotesPrompt(fixed)).toContain("[suggestion] Optional shortcut");
    expect(
      openReviewNotesPrompt(notes.map((note) => ({ ...note, details: "x".repeat(20_000) }))),
    ).toHaveLength(12_000);
  });
});

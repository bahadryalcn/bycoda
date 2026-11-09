import { afterEach, describe, expect, it } from "vitest";
import {
  clearComposerDraft,
  composerDraftOf,
  composerDraftRevision,
  restoreComposerDraft,
  setComposerDraftSnapshot,
} from "./draftCache";
import { persistableDraft, restoreDraft, settleRestoredDraft } from "./draftPersistence";

const sessionId = "saved-draft-lineage-test";
const empty = { text: "", attachments: [], mcpTags: [] };
afterEach(() => clearComposerDraft(sessionId));

describe("saved draft editing lineage", () => {
  it("persists an intentionally empty edit without resurrecting its original text", async () => {
    const snapshot = {
      ...empty,
      sourceDraftId: "original-turn",
      sourceDraftDigest: "original-content",
    };
    const persisted = persistableDraft(snapshot);
    expect(persisted).toEqual(snapshot);
    const restored = restoreDraft(JSON.parse(JSON.stringify(persisted)));
    expect(restored).toEqual(snapshot);
    const settled = await settleRestoredDraft(restored!, async () => new Set());
    expect(settled?.draft).toEqual(snapshot);
    expect(persistableDraft(empty)).toBeNull();
  });

  it("retains lineage through ordinary mounted snapshots and clears it explicitly", () => {
    setComposerDraftSnapshot(sessionId, {
      ...empty,
      text: "original",
      sourceDraftId: "turn",
      sourceDraftDigest: "original-content",
    });
    setComposerDraftSnapshot(sessionId, { ...empty, text: "edited" });
    expect(composerDraftOf(sessionId)).toMatchObject({
      text: "edited",
      sourceDraftId: "turn",
      sourceDraftDigest: "original-content",
    });
    setComposerDraftSnapshot(sessionId, empty);
    expect(composerDraftOf(sessionId)).toMatchObject({ text: "", sourceDraftId: "turn" });
    clearComposerDraft(sessionId);
    expect(composerDraftOf(sessionId).sourceDraftId).toBeUndefined();
    setComposerDraftSnapshot(sessionId, { ...empty, sourceDraftId: "another" });
    setComposerDraftSnapshot(sessionId, { ...empty, sourceDraftId: undefined });
    expect(composerDraftOf(sessionId).sourceDraftId).toBeUndefined();
  });

  it("does not overwrite an empty active edit with late recovered content", () => {
    const startedAt = composerDraftRevision();
    setComposerDraftSnapshot(sessionId, { ...empty, sourceDraftId: "turn" });
    expect(restoreComposerDraft(sessionId, { ...empty, text: "stale" }, startedAt)).toBe(false);
    expect(restoreComposerDraft(sessionId, { ...empty, text: "stale" })).toBe(false);
    expect(composerDraftOf(sessionId)).toMatchObject({ text: "", sourceDraftId: "turn" });
  });

  it("validates retained empty lineage while accepting legacy nonempty drafts", () => {
    expect(restoreDraft({ ...empty, sourceDraftId: 1 })).toBeNull();
    expect(restoreDraft({ ...empty, sourceDraftId: "x".repeat(513) })).toBeNull();
    expect(restoreDraft({ ...empty, text: 1, sourceDraftId: "turn" })).toBeNull();
    expect(restoreDraft({ ...empty, text: "legacy" })).toMatchObject({ text: "legacy" });
  });
});

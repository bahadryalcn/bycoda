import { gitHeadMessage, type GitDiffIndex } from "../../../platform/tauri/fs";
import { useLayoutEffect, useRef } from "react";
import type { HarnessId } from "../../sessions";
import { generateCommitMessage } from "../../../integrations/harness";
import { t } from "../../../shared/i18n/git";
import {
  retainGitPanelRuntime,
  setGitFeedback,
  useGitPanelRuntime,
  useGitPanelState,
} from "../model/gitPanelState";
import { useGitGenerationChoice } from "../ui/GitGenerationSettings";

/**
 * The checkout's commit draft: message, amend target and message generation.
 * The checkout runtime owns them, so a draft and a running generation outlive
 * the visible panel.
 */
export function useCommitDraft({
  cwd,
  index,
  textHarness,
  canGenerate,
  fail,
}: {
  cwd: string;
  index: GitDiffIndex | null;
  textHarness?: HarnessId;
  canGenerate: boolean;
  fail: (error: unknown, operation?: string) => void;
}) {
  const runtime = useGitPanelRuntime(cwd);
  const amendOwnerGeneration = useRef(0);
  useLayoutEffect(() => {
    amendOwnerGeneration.current++;
    return () => {
      amendOwnerGeneration.current++;
    };
  }, [runtime]);
  const generateAbortRef = runtime.generateAbort;
  // Generation and staging may outlive/remount the visible panel; the checkout
  // runtime owns both the observed identity and synchronous mutation revision.
  const generationMutation = runtime.generationIndex;
  generationMutation.identity = JSON.stringify([index?.branch, index?.head, index?.files]);
  // Generating reads the changes without touching the index, so it does not
  // take `busy` and files can be staged while it runs.
  const [generating, setGenerating] = useGitPanelState(cwd, "generating");
  const [storedMessage, setStoredMessage] = useGitPanelState(cwd, "message");
  const [generationChoice, setGenerationChoice, hasGenerationOverride] =
    useGitGenerationChoice(cwd);
  const [storedAmendTarget, setStoredAmendTarget] = useGitPanelState(cwd, "amendTarget");
  // An amend belongs to the branch and HEAD it was started on. Once either
  // moves, it and its message no longer apply: they read as cleared here and
  // are dropped from the checkout runtime on the next draft change.
  const staleAmend =
    storedAmendTarget !== null &&
    index !== null &&
    (storedAmendTarget.branch !== index.branch || storedAmendTarget.head !== index.head);
  const message = staleAmend ? "" : storedMessage;
  const amend = storedAmendTarget !== null && !staleAmend;

  const settleStaleAmend = () => {
    if (!staleAmend) return;
    setStoredAmendTarget(null);
    setStoredMessage("");
  };

  const setMessage = (next: string) => {
    if (staleAmend) setStoredAmendTarget(null);
    setStoredMessage(next);
  };

  /** Empties the box and leaves amend mode, after a commit. */
  const clearDraft = () => {
    setStoredMessage("");
    setStoredAmendTarget(null);
  };

  const generate = async () => {
    if (
      !canGenerate ||
      generateAbortRef.current ||
      runtime.state.busy === "commit" ||
      runtime.state.busy === "pr"
    )
      return;
    settleStaleAmend();
    const controller = new AbortController();
    const draft = runtime.state.message;
    const context = generationMutation.identity;
    const mutation = generationMutation.version;
    generateAbortRef.current = controller;
    setGenerating(true);
    setGitFeedback(cwd, null);
    try {
      const generated = generationChoice
        ? await generateCommitMessage(cwd, textHarness, controller.signal, generationChoice)
        : await generateCommitMessage(cwd, textHarness, controller.signal);
      if (!controller.signal.aborted && generateAbortRef.current === controller) {
        if (
          runtime.state.message !== draft ||
          generationMutation.identity !== context ||
          generationMutation.version !== mutation
        ) {
          setGitFeedback(cwd, {
            kind: "info",
            title: t("Draft or changes changed during generation. Generate again when ready."),
          });
          return;
        }
        if (!generated.trim())
          throw new Error("The provider returned an empty commit message. Retry generation.");
        setMessage(generated);
      }
    } catch (error) {
      if (!controller.signal.aborted) fail(error, "Couldn’t generate commit message");
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
        setGenerating(false);
      }
    }
  };

  const cancelGenerate = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setGenerating(false);
  };

  const toggleAmend = async () => {
    if (amend) {
      setStoredAmendTarget(null);
      return;
    }
    settleStaleAmend();
    const original = retainGitPanelRuntime(cwd);
    const ownerGeneration = amendOwnerGeneration.current;
    const draft = original.runtime.state.message;
    const target = original.runtime.state.amendTarget;
    const context = original.runtime.generationIndex.identity;
    const mutation = original.runtime.generationIndex.version;
    try {
      const headMessage = await gitHeadMessage(cwd);
      if (amendOwnerGeneration.current !== ownerGeneration) return;
      // The checkout owns the live draft, including edits made while Git reads HEAD.
      if (
        original.runtime.state.amendTarget !== target ||
        original.runtime.generationIndex.identity !== context ||
        original.runtime.generationIndex.version !== mutation
      )
        return;
      if (original.runtime.state.message === draft && !draft.trim()) setStoredMessage(headMessage);
      setStoredAmendTarget({
        branch: index?.branch ?? null,
        head: index?.head ?? null,
      });
    } catch (error) {
      if (amendOwnerGeneration.current === ownerGeneration)
        fail(error, "Couldn’t read commit message");
    } finally {
      original.release();
    }
  };

  return {
    message,
    setMessage,
    generating,
    amend,
    generationChoice,
    setGenerationChoice,
    hasGenerationOverride,
    generate,
    cancelGenerate,
    toggleAmend,
    clearDraft,
  };
}

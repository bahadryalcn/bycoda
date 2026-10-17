import { Alert } from "../../../shared/ui/Alert";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
} from "../../../shared/ui/icons";
import { useRef, useState } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { githubPrAction, type GithubPrAction, type InboxItem } from "../model/githubTasks";

export type GithubPrMergeAction = Extract<GithubPrAction, "merge" | "squash" | "rebase">;

export const GITHUB_PR_MERGE_OPTIONS: Array<{
  action: GithubPrMergeAction;
  label: string;
  description: string;
}> = [
  {
    action: "merge",
    get label() {
      return t("Create a merge commit");
    },
    get description() {
      return t("Add every commit to the base branch.");
    },
  },
  {
    action: "squash",
    get label() {
      return t("Squash and merge");
    },
    get description() {
      return t("Combine the commits into one.");
    },
  },
  {
    action: "rebase",
    get label() {
      return t("Rebase and merge");
    },
    get description() {
      return t("Add the commits without a merge commit.");
    },
  },
];

export function githubPrActionCopy(
  action: GithubPrAction,
  baseRef: string,
  headRef: string,
): { title: string; detail: string; confirm: string; progress: string } {
  const source = headRef ? `“${headRef}”` : "this branch";
  const destination = baseRef ? `“${baseRef}”` : "the base branch";
  switch (action) {
    case "merge":
      return {
        get title() {
          return t("Merge this pull request?");
        },
        detail: `Every commit from ${source} will be added to ${destination} with a merge commit.`,
        confirm: "Merge pull request",
        progress: "Merging…",
      };
    case "squash":
      return {
        get title() {
          return t("Squash and merge?");
        },
        detail: `The commits from ${source} will be combined into one commit on ${destination}.`,
        confirm: "Squash and merge",
        progress: "Merging…",
      };
    case "rebase":
      return {
        get title() {
          return t("Rebase and merge?");
        },
        detail: `The commits from ${source} will be rebased individually onto ${destination}.`,
        confirm: "Rebase and merge",
        progress: "Merging…",
      };
    case "draft":
      return {
        get title() {
          return t("Convert to draft?");
        },
        detail: "Reviewers will see that this pull request is not ready to merge.",
        confirm: "Convert to draft",
        progress: "Converting…",
      };
    case "ready":
      return {
        get title() {
          return t("Mark as ready for review?");
        },
        detail: "Reviewers will see that this pull request is ready for feedback.",
        confirm: "Ready for review",
        progress: "Updating…",
      };
    case "close":
      return {
        get title() {
          return t("Close this pull request?");
        },
        detail: "The pull request will close without merging. You can reopen it later.",
        confirm: "Close pull request",
        progress: "Closing…",
      };
    case "reopen":
      return {
        get title() {
          return t("Reopen this pull request?");
        },
        detail: "The pull request will return to the open state.",
        confirm: "Reopen pull request",
        progress: "Reopening…",
      };
  }
}

export function GithubPrActions({
  item,
  baseRef,
  headRef,
  onChange,
}: {
  item: InboxItem;
  baseRef: string;
  headRef: string;
  onChange?: (item: InboxItem) => void;
}) {
  useLocale();
  const mergeGroup = useRef<HTMLDivElement>(null);
  const [mergeAction, setMergeAction] = useState<GithubPrMergeAction>("merge");
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: GithubPrAction;
    anchor: HTMLElement;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const state = item.state.trim().toLowerCase();
  const selectedMerge =
    GITHUB_PR_MERGE_OPTIONS.find((option) => option.action === mergeAction) ??
    GITHUB_PR_MERGE_OPTIONS[0];

  const askToRun = (action: GithubPrAction, anchor: HTMLElement) => {
    setMergeMenuOpen(false);
    setActionError(null);
    setNotice(null);
    setConfirmation({ action, anchor });
  };

  const dismissConfirmation = () => {
    if (busy) return;
    setConfirmation(null);
    setActionError(null);
  };

  const runAction = async () => {
    if (!confirmation || busy) return;
    const action = confirmation.action;
    setBusy(true);
    setActionError(null);
    try {
      const next = await githubPrAction(item.projectPath, item.repo, item.number, action);
      setConfirmation(null);
      setNotice(
        (action === "merge" || action === "squash" || action === "rebase") &&
          next.state.trim().toLowerCase() !== "merged"
          ? "Merge queued or auto-merge enabled."
          : null,
      );
      onChange?.({
        ...item,
        ...next,
        projectPath: item.projectPath,
        provider: "github",
      });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmCopy = confirmation
    ? githubPrActionCopy(confirmation.action, baseRef, headRef)
    : null;

  return (
    <>
      {state === "open" && !item.draft ? (
        <SplitButton
          groupRef={mergeGroup}
          variant="primary"
          type="button"
          label={
            selectedMerge?.action === "merge"
              ? t("Merge pull request")
              : (selectedMerge?.label ?? t("Merge pull request"))
          }
          menuLabel={t("Merge options")}
          disabled={busy}
          menuOpen={mergeMenuOpen}
          onMenuOpenChange={setMergeMenuOpen}
          startIcon={<GitMerge className="size-3.5" strokeWidth={1.75} />}
          onClick={(event) => askToRun(mergeAction, event.currentTarget)}
          actions={GITHUB_PR_MERGE_OPTIONS.map((option) => ({
            id: option.action,
            label: option.label,
            description: option.description,
            checked: option.action === mergeAction,
            selectionRole: "radio",
            onSelect: () => setMergeAction(option.action),
          }))}
        />
      ) : null}
      {state === "open" && item.draft ? (
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("ready", event.currentTarget)}
        >
          <GitPullRequest className="size-3.5" strokeWidth={1.75} />
          {t("Ready for review")}
        </Button>
      ) : null}
      {state === "open" && !item.draft ? (
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("draft", event.currentTarget)}
        >
          <GitPullRequestDraft className="size-3.5" strokeWidth={1.75} />
          {t("Convert to draft")}
        </Button>
      ) : null}
      {state === "open" ? (
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("close", event.currentTarget)}
        >
          <GitPullRequestClosed className="size-3.5" strokeWidth={1.75} />
          {t("Close pull request")}
        </Button>
      ) : null}
      {state === "closed" ? (
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("reopen", event.currentTarget)}
        >
          <GitPullRequest className="size-3.5" strokeWidth={1.75} />
          {t("Reopen pull request")}
        </Button>
      ) : null}
      {notice ? (
        <span role="status" className="text-[11px] text-(--ui-text-secondary)">
          {notice}
        </span>
      ) : null}
      {confirmation && confirmCopy ? (
        <Popover
          anchor={confirmation.anchor}
          gap={5}
          width={320}
          autoFocus
          onDismiss={busy ? undefined : dismissConfirmation}
          role="dialog"
          tabIndex={-1}
          aria-label={confirmCopy.title}
          className="p-3"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-[13px] font-medium text-(--ui-tone-neutral-fg)">
              {confirmCopy.title}
            </h2>
            <p className="text-[12px] leading-snug text-(--ui-text-secondary)">
              {confirmCopy.detail}
            </p>
          </div>
          {actionError ? (
            <Alert tone="danger" role="alert" className="mt-2">
              {actionError}
            </Alert>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" type="button" disabled={busy} onClick={dismissConfirmation}>
              {t("Cancel")}
            </Button>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => void runAction()}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
              {busy ? confirmCopy.progress : confirmCopy.confirm}
            </Button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

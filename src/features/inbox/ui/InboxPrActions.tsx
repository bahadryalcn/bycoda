import { errorText } from "../../../shared/lib/errors";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { Button } from "../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Heading } from "../../../shared/ui/Heading";
import { t, useLocale } from "../../../shared/i18n";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MoreHorizontal,
} from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
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
  const source = headRef ? `“${headRef}”` : t("this branch");
  const destination = baseRef ? `“${baseRef}”` : t("the base branch");
  switch (action) {
    case "merge":
      return {
        get title() {
          return t("Merge this pull request?");
        },
        detail: t("Every commit from {p0} will be added to {p1} with a merge commit.", {
          p0: source,
          p1: destination,
        }),
        get confirm() {
          return t("Merge pull request");
        },
        get progress() {
          return t("Merging…");
        },
      };
    case "squash":
      return {
        get title() {
          return t("Squash and merge?");
        },
        detail: t("The commits from {p0} will be combined into one commit on {p1}.", {
          p0: source,
          p1: destination,
        }),
        get confirm() {
          return t("Squash and merge");
        },
        get progress() {
          return t("Merging…");
        },
      };
    case "rebase":
      return {
        get title() {
          return t("Rebase and merge?");
        },
        detail: t("The commits from {p0} will be rebased individually onto {p1}.", {
          p0: source,
          p1: destination,
        }),
        get confirm() {
          return t("Rebase and merge");
        },
        get progress() {
          return t("Merging…");
        },
      };
    case "draft":
      return {
        get title() {
          return t("Convert to draft?");
        },
        detail: t("Reviewers will see that this pull request is not ready to merge."),
        get confirm() {
          return t("Convert to draft");
        },
        get progress() {
          return t("Converting…");
        },
      };
    case "ready":
      return {
        get title() {
          return t("Mark as ready for review?");
        },
        detail: t("Reviewers will see that this pull request is ready for feedback."),
        get confirm() {
          return t("Ready for review");
        },
        get progress() {
          return t("Updating…");
        },
      };
    case "close":
      return {
        get title() {
          return t("Close this pull request?");
        },
        detail: t("The pull request will close without merging. You can reopen it later."),
        get confirm() {
          return t("Close pull request");
        },
        get progress() {
          return t("Closing…");
        },
      };
    case "reopen":
      return {
        get title() {
          return t("Reopen this pull request?");
        },
        detail: t("The pull request will return to the open state."),
        get confirm() {
          return t("Reopen pull request");
        },
        get progress() {
          return t("Reopening…");
        },
      };
  }
}

type GithubPrActionsProps = {
  item: InboxItem;
  baseRef: string;
  headRef: string;
  reviewedHeadOid?: string;
  /** Set while something still stands between this pull request and a clean merge; the merge button then stops being primary. The reasons live in the Summary and Checks tabs. */
  mergeBlocker?: string;
  onChange?: (item: InboxItem) => void;
};

export function GithubPrActions(props: GithubPrActionsProps) {
  const { item } = props;
  return (
    <GithubPrActionsForItem
      key={JSON.stringify([item.provider, item.projectPath, item.repo, item.number])}
      {...props}
    />
  );
}

type ActionFailureState = { title: string; detail?: string };

/** A translated title; the raw Host text, when there is one, sits behind the shared Details control. */
function ActionFailure({
  failure,
  className,
}: {
  failure: ActionFailureState;
  className?: string;
}) {
  return (
    <Alert
      tone="danger"
      className={className}
      title={failure.title}
      extra={
        failure.detail ? <ErrorDetails title={failure.title} detail={failure.detail} /> : undefined
      }
    />
  );
}

function GithubPrActionsForItem({
  item,
  baseRef,
  headRef,
  reviewedHeadOid,
  mergeBlocker,
  onChange,
}: GithubPrActionsProps) {
  useLocale();
  const active = useRef(true);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own in-flight provider completions while this PR action view is mounted.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const mergeGroup = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mergeAction, setMergeAction] = useState<GithubPrMergeAction>("merge");
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: GithubPrAction;
    expectedHeadOid?: string;
    anchor: HTMLElement;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ActionFailureState | null>(null);
  const [queued, setQueued] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const state = item.state.trim().toLowerCase();
  const selectedMerge =
    GITHUB_PR_MERGE_OPTIONS.find((option) => option.action === mergeAction) ??
    GITHUB_PR_MERGE_OPTIONS[0];

  const askToRun = (action: GithubPrAction, anchor: HTMLElement) => {
    setMergeMenuOpen(false);
    setActionError(null);
    setQueued(false);
    setRefreshError(null);
    if (
      ["merge", "squash", "rebase"].includes(action) &&
      !/^[a-f0-9]{40}$/i.test(reviewedHeadOid ?? "")
    ) {
      setActionError({ title: t("Refresh and review the pull request before merging.") });
      return;
    }
    // Draft, ready and reopen are reversible with one click, so they run at once. Merge cannot be
    // undone and close notifies others, so those two confirm.
    if (action === "draft" || action === "ready" || action === "reopen") {
      void runAction(action, reviewedHeadOid);
      return;
    }
    setConfirmation({ action, anchor, expectedHeadOid: reviewedHeadOid });
  };

  const dismissConfirmation = () => {
    if (busy) return;
    setConfirmation(null);
    setActionError(null);
  };

  const runAction = async (action: GithubPrAction, expectedHeadOid?: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = await githubPrAction(
        item.projectPath,
        item.repo,
        item.number,
        action,
        expectedHeadOid,
      );
      if (!active.current) return;
      setConfirmation(null);
      setQueued(
        (action === "merge" || action === "squash" || action === "rebase") &&
          next.state.trim().toLowerCase() !== "merged",
      );
      setRefreshError(next.refreshError ?? null);
      // A failed refresh returns only the new state; the row keeps its known fields.
      onChange?.(
        next.refreshError
          ? {
              ...item,
              state: next.state,
              stateReason: next.stateReason || item.stateReason,
              draft: action === "draft" || action === "ready" ? next.draft : item.draft,
              projectPath: item.projectPath,
              provider: "github",
            }
          : {
              ...item,
              ...next,
              projectPath: item.projectPath,
              provider: "github",
            },
      );
    } catch (error: unknown) {
      if (!active.current) return;
      setConfirmation(null);
      setActionError({ title: t("Could not complete this action."), detail: errorText(error) });
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const confirmCopy = confirmation
    ? githubPrActionCopy(confirmation.action, baseRef, headRef)
    : null;

  return (
    <>
      {state === "open" && !item.draft ? (
        <>
          <SplitButton
            groupRef={mergeGroup}
            variant={mergeBlocker ? "secondary" : "primary"}
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
            startIcon={<GitMerge className="icon-sm" strokeWidth={1.75} />}
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
        </>
      ) : null}
      {state === "open" && item.draft ? (
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("ready", event.currentTarget)}
        >
          <GitPullRequest className="icon-sm" strokeWidth={1.75} />
          {t("Ready for review")}
        </Button>
      ) : null}
      {state === "open" ? (
        <>
          <Button
            ref={moreButton}
            type="button"
            variant="ghost"
            iconOnly
            label={t("More pull request actions")}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            disabled={busy}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal className="icon-sm" strokeWidth={1.75} />
          </Button>
          {moreOpen ? (
            <DropdownMenu
              anchor={moreButton}
              label={t("More pull request actions")}
              returnFocusRef={moreButton}
              onClose={() => setMoreOpen(false)}
              items={[
                ...(item.draft
                  ? []
                  : [
                      {
                        kind: "item" as const,
                        id: "draft",
                        label: t("Convert to draft"),
                        icon: <GitPullRequestDraft />,
                      },
                      { kind: "sep" as const },
                    ]),
                {
                  kind: "item" as const,
                  id: "close",
                  label: t("Close pull request"),
                  icon: <GitPullRequestClosed />,
                  danger: true,
                },
              ]}
              onPick={(id) => {
                setMoreOpen(false);
                if (moreButton.current)
                  askToRun(id === "close" ? "close" : "draft", moreButton.current);
              }}
            />
          ) : null}
        </>
      ) : null}
      {state === "closed" ? (
        <Button
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("reopen", event.currentTarget)}
        >
          <GitPullRequest className="icon-sm" strokeWidth={1.75} />
          {t("Reopen pull request")}
        </Button>
      ) : null}
      {queued ? (
        <InlineMessage tone="info" className="w-full">
          {t("Merge queued or auto-merge enabled.")}
        </InlineMessage>
      ) : null}
      {refreshError ? <InlineError details={refreshError} /> : null}
      {!confirmation && actionError ? <ActionFailure failure={actionError} /> : null}
      {confirmation && confirmCopy ? (
        <Popover
          anchor={confirmation.anchor}
          gap={5}
          width={320}
          onDismiss={busy ? undefined : dismissConfirmation}
          kind="dialog"
          aria-label={confirmCopy.title}
          variant="panel"
        >
          <div className="flex flex-col gap-1">
            <Heading size="item" level={2}>
              {confirmCopy.title}
            </Heading>
            <Text as="p" size="caption" tone="secondary">
              {confirmCopy.detail}
              {confirmation.expectedHeadOid
                ? ` ${t("Reviewed head: {p0}", { p0: confirmation.expectedHeadOid.slice(0, 7) })}`
                : ""}
            </Text>
          </div>
          {actionError ? <ActionFailure failure={actionError} className="mt-2" /> : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" type="button" disabled={busy} onClick={dismissConfirmation}>
              {t("Cancel")}
            </Button>
            <Button
              variant={confirmation.action === "close" ? "secondary" : "primary"}
              tone={confirmation.action === "close" ? "danger" : undefined}
              type="button"
              loading={busy}
              loadingLabel={confirmCopy.progress}
              onClick={() => void runAction(confirmation.action, confirmation.expectedHeadOid)}
            >
              {confirmCopy.confirm}
            </Button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

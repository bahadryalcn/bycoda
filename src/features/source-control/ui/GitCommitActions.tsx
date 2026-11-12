import { t, useLocale } from "../../../shared/i18n/git";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { SplitButton, type SplitButtonAction } from "../../../shared/ui/SplitButton";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CloudUpload,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
} from "../../../shared/ui/icons";
import { busyLabel } from "../model/gitBusyLabel";
import type { GitDiffIndex, GitPr } from "../../../platform/tauri/fs";

type CommitPrimary = "commit" | "sync" | "create-pr" | "view-pr";

/**
 * One contextual split action for the commit area. The primary follows intent: anything to
 * commit leads with Commit, with a pending sync beside it as its own button; otherwise the
 * pending sync, Create PR or View PR leads. Everything else stays in the menu behind its own gates.
 */
export function GitCommitActions({
  index,
  pr,
  busy,
  pending,
  hasRemote,
  hasOpenPr,
  onDefault,
  amend,
  commitIntent,
  canCommit,
  blockedReason,
  canCommitPush,
  canCommitPushPr,
  canSync,
  canPublish,
  canCreatePr,
  canViewPr,
  canOpenMenu,
  menuOpen,
  onMenuOpenChange,
  onCommit,
  onToggleAmend,
  onSync,
  onCreatePr,
  onViewPr,
}: {
  index: GitDiffIndex | null;
  pr: GitPr | null;
  busy: string | null;
  pending: string | null;
  hasRemote: boolean;
  hasOpenPr: boolean;
  onDefault: boolean;
  amend: boolean;
  commitIntent: boolean;
  canCommit: boolean;
  /** Why commit is off (unresolved conflicts); the operation banner already shows the state. */
  blockedReason?: string | null;
  canCommitPush: boolean;
  canCommitPushPr: boolean;
  canSync: boolean;
  canPublish: boolean;
  canCreatePr: boolean;
  canViewPr: boolean;
  canOpenMenu: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onCommit: (push: boolean, createPr?: boolean) => void;
  onToggleAmend: () => void;
  onSync: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
}) {
  useLocale();
  const committing = busy === "commit" || busy === "pr";
  const syncing = busy === "sync";
  const ahead = index?.ahead ?? 0;
  const behind = index?.behind ?? 0;
  const dest = index
    ? (index.upstream ?? `${index.remote ?? "origin"}/${index.branch ?? "HEAD"}`)
    : "";
  const syncTitle = syncing
    ? "Synchronizing Changes..."
    : canPublish
      ? index?.branch
        ? `Publish Branch "${index.branch}"`
        : "Publish Branch"
      : behind > 0 && ahead > 0
        ? `Pull ${behind} and push ${ahead} commits between ${dest}`
        : behind > 0
          ? `Pull ${behind} commit${behind === 1 ? "" : "s"} from ${dest}`
          : `Push ${ahead} commit${ahead === 1 ? "" : "s"} to ${dest}`;
  const syncDetail = `${syncTitle}${canPublish || !index?.upstream ? ` · ${dest}` : ""}`;
  const syncLabel = canPublish
    ? t("Publish Branch")
    : t(behind > 0 && ahead > 0 ? "Sync Changes" : behind > 0 ? "Pull" : "Push");
  const createTitle = index?.defaultBranch
    ? `Create a pull request into ${index.defaultBranch}`
    : "Create pull request";
  const viewTitle = pr?.title ? `View PR #${pr.number}: ${pr.title}` : "View pull request";
  const viewLabel = pr?.number ? t("View PR #{p0}", { p0: pr.number }) : t("View PR");
  const showSync = hasRemote && !!index && (canPublish || canSync || syncing);
  // A permanently disabled Create PR is noise: offer it only when it can run.
  const showCreatePr = hasRemote && !hasOpenPr && !onDefault && (canCreatePr || busy === "pr");
  const showViewPr = hasRemote && hasOpenPr;
  const createDisabled = busy !== "pr" && (!canCreatePr || !!busy);
  const viewDisabled = !canViewPr || !!busy;
  const syncDisabled = !!busy && !syncing;
  const primary: CommitPrimary =
    committing || commitIntent
      ? "commit"
      : showSync
        ? "sync"
        : showCreatePr
          ? "create-pr"
          : showViewPr
            ? "view-pr"
            : "commit";
  const commitLabel = amend ? t("Amend Commit") : t("Commit");

  // Commit counts read as part of the button label, not as separate chips:
  // the leading icon names a one-way direction, so only a two-way sync repeats arrows.
  const twoWay = ahead > 0 && behind > 0;
  const countLabel = (count: number, incoming: boolean) =>
    t(
      incoming
        ? count === 1
          ? "{p0} incoming commit"
          : "{p0} incoming commits"
        : count === 1
          ? "{p0} unpushed commit"
          : "{p0} unpushed commits",
      { p0: count },
    );
  const syncCounts =
    canPublish || (ahead === 0 && behind === 0) ? null : (
      <Text
        size="inherit"
        tone="secondary"
        weight="regular"
        className="flex shrink-0 items-center gap-1.5 tabular-nums"
      >
        {behind > 0 ? (
          <span className="flex items-center" aria-label={countLabel(behind, true)}>
            {twoWay ? <ArrowDown aria-hidden className="icon-xs" strokeWidth={2} /> : null}
            {behind}
          </span>
        ) : null}
        {ahead > 0 ? (
          <span className="flex items-center" aria-label={countLabel(ahead, false)}>
            {twoWay ? <ArrowUp aria-hidden className="icon-xs" strokeWidth={2} /> : null}
            {ahead}
          </span>
        ) : null}
      </Text>
    );
  const syncIcon = canPublish ? (
    <CloudUpload className="icon-sm shrink-0" strokeWidth={1.75} />
  ) : twoWay || (ahead === 0 && behind === 0) ? (
    <RefreshCw className="icon-sm shrink-0" strokeWidth={1.75} />
  ) : behind > 0 ? (
    <ArrowDown className="icon-sm shrink-0" strokeWidth={1.75} />
  ) : (
    <ArrowUp className="icon-sm shrink-0" strokeWidth={1.75} />
  );

  const lead =
    primary === "sync"
      ? {
          variant: "secondary" as const,
          label: syncLabel,
          title: syncDetail,
          disabled: syncDisabled,
          loading: syncing,
          loadingLabel: t("Syncing…"),
          icon: syncIcon,
          trailing: syncCounts,
          onClick: onSync,
        }
      : primary === "create-pr"
        ? {
            variant: "secondary" as const,
            label: t("Create PR"),
            title: createTitle,
            disabled: createDisabled,
            loading: busy === "pr",
            loadingLabel: t("Creating pull request…"),
            icon: <GitPullRequest className="icon-sm shrink-0" strokeWidth={1.75} />,
            trailing: null,
            onClick: onCreatePr,
          }
        : primary === "view-pr"
          ? {
              variant: "secondary" as const,
              label: viewLabel,
              title: viewTitle,
              disabled: viewDisabled,
              loading: false,
              loadingLabel: undefined,
              icon: <ExternalLink className="icon-sm shrink-0" strokeWidth={1.75} />,
              trailing: null,
              onClick: onViewPr,
            }
          : {
              variant: "primary" as const,
              label: committing ? (pending ?? busyLabel(busy ?? "")) : commitLabel,
              title: undefined,
              disabled: !canCommit,
              loading: committing,
              loadingLabel: undefined,
              icon: <Check className="icon-sm" strokeWidth={2} />,
              trailing: null,
              onClick: () => onCommit(false),
            };
  // Beside a pending commit, sync keeps its own button: commit-only and push-only stay one click.
  const directSync = primary === "commit" && showSync;

  const actions: SplitButtonAction[] = [];
  if (primary !== "commit") {
    actions.push({
      id: "commit",
      label: commitLabel,
      disabled: !canCommit,
      onSelect: () => onCommit(false),
    });
  }
  actions.push(
    {
      id: "push",
      label: t("Commit & Push"),
      disabled: !canCommitPush,
      onSelect: () => onCommit(true),
    },
    {
      id: "push-pr",
      label: t("Commit, Push & Create PR"),
      disabled: !canCommitPushPr,
      onSelect: () => onCommit(true, true),
    },
    {
      id: "amend",
      label: t("Amend Last Commit"),
      checked: amend,
      onSelect: onToggleAmend,
    },
  );
  if (showSync && primary !== "sync" && !directSync) {
    actions.push({
      id: "sync",
      label: syncLabel,
      description: syncDetail,
      disabled: syncDisabled,
      onSelect: onSync,
    });
  }
  if (showCreatePr && primary !== "create-pr") {
    actions.push({
      id: "create-pr",
      label: t("Create PR"),
      description: createTitle,
      disabled: createDisabled,
      onSelect: onCreatePr,
    });
  }
  if (showViewPr && primary !== "view-pr") {
    actions.push({
      id: "view-pr",
      label: viewLabel,
      description: viewTitle,
      disabled: viewDisabled,
      onSelect: onViewPr,
    });
  }

  const split = (
    <SplitButton
      variant={lead.variant}
      size="sm"
      motion="none"
      fullWidth
      label={lead.label}
      title={lead.title}
      menuLabel={t("Commit options")}
      menuOpen={menuOpen}
      onMenuOpenChange={onMenuOpenChange}
      disabled={lead.disabled}
      disabledReason={
        primary === "commit" && !committing ? (blockedReason ?? undefined) : undefined
      }
      menuDisabled={!canOpenMenu}
      loading={lead.loading}
      loadingLabel={lead.loadingLabel}
      startIcon={lead.icon}
      trailing={lead.trailing}
      onClick={lead.onClick}
      actions={actions}
    />
  );
  if (!directSync) return split;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div className="min-w-[8rem] flex-1">{split}</div>
      <Button
        variant="secondary"
        size="sm"
        className="min-w-0 max-w-full"
        tooltip={syncDetail}
        disabled={syncDisabled}
        loading={syncing}
        loadingLabel={t("Syncing…")}
        startIcon={syncIcon}
        onClick={onSync}
      >
        <Text size="inherit" tone="inherit" truncate className="min-w-0">
          {syncLabel}
        </Text>
        {syncCounts}
      </Button>
    </div>
  );
}

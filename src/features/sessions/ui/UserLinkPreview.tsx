import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale, useT } from "../../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import {
  CircleDot,
  CircleX,
  ExternalLink,
  GitCompare,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type IconComponent,
} from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  formatRelativeTime,
  githubWorkItem,
  githubWorkItemDetails,
  peekGithubWorkItem,
  peekGithubWorkItemDetails,
  type GithubWorkItem,
  type GithubWorkItemDetails,
} from "../../inbox/model/githubTasks";
import {
  fetchLinkPreviewMetadata,
  type GithubWorkItemLink,
  type LinkPreviewMetadata,
  type UserLink,
} from "../model/linkPreview";

export function UserLinkPreview({
  link,
  cwd,
  compact = false,
}: {
  link: UserLink;
  cwd?: string;
  compact?: boolean;
}) {
  useLocale();
  if (link.githubWorkItem) {
    const workItem = link.githubWorkItem;
    return (
      <GithubWorkItemPreview
        key={`${cwd || "."}:${workItem.repo}:${workItem.kind}:${workItem.number}`}
        link={link}
        workItem={workItem}
        cwd={cwd}
        compact={compact}
      />
    );
  }
  return <GenericLinkPreview link={link} />;
}

function GenericLinkPreview({ link }: { link: UserLink }) {
  const t = useT();
  const [metadata, setMetadata] = useState<LinkPreviewMetadata | null>(null);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMetadata(null);
    setFaviconFailed(false);
    void fetchLinkPreviewMetadata(link.url)
      .then((value) => {
        if (!cancelled) setMetadata(value);
      })
      .catch((error) => {
        console.warn("UserLinkPreview operation failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [link.url]);

  const title = metadata?.title?.trim() || link.host;
  const favicon = faviconFailed ? null : metadata?.faviconDataUrl;

  return (
    <a
      href={link.url}
      data-user-link-preview
      title={link.url}
      aria-label={t("Open {p0}", { p0: title })}
      className="user-link-preview group mx-0.5 text-(--ui-tone-info-fg) hover:text-(--ui-tone-info-fg) hover:underline"
      onClick={(event) => openExternalLink(event, link.url)}
    >
      <span className="mr-1 inline-flex size-4 items-center justify-center overflow-hidden rounded bg-(--ui-surface) align-[-0.125em] text-ui-micro font-semibold uppercase text-(--ui-text-secondary)">
        {favicon ? (
          <img
            src={favicon}
            alt=""
            draggable={false}
            className="size-3.5 object-contain"
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          link.host.charAt(0)
        )}
      </span>
      <span className="user-link-preview-title font-medium group-hover:underline">{title}</span>
    </a>
  );
}

const HOVER_OPEN_DELAY_MS = 220;
const HOVER_CLOSE_DELAY_MS = 100;

function GithubWorkItemPreview({
  link,
  workItem,
  cwd,
  compact,
}: {
  link: UserLink;
  workItem: GithubWorkItemLink;
  cwd?: string;
  compact: boolean;
}) {
  const t = useT();
  const anchor = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  const requestStarted = useRef(false);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState<GithubWorkItem | null>(() =>
    peekGithubWorkItem(workItem.repo, workItem.kind, workItem.number, cwd || "."),
  );
  const [details, setDetails] = useState<GithubWorkItemDetails | null>(() =>
    peekGithubWorkItemDetails(workItem.repo, workItem.kind, workItem.number, cwd || "."),
  );
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "unavailable">(
    item || details ? "ready" : "idle",
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (openTimer.current != null) window.clearTimeout(openTimer.current);
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const load = useCallback(() => {
    if (requestStarted.current) return;
    requestStarted.current = true;
    const cachedItem =
      item ?? peekGithubWorkItem(workItem.repo, workItem.kind, workItem.number, cwd || ".");
    const cachedDetails =
      details ??
      peekGithubWorkItemDetails(workItem.repo, workItem.kind, workItem.number, cwd || ".");
    if (!cachedItem || !cachedDetails) setLoadState("loading");

    void Promise.allSettled([
      cachedItem
        ? Promise.resolve(cachedItem)
        : githubWorkItem(cwd || ".", workItem.repo, workItem.kind, workItem.number),
      cachedDetails
        ? Promise.resolve(cachedDetails)
        : githubWorkItemDetails(cwd || ".", workItem.repo, workItem.kind, workItem.number),
    ]).then(([itemResult, detailsResult]) => {
      if (!mounted.current) return;
      if (itemResult.status === "fulfilled") setItem(itemResult.value);
      if (detailsResult.status === "fulfilled") {
        setDetails(detailsResult.value);
      }
      setLoadState(
        itemResult.status === "fulfilled" || detailsResult.status === "fulfilled"
          ? "ready"
          : "unavailable",
      );
    });
  }, [cwd, details, item, workItem]);

  const clearOpenTimer = () => {
    if (openTimer.current == null) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = null;
  };
  const clearCloseTimer = () => {
    if (closeTimer.current == null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const showNow = () => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(true);
    load();
  };
  const showAfterDelay = () => {
    clearCloseTimer();
    if (open || openTimer.current != null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
      load();
    }, HOVER_OPEN_DELAY_MS);
  };
  const hideAfterDelay = () => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };
  const hideNow = () => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  };

  const kindLabel = workItem.kind === "pr" ? "Pull request" : "Issue";
  const compactKind = workItem.kind === "pr" ? "PR" : "Issue";
  const itemTitle = item?.title.trim();

  return (
    <>
      <a
        ref={anchor}
        href={link.url}
        data-user-link-preview
        data-github-work-item-chip={workItem.kind}
        data-compact={compact || undefined}
        aria-label={t("Open {p0} #{p1} in {p2}{p3}", {
          p0: kindLabel.toLowerCase(),
          p1: workItem.number,
          p2: workItem.repo,
          p3: itemTitle ? `: ${itemTitle}` : "",
        })}
        aria-describedby={open ? tooltipId : undefined}
        className={`group mx-px inline-flex max-w-full items-center gap-1 rounded-md border-0 bg-transparent p-0 text-(--ui-text-secondary) no-underline shadow-none outline-none transition-[color,transform] duration-[140ms] ease-[var(--motion-ease-out)] hover:text-(--ui-tone-neutral-fg) focus-visible:ring-2 focus-visible:ring-(--ui-focus-ring-color) active:scale-[0.98] motion-reduce:transition-none pb-px ${
          compact ? "align-middle text-xs leading-4" : "align-[-0.25em] text-ui-micro leading-4"
        }`}
        onMouseEnter={showAfterDelay}
        onMouseLeave={hideAfterDelay}
        onFocus={showNow}
        onBlur={hideNow}
        onClick={(event) => {
          hideNow();
          openExternalLink(event, link.url);
        }}
      >
        <span
          className={` inline-flex shrink-0 items-center font-medium ${
            compact ? "h-[18px] gap-0.5 rounded-md px-1.5" : "h-5 gap-1 rounded-[5px] px-1.5"
          } ${
            workItem.kind === "pr"
              ? "bg-(--ui-tone-accent-subtle) text-(--ui-tone-accent-fg)"
              : "bg-(--ui-tone-success-subtle) text-(--ui-tone-success-fg)"
          }`}
        >
          {workItem.kind === "pr" ? (
            <GitPullRequest className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
          ) : (
            <CircleDot className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
          )}
          {compactKind} #{workItem.number}
        </span>
      </a>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          gap={6}
          width={360}
          constrainHeight={false}
          onDismiss={hideNow}
          id={tooltipId}
          role="tooltip"
          data-github-work-item-popover
          className="p-3.5 font-sans text-(--ui-tone-neutral-fg)"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={hideAfterDelay}
        >
          <GithubWorkItemCard
            parsed={workItem}
            item={item}
            details={details}
            loadState={loadState}
          />
        </Popover>
      ) : null}
    </>
  );
}

function GithubWorkItemCard({
  parsed,
  item,
  details,
  loadState,
}: {
  parsed: GithubWorkItemLink;
  item: GithubWorkItem | null;
  details: GithubWorkItemDetails | null;
  loadState: "idle" | "loading" | "ready" | "unavailable";
}) {
  const t = useT();
  const status = workItemStatus(parsed.kind, item);
  const summary = plainTextSummary(details?.body ?? "");
  const updated = item?.updatedAt ? formatRelativeTime(item.updatedAt) : "";
  const assignees = item?.assignees ?? [];
  const labels = item?.labels ?? [];
  const hasBranches = parsed.kind === "pr" && details?.baseRefName && details?.headRefName;

  return (
    <div className="min-w-0 text-left">
      <div className="flex min-w-0 items-center gap-2 text-ui-micro">
        <status.Icon className={`size-4 shrink-0 ${status.className}`} aria-hidden="true" />
        <span className="min-w-0 truncate font-medium text-(--ui-text-secondary)">
          {parsed.repo}
        </span>
        <span className="shrink-0 text-(--ui-text-secondary)">·</span>
        <span className="shrink-0 font-mono tabular-nums text-(--ui-text-secondary)">
          #{parsed.number}
        </span>
        <Badge tone="neutral">{status.label}</Badge>
      </div>

      {item ? (
        <>
          <h3 className="mt-2 line-clamp-2 text-ui-secondary font-semibold leading-[1.35] text-(--ui-tone-neutral-fg)">
            {item.title}
          </h3>
          {summary ? (
            <p className="mt-1.5 line-clamp-3 text-ui-micro leading-[1.45] text-(--ui-text-secondary)">
              {summary}
            </p>
          ) : null}
        </>
      ) : loadState === "idle" || loadState === "loading" ? (
        <GithubWorkItemCardSkeleton />
      ) : (
        <div className="mt-2">
          <h3 className="text-ui-secondary font-semibold text-(--ui-tone-neutral-fg)">
            {parsed.kind === "pr" ? t("Pull request") : t("Issue")} #{parsed.number}
          </h3>
          {summary ? (
            <p className="mt-1.5 line-clamp-3 text-ui-micro leading-[1.45] text-(--ui-text-secondary)">
              {summary}
            </p>
          ) : (
            <p className="mt-1 text-ui-micro leading-relaxed text-(--ui-text-secondary)">
              {t("Details aren't available here, but the link can still be opened on GitHub.")}
            </p>
          )}
        </div>
      )}

      {details?.author || updated ? (
        <div className="mt-2.5 flex min-w-0 items-center gap-1.5 text-(length:--ui-font-caption) text-(--ui-text-secondary)">
          {details?.author ? (
            <GithubPerson name={details.author} avatarUrl={details.authorAvatarUrl} />
          ) : null}
          {details?.author && updated ? <span aria-hidden>·</span> : null}
          {updated ? (
            <span className="shrink-0">
              {t("Updated ")}
              {updated}
            </span>
          ) : null}
        </div>
      ) : null}

      {hasBranches ? (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-md bg-(--ui-tone-neutral-solid)/[0.045] px-2 py-1.5 text-(length:--ui-font-caption) text-(--ui-text-secondary)">
          <GitCompare className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate font-mono">
            {details.baseRefName} ← {details.headRefName}
          </span>
        </div>
      ) : null}

      {labels.length > 0 || assignees.length > 0 ? (
        <div className="mt-2.5 flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {labels.slice(0, 3).map((label) => (
              <Badge tone="neutral" key={label.name} className="max-w-28">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: labelColor(label.color) }}
                />
                <span className="truncate">{label.name}</span>
              </Badge>
            ))}
            {labels.length > 3 ? (
              <span className="px-1 text-(length:--ui-font-caption) text-(--ui-text-secondary)">
                +{labels.length - 3}
              </span>
            ) : null}
          </div>
          {assignees.length > 0 ? (
            <div
              className="flex shrink-0 -space-x-1"
              aria-label={t("Assigned to {p0}", {
                p0: assignees.map((person) => person.login).join(", "),
              })}
            >
              {assignees.slice(0, 3).map((person) => (
                <GithubAvatar
                  key={person.login}
                  name={person.login}
                  avatarUrl={person.avatarUrl}
                  size={18}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-1.5 border-t border-(--ui-tone-neutral-border)/[0.07] pt-2 text-(length:--ui-font-caption) text-(--ui-text-secondary)">
        <ExternalLink className="size-3" aria-hidden="true" />
        {t("Click the chip to open on GitHub")}
      </div>
    </div>
  );
}

function GithubWorkItemCardSkeleton() {
  const t = useT();
  return (
    <div aria-label={t("Loading GitHub details")} className="mt-2.5 space-y-2">
      <div className="h-3 w-4/5 rounded bg-(--ui-surface-raised) motion-safe:animate-pulse" />
      <div className="h-2 w-full rounded bg-(--ui-tone-neutral-solid)/[0.07] motion-safe:animate-pulse" />
      <div className="h-2 w-2/3 rounded bg-(--ui-tone-neutral-solid)/[0.07] motion-safe:animate-pulse" />
    </div>
  );
}

function GithubPerson({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  useLocale();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <GithubAvatar name={name} avatarUrl={avatarUrl} size={16} />
      <span className="min-w-0 truncate font-medium text-(--ui-text-secondary)">{name}</span>
    </span>
  );
}

function GithubAvatar({
  name,
  avatarUrl,
  size,
}: {
  name: string;
  avatarUrl?: string;
  size: number;
}) {
  useLocale();
  const [failed, setFailed] = useState(!avatarUrl);
  if (!avatarUrl || failed) {
    return (
      <span
        aria-hidden="true"
        className="grid shrink-0 place-items-center rounded-full border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) font-medium text-(--ui-text-secondary)"
        style={{
          width: size,
          height: size,
          fontSize: Math.max(8, size * 0.45),
        }}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <img
      src={avatarUrl}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function workItemStatus(
  kind: GithubWorkItemLink["kind"],
  item: GithubWorkItem | null,
): { Icon: IconComponent; label: string; className: string } {
  if (!item) {
    return {
      Icon: kind === "pr" ? GitPullRequest : CircleDot,
      label: kind === "pr" ? "Pull request" : "Issue",
      className: "text-(--ui-text-secondary)",
    };
  }
  if (item?.draft) {
    return {
      Icon: GitPullRequestDraft,
      get label() {
        return t("Draft");
      },
      className: "text-(--ui-text-secondary)",
    };
  }
  if (item?.state === "merged") {
    return {
      Icon: GitMerge,
      get label() {
        return t("Merged");
      },
      className: "text-(--ui-tone-accent-fg)",
    };
  }
  if (item?.state === "closed") {
    return {
      Icon: kind === "pr" ? GitPullRequestClosed : CircleX,
      get label() {
        return t("Closed");
      },
      className: "text-(--ui-tone-danger-fg)",
    };
  }
  return {
    Icon: kind === "pr" ? GitPullRequest : CircleDot,
    get label() {
      return t("Open");
    },
    className: "text-(--ui-tone-success-fg)",
  };
}

function plainTextSummary(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_>#~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelColor(value: string): string {
  return /^[\da-f]{6}$/i.test(value.trim()) ? `#${value.trim()}` : "currentColor";
}

function openExternalLink(event: MouseEvent<HTMLAnchorElement>, url: string) {
  event.preventDefault();
  event.stopPropagation();
  void openUrl(url).catch((error) => {
    console.error("Failed to open web link:", error);
  });
}

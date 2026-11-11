import { Heading } from "../../../shared/ui/Heading";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Link } from "../../../shared/ui/Link";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { t, useLocale, useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
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
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { Skeleton } from "../../../shared/ui/Skeleton";
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
  return <GenericLinkPreview key={link.url} link={link} />;
}

function GenericLinkPreview({ link }: { link: UserLink }) {
  const t = useT();
  const [metadata, setMetadata] = useState<LinkPreviewMetadata | null>(null);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
    <Tooltip label={link.url}>
      <Link
        href={link.url}
        data-user-link-preview
        aria-label={t("Open {p0}", { p0: title })}
        className="user-link-preview group mx-0.5"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="mr-1 inline-flex size-4 items-center justify-center overflow-hidden rounded bg-(--ui-surface) align-[-0.125em] text-ui-micro font-medium uppercase text-(--ui-text-secondary)">
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
      </Link>
    </Tooltip>
  );
}

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
  const mounted = useRef(true);
  const requestStarted = useRef(false);
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
    };
  }, []);

  const load = () => {
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
      if (itemResult.status === "rejected" || detailsResult.status === "rejected") {
        requestStarted.current = false;
      }
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
  };

  // Rested hover or keyboard focus previews the item; opening starts its (cached) load.
  const hover = useHoverCard({
    side: "top",
    align: "start",
    width: 360,
    className: "p-3.5 font-sans text-(--ui-tone-neutral-fg)",
    "aria-label": t("Work item preview"),
    onOpenChange: (open) => {
      if (open) load();
    },
  });

  const kindLabel = workItem.kind === "pr" ? "Pull request" : "Issue";
  const compactKind = workItem.kind === "pr" ? "PR" : "Issue";
  const itemTitle = item?.title.trim();

  return (
    <>
      <Link
        {...hover.trigger}
        unstyled
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
        className={`group mx-px inline-flex max-w-full items-center gap-1 rounded-md border-0 bg-transparent p-0 text-(--ui-text-secondary) no-underline shadow-none transition-[color,transform] duration-[140ms] ease-[var(--motion-ease-out)] hover:text-(--ui-tone-neutral-fg) focus-visible:ring-2 focus-visible:ring-(--ui-focus-ring-color) active:scale-[0.98] motion-reduce:transition-none pb-px ${
          compact
            ? "align-middle text-ui-caption leading-4"
            : "align-[-0.25em] text-ui-micro leading-4"
        }`}
        onClick={(event) => {
          hover.close();
          event.stopPropagation();
        }}
      >
        <span
          className={` inline-flex shrink-0 items-center font-medium ${
            compact ? "h-4.5 gap-0.5 rounded-md px-1.5" : "h-5 gap-1 rounded-md px-1.5"
          } ${
            workItem.kind === "pr"
              ? "bg-(--ui-tone-accent-subtle) text-(--ui-tone-accent-fg)"
              : "bg-(--ui-tone-success-subtle) text-(--ui-tone-success-fg)"
          }`}
        >
          {workItem.kind === "pr" ? (
            <GitPullRequest className={compact ? "icon-xs" : "icon-sm"} aria-hidden="true" />
          ) : (
            <CircleDot className={compact ? "icon-xs" : "icon-sm"} aria-hidden="true" />
          )}
          {compactKind} #{workItem.number}
        </span>
      </Link>
      {hover.card(() => (
        <GithubWorkItemCard parsed={workItem} item={item} details={details} loadState={loadState} />
      ))}
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
  const status = workItemStatus(parsed.kind, item, t);
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
          <Heading size="item" className="mt-2 line-clamp-2">
            {item.title}
          </Heading>
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
          <Heading size="item">
            {parsed.kind === "pr" ? t("Pull request") : t("Issue")} #{parsed.number}
          </Heading>
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
        <div className="mt-2.5 flex min-w-0 items-center gap-1.5 text-ui-caption text-(--ui-text-secondary)">
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
        <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-md bg-(--ui-tone-neutral-solid)/[0.045] px-2 py-1.5 text-ui-caption text-(--ui-text-secondary)">
          <GitCompare className="icon-sm shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate font-mono">
            {details.baseRefName} ← {details.headRefName}
          </span>
        </div>
      ) : null}

      {labels.length > 0 || assignees.length > 0 ? (
        <div className="mt-2.5 flex min-w-0 items-center gap-1.5">
          <BadgeList
            label={t("Labels")}
            max={3}
            className="min-w-0 flex-1"
            items={labels.map((label, index) => ({
              id: `${index}:${label.name}`,
              label: label.name,
              icon: (
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: labelColor(label.color) }}
                />
              ),
            }))}
          />
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

      <div className="mt-3 flex items-center gap-1.5 border-t border-(--ui-tone-neutral-border)/[0.07] pt-2 text-ui-caption text-(--ui-text-secondary)">
        <ExternalLink className="icon-xs" aria-hidden="true" />
        {t("Click the chip to open on GitHub")}
      </div>
    </div>
  );
}

function GithubWorkItemCardSkeleton() {
  const t = useT();
  return <Skeleton lines={3} label={t("Loading GitHub details")} className="mt-2.5" />;
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

type Translate = typeof t;

function workItemStatus(
  kind: GithubWorkItemLink["kind"],
  item: GithubWorkItem | null,
  t: Translate,
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
      label: t("Draft"),
      className: "text-(--ui-text-secondary)",
    };
  }
  if (item?.state === "merged") {
    return {
      Icon: GitMerge,
      label: t("Merged"),
      className: "text-(--ui-tone-accent-fg)",
    };
  }
  if (item?.state === "closed") {
    return {
      Icon: kind === "pr" ? GitPullRequestClosed : CircleX,
      label: t("Closed"),
      className: "text-(--ui-tone-danger-fg)",
    };
  }
  return {
    Icon: kind === "pr" ? GitPullRequest : CircleDot,
    label: t("Open"),
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

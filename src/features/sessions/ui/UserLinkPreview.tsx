import type { CSSProperties } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ClampText } from "../../../shared/ui/ClampText";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Link, linkContentAttributes } from "../../../shared/ui/Link";
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
import { UserLinkIcon } from "./UserLinkIcon";
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
        <Text
          as="span"
          size="micro"
          weight="medium"
          {...surfaceAttributes(
            { radius: "sm", variant: "plain" },
            "mr-1 inline-flex size-4 items-center justify-center overflow-hidden   align-[-0.125em] uppercase",
          )}
        >
          {favicon ? (
            <img
              src={favicon}
              alt=""
              draggable={false}
              className="size-3.5 object-contain"
              onError={() => setFaviconFailed(true)}
            />
          ) : (
            <UserLinkIcon link={link} className="icon-sm" />
          )}
        </Text>
        <Text
          as="span"
          size="inherit"
          tone="inherit"
          weight="medium"
          {...linkContentAttributes("user-link-preview-title")}
        >
          {title}
        </Text>
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
    className: "p-3.5 font-sans",
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
        appearance="chip"
        className={`mx-0.5 inline-flex max-w-full items-center gap-1 ${compact ? "align-middle" : "align-[-0.25em]"}`}
        onClick={(event) => {
          hover.close();
          event.stopPropagation();
        }}
      >
        <Text
          size={compact ? "caption" : "micro"}
          tone={workItem.kind === "pr" ? "accent" : "success"}
          weight="medium"
          {...surfaceAttributes(
            { radius: "row", tone: workItem.kind === "pr" ? "accent" : "success" },
            ` inline-flex shrink-0 items-center  ${compact ? "h-4.5 gap-0.5  px-1.5" : "h-5 gap-1  px-1.5"}`,
          )}
        >
          {workItem.kind === "pr" ? (
            <GitPullRequest className={compact ? "icon-xs" : "icon-sm"} aria-hidden="true" />
          ) : (
            <CircleDot className={compact ? "icon-xs" : "icon-sm"} aria-hidden="true" />
          )}
          {compactKind} #{workItem.number}
        </Text>
      </Link>
      {hover.card(() => (
        <Text as="div" size="inherit" tone="neutral">
          <GithubWorkItemCard
            parsed={workItem}
            item={item}
            details={details}
            loadState={loadState}
          />
        </Text>
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
      <Text as="div" size="micro" tone="inherit" className="flex min-w-0 items-center gap-2">
        <status.Icon className="size-4 shrink-0" tone={status.tone} aria-hidden="true" />
        <Text size="inherit" tone="secondary" weight="medium" truncate className="min-w-0">
          {parsed.repo}
        </Text>
        <Text size="inherit" tone="secondary" className="shrink-0">
          ·
        </Text>
        <Text size="inherit" tone="secondary" className="shrink-0 font-mono tabular-nums">
          #{parsed.number}
        </Text>
        <Badge tone="neutral">{status.label}</Badge>
      </Text>

      {item ? (
        <>
          <Heading size="item" lines={2} className="mt-2">
            {item.title}
          </Heading>
          {summary ? (
            <ClampText as="p" lines={3} expandable={false} size="micro" className="mt-1.5">
              {summary}
            </ClampText>
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
            <ClampText as="p" lines={3} expandable={false} size="micro" className="mt-1.5">
              {summary}
            </ClampText>
          ) : (
            <Text as="p" size="micro" tone="secondary" leading="relaxed" className="mt-1">
              {t("Details aren't available here, but the link can still be opened on GitHub.")}
            </Text>
          )}
        </div>
      )}

      {details?.author || updated ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          className="mt-2.5 flex min-w-0 items-center gap-1.5"
        >
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
        </Text>
      ) : null}

      {hasBranches ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          {...surfaceAttributes(
            { radius: "row", variant: "neutral-metadata" },
            "mt-2 flex min-w-0 items-center gap-1.5 px-2 py-1.5",
          )}
        >
          <GitCompare className="icon-sm shrink-0" aria-hidden="true" />
          <Text size="inherit" tone="inherit" truncate className="min-w-0 font-mono">
            {details.baseRefName} ← {details.headRefName}
          </Text>
        </Text>
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
                  {...surfaceAttributes(
                    { radius: "pill", variant: "user-color" },
                    "size-1.5 shrink-0 ",
                  )}
                  style={{ "--surface-user-color": labelColor(label.color) } as React.CSSProperties}
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

      <Text
        as="div"
        size="caption"
        tone="secondary"
        {...surfaceAttributes(
          { frame: "neutral-metadata", edge: "top" },
          "mt-3 flex items-center gap-1.5 pt-2",
        )}
      >
        <ExternalLink className="icon-xs" aria-hidden="true" />
        {t("Click the chip to open on GitHub")}
      </Text>
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
      <Text size="inherit" tone="secondary" weight="medium" truncate className="min-w-0">
        {name}
      </Text>
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
      <Text
        as="span"
        size="glyph"
        tone="secondary"
        weight="medium"
        aria-hidden="true"
        {...surfaceAttributes(
          { radius: "pill", frame: "neutral", edge: "all", variant: "raised" },
          "grid shrink-0 place-items-center size-(--avatar-size) border-(--ui-tone-neutral-border)",
        )}
        style={
          {
            "--avatar-size": `${size}px`,
            "--text-glyph-size": `${Math.max(8, size * 0.45)}px`,
          } as React.CSSProperties
        }
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </Text>
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
      {...surfaceAttributes(
        { radius: "circle", frame: "neutral", variant: "raised" },
        "shrink-0 object-cover [width:var(--layout-width)] [height:var(--layout-height)]",
      )}
      style={
        {
          "--layout-width": size === undefined ? undefined : size + "px",
          "--layout-height": size === undefined ? undefined : size + "px",
        } as CSSProperties
      }
    />
  );
}

type Translate = typeof t;

function workItemStatus(
  kind: GithubWorkItemLink["kind"],
  item: GithubWorkItem | null,
  t: Translate,
): { Icon: IconComponent; label: string; tone: TextTone } {
  if (!item) {
    return {
      Icon: kind === "pr" ? GitPullRequest : CircleDot,
      label: kind === "pr" ? "Pull request" : "Issue",
      tone: "secondary",
    };
  }
  if (item?.draft) {
    return {
      Icon: GitPullRequestDraft,
      label: t("Draft"),
      tone: "secondary",
    };
  }
  if (item?.state === "merged") {
    return {
      Icon: GitMerge,
      label: t("Merged"),
      tone: "accent",
    };
  }
  if (item?.state === "closed") {
    return {
      Icon: kind === "pr" ? GitPullRequestClosed : CircleX,
      label: t("Closed"),
      tone: "danger",
    };
  }
  return {
    Icon: kind === "pr" ? GitPullRequest : CircleDot,
    label: t("Open"),
    tone: "success",
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

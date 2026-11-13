import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { BadgeTone } from "../../../shared/ui/Badge";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { BadgeListItem } from "../../../shared/ui/BadgeList";
import { labelColor } from "../../../shared/lib/colorUtils";
import { t, useLocale } from "../../../shared/i18n";
import type { CiRepairRequest } from "../model/ciRepair";
import {
  CheckCircle,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type IconComponent,
} from "../../../shared/ui/icons";
import { useEffect, useState, type CSSProperties } from "react";
import { inboxAvatarColor, isJiraAvatarUrl } from "../model/inboxAvatar";
import { fetchInboxMedia, sniffInboxMedia } from "../model/inboxMedia";
import { ProjectLogoIcon } from "../../projects/public/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { useGroupLock } from "../../group-lock/hooks/useGroupLock";
import {
  projectGroupIdForPath,
  useProjectGroupAssignments,
} from "../../projects/model/projectGroups";
import { inboxItemStatus, type GithubLabel, type InboxItem } from "../model/githubTasks";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { graphemes } from "../../../shared/lib/text/truncate";
import { sameProjectPath, type RecentProject } from "../../projects/model/recents";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

// One height for the whole detail action row; `border` is inside it, so the
// outline variant lines up with the filled and ghost ones.

export type InboxProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
  mascotName: string | null;
  mascotColor: string;
};

export function inboxProjectOptions(
  projects: RecentProject[],
  logos: ReturnType<typeof useTabGroupLogos>,
): InboxProjectOption[] {
  const mascots = loadTabGroupMascots();
  const colors = loadTabGroupColors();
  const custom = loadTabGroupCustomColors();
  return [...projects]
    .map((project) => {
      const name = projectName(project.path);
      const key = projectKey(project.path);
      return {
        path: project.path,
        name,
        logoPath: resolveTabGroupLogo(key, logos),
        mascotName: resolveTabGroupMascot(key, mascots),
        mascotColor: resolveTabGroupColor(key, colors, custom, name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function InboxProjectMark({
  project,
}: {
  project: Pick<InboxProjectOption, "name" | "logoPath" | "mascotName" | "mascotColor">;
}) {
  useLocale();
  if (project.logoPath) {
    return (
      <ProjectLogoIcon
        path={project.logoPath}
        className="icon-sm shrink-0 rounded-sm"
        imageClassName="icon-sm"
      />
    );
  }
  return (
    <ProjectMascot
      project={project.name}
      color={project.mascotColor}
      name={project.mascotName}
      className="icon-xs shrink-0"
    />
  );
}

export type CiRepairProps = {
  repairSessions?: readonly SessionSummary[];
  onRepairChecks?: (item: InboxItem, request: CiRepairRequest, sessionId?: string) => Promise<void>;
};

export type InboxStatusMark = {
  Icon: IconComponent;
  tone: BadgeTone;
  label: string;
};

/** Status reads from the glyph first and the color second, so it survives color blindness. */
export function inboxStatusMark(item: InboxItem): InboxStatusMark {
  const label = inboxItemStatus(item);
  const pr = item.kind === "pr";
  if (label === "Draft") {
    return {
      Icon: GitPullRequestDraft,
      tone: "neutral",
      label,
    };
  }
  if (label === "Merged") {
    return { Icon: GitMerge, tone: "accent", label };
  }
  if (label === "Closed") {
    if (
      item.provider === "github" &&
      item.kind === "issue" &&
      item.stateReason?.trim().toLowerCase() === "completed"
    ) {
      return { Icon: CheckCircle, tone: "success", label: "Completed" };
    }
    if (
      item.provider === "github" &&
      item.kind === "issue" &&
      item.stateReason?.trim().toLowerCase() === "not_planned"
    ) {
      return { Icon: CircleX, tone: "neutral", label: "Not planned" };
    }
    return {
      Icon: pr ? GitPullRequestClosed : CircleX,
      tone: "danger",
      label,
    };
  }
  return {
    Icon: pr ? GitPullRequest : CircleDot,
    tone: "success",
    label,
  };
}

export function InboxAvatar({
  name,
  avatarUrl,
  size = 20,
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
}) {
  return <InboxAvatarImage key={avatarUrl} name={name} avatarUrl={avatarUrl} size={size} />;
}

function InboxAvatarImage({
  name,
  avatarUrl,
  size = 20,
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
}) {
  useLocale();
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const [loaded, setLoaded] = useState<{ source: string; url: string } | null>(null);
  const authenticated = !!avatarUrl && isJiraAvatarUrl(avatarUrl);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the native avatar's blob URL while mounted; revoke it on source change or unmount.
  useEffect(() => {
    if (!avatarUrl || !authenticated) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    void fetchInboxMedia(avatarUrl)
      .then((bytes) => {
        const type = sniffInboxMedia(bytes);
        if (type?.kind !== "image") throw new Error("Unsupported avatar image");
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
        setLoaded({ source: avatarUrl, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setFailedUrl(avatarUrl);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarUrl, authenticated]);
  const imageUrl = authenticated
    ? loaded?.source === avatarUrl
      ? loaded.url
      : undefined
    : avatarUrl;
  const initial = graphemes(name.trim())[0]?.toUpperCase() || "?";

  return imageUrl && failedUrl !== avatarUrl ? (
    <img
      src={imageUrl}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedUrl(avatarUrl)}
      {...surfaceAttributes(
        { radius: "pill", variant: "raised" },
        "shrink-0 object-cover [width:var(--layout-width)] [height:var(--layout-height)]",
      )}
      style={
        {
          "--layout-width": size === undefined ? undefined : size + "px",
          "--layout-height": size === undefined ? undefined : size + "px",
        } as CSSProperties
      }
    />
  ) : (
    <Text
      size="inherit"
      tone="inherit"
      weight="medium"
      aria-hidden
      {...surfaceAttributes(
        { radius: "pill", variant: "raised" },
        "inbox-avatar grid shrink-0 place-items-center",
      )}
      style={
        {
          "--inbox-avatar-size": `${size}px`,
          "--inbox-avatar-font-size": `${Math.max(9, Math.round(size * 0.45))}px`,
          "--inbox-avatar-color": inboxAvatarColor(name),
        } as CSSProperties
      }
    >
      {initial}
    </Text>
  );
}

export function InboxPerson({
  name,
  avatarUrl,
  size = "md",
  className = "",
}: {
  name: string;
  avatarUrl?: string;
  /** `sm` is the 16px avatar of metadata rows; `md` (default) the 20px list avatar. */
  size?: "sm" | "md";
  className?: string;
}) {
  useLocale();
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <InboxAvatar name={name} avatarUrl={avatarUrl} size={size === "sm" ? 16 : 20} />
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {name}
      </Text>
    </span>
  );
}

export function InboxProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: InboxProjectOption[];
  value: string;
  onChange: (path: string) => void;
}) {
  useLocale();
  const { groups } = useGroupLock();
  const assignments = useProjectGroupAssignments();
  const sections = new Map<string | undefined, InboxProjectOption[]>(
    groups.map((group) => [group.id, []]),
  );
  sections.set(undefined, []);
  for (const project of projects) {
    const groupId = projectGroupIdForPath(project.path, assignments);
    (sections.get(groupId) ?? sections.get(undefined))!.push(project);
  }
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const selected = projects.find((project) => sameProjectPath(project.path, value)) ?? null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <SearchableSelect
        hideLabel
        label={t("Choose project")}
        disabled={!projects.length}
        value={selected?.path ?? value}
        options={[
          ...(value && !selected
            ? [{ value, label: projectName(value), description: value, group: t("Ungrouped") }]
            : []),
          ...Array.from(sections, ([groupId, members]) =>
            members.map((project) => ({
              value: project.path,
              label: project.name,
              description: project.path,
              icon: <InboxProjectMark project={project} />,
              group: groupId ? groupNames.get(groupId) : t("Ungrouped"),
            })),
          ).flat(),
        ]}
        onChange={onChange}
      />
    </div>
  );
}

/** Service labels as BadgeList items; the label's own colour stays as the leading dot. */
export function inboxLabelItems(labels: readonly GithubLabel[]): BadgeListItem[] {
  return labels.map((label) => {
    const color = labelColor(label.color);
    return {
      id: label.name,
      label: label.name,
      icon: color ? (
        <span
          aria-hidden
          {...surfaceAttributes({ radius: "pill", variant: "user-color" }, "size-1.5 shrink-0")}
          style={{ "--surface-user-color": color } as CSSProperties}
        />
      ) : undefined,
    };
  });
}

export { labelColor } from "../../../shared/lib/colorUtils";

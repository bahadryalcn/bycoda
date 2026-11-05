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
import { useState } from "react";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { inboxItemStatus, type GithubLabel, type InboxItem } from "../model/githubTasks";
import { projectKey, projectName } from "../../../shared/lib/paths";
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
  useLocale();
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return avatarUrl && failedUrl !== avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedUrl(avatarUrl)}
      className="shrink-0 rounded-full bg-(--ui-surface-raised) object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-(--ui-surface-raised) font-medium text-(--ui-text-secondary)"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.45)),
      }}
    >
      {initial}
    </span>
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
      <span className="min-w-0 truncate">{name}</span>
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
  const selected =
    projects.find((project) => sameProjectPath(project.path, value)) ?? projects[0] ?? null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      {selected ? <InboxProjectMark project={selected} /> : null}
      <SearchableSelect
        label={t("Choose project")}
        disabled={!projects.length}
        value={selected?.path ?? ""}
        options={projects.map((project) => ({
          value: project.path,
          label: project.name,
          description: project.path,
        }))}
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
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : undefined,
    };
  });
}

export { labelColor } from "../../../shared/lib/colorUtils";

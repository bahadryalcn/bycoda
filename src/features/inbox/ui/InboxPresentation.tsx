import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
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
import { useEffect, useState } from "react";
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
        className="size-3.5 shrink-0 rounded-sm"
        imageClassName="size-3.5"
      />
    );
  }
  return (
    <ProjectMascot
      project={project.name}
      color={project.mascotColor}
      name={project.mascotName}
      className="size-3 shrink-0"
    />
  );
}

export type CiRepairProps = {
  repairSessions?: readonly SessionSummary[];
  onRepairChecks?: (item: InboxItem, request: CiRepairRequest, sessionId?: string) => Promise<void>;
};

export type InboxStatusMark = {
  Icon: IconComponent;
  className: string;
  label: string;
};

/** Status reads from the glyph first and the color second, so it survives color blindness. */
export function inboxStatusMark(item: InboxItem): InboxStatusMark {
  const label = inboxItemStatus(item);
  const pr = item.kind === "pr";
  if (label === "Draft") {
    return {
      Icon: GitPullRequestDraft,
      className: "text-(--ui-text-secondary)",
      label,
    };
  }
  if (label === "Merged") {
    return { Icon: GitMerge, className: "text-(--color-feature)", label };
  }
  if (label === "Closed") {
    if (
      item.provider === "github" &&
      item.kind === "issue" &&
      item.stateReason?.trim().toLowerCase() === "completed"
    ) {
      return { Icon: CheckCircle, className: "text-(--color-feature)", label };
    }
    return {
      Icon: pr ? GitPullRequestClosed : CircleX,
      className: "text-(--ui-tone-danger-fg)",
      label,
    };
  }
  return {
    Icon: pr ? GitPullRequest : CircleDot,
    className: "text-(--ui-tone-success-fg)",
    label,
  };
}

export function InboxPerson({
  name,
  avatarUrl,
  size = 20,
  className = "",
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
}) {
  useLocale();
  const [failed, setFailed] = useState(!avatarUrl);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    setFailed(!avatarUrl);
  }, [avatarUrl]);

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
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
      )}
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

export function InboxLabel({ label, compact = false }: { label: GithubLabel; compact?: boolean }) {
  useLocale();
  const color = labelColor(label.color);
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-px text-(length:--ui-font-caption) text-(--ui-text-secondary) bg-(--ui-surface-raised) ${
        compact ? "max-w-20" : ""
      }`}
    >
      {color ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="min-w-0 truncate">{label.name}</span>
    </span>
  );
}

export { labelColor } from "../../../shared/lib/colorUtils";

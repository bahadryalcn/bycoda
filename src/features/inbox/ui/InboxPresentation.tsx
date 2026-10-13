import { labelColor } from "../../../shared/lib/colorUtils";
import { t, useLocale } from "../../../shared/i18n";
import type { CiRepairRequest } from "../model/ciRepair";
import {
  CheckCircle,
  ChevronDown,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type IconComponent,
} from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
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
export const ACTION = "inline-flex items-center gap-1.5 rounded-md px-3 text-[12px]";

export const ACTION_FILLED = `${ACTION} h-6.5 bg-content text-background-base hover:bg-content/80`;

export const ACTION_OUTLINE = `${ACTION} h-7 border border-content/15 text-content/80 hover:bg-content/5`;

export const ACTION_PANEL_HEADER = `${ACTION} h-6.5 text-content/70 hover:bg-content/10 hover:text-content`;

export const ACTION_GHOST = `${ACTION} h-7 text-content/70 hover:bg-content/10 hover:text-content`;

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
      className: "text-content/50",
      label,
    };
  }
  if (label === "Merged") {
    return { Icon: GitMerge, className: "text-violet-400/90", label };
  }
  if (label === "Closed") {
    if (
      item.provider === "github" &&
      item.kind === "issue" &&
      item.stateReason?.trim().toLowerCase() === "completed"
    ) {
      return { Icon: CheckCircle, className: "text-violet-400/90", label };
    }
    return {
      Icon: pr ? GitPullRequestClosed : CircleX,
      className: "text-rose-400/90",
      label,
    };
  }
  return {
    Icon: pr ? GitPullRequest : CircleDot,
    className: "text-emerald-400/90",
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
          className="shrink-0 rounded-full bg-content/10 object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden
          className="grid shrink-0 place-items-center rounded-full bg-content/12 font-medium text-content/55"
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
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected =
    projects.find((project) => sameProjectPath(project.path, value)) ?? projects[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || menu.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        disabled={projects.length === 0}
        onClick={() => setOpen((next) => !next)}
        className="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border border-content/10 bg-content/5 px-2 text-[12px] text-content/80 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-40"
      >
        {selected ? <InboxProjectMark project={selected} /> : null}
        <span className="min-w-0 truncate">{selected?.name ?? t("Choose project")}</span>
        <ChevronDown className="size-3 shrink-0 text-content/45" strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          ref={menu}
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full max-w-64 overflow-y-auto rounded-lg border border-content/10 bg-content/10 p-1 shadow-xl backdrop-blur-xl outline-none"
        >
          {projects.map((project) => {
            const active = selected ? sameProjectPath(project.path, selected.path) : false;
            return (
              <button
                key={project.path}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(project.path);
                  setOpen(false);
                }}
                className={`flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[12px] ${
                  active
                    ? "bg-selection text-content"
                    : "text-content/80 hover:bg-content/5 hover:text-content"
                }`}
              >
                <InboxProjectMark project={project} />
                <span className="min-w-0 truncate">{project.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function InboxLabel({ label, compact = false }: { label: GithubLabel; compact?: boolean }) {
  useLocale();
  const color = labelColor(label.color);
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-px text-content/50 bg-content/8 ${
        compact ? "max-w-20 text-[10px]" : "text-[11px]"
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

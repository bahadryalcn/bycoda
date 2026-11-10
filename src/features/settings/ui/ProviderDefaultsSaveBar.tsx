import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { Folder, Globe, LayoutGrid } from "../../../shared/ui/icons";
import { LiveText } from "../../../shared/ui/LiveText";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { StatusDot } from "../../../shared/ui/StatusDot";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  type ProjectGroup,
} from "../../projects/public/projectGroups";
import { projectDisplayName } from "../../projects/public/projectNames";
import {
  looksLikeProject,
  subscribeProjectPathsChanged,
  type RecentProject,
} from "../../projects/public/recents";
import {
  groupProjectKeys,
  parseTargetValue,
  targetValue,
  type DefaultsTarget,
} from "../model/providerDefaultsDraft";
import { ProjectScopeIcon } from "./ProjectScopeIcon";

export type DefaultsSaveState =
  | { state: "idle" }
  | { state: "saved"; target: string }
  | { state: "error"; message: string };

const iconClass = "icon-sm shrink-0 text-(--ui-text-secondary)";

// Group membership is read from storage; the rail announces every change to it.
let groupsRevision = 0;
const groupsSnapshot = () => groupsRevision;
const subscribeGroups = (listener: () => void) =>
  subscribeProjectPathsChanged(() => {
    groupsRevision += 1;
    listener();
  });

/** Global, then workspaces, groups and projects; a project row names its group and is findable by path. */
export function buildDefaultsTargets(
  cwd: string | undefined,
  recents: RecentProject[] | undefined,
  groups: readonly ProjectGroup[],
  assignments: Record<string, string>,
) {
  type Option = {
    value: string;
    label: string;
    icon?: ReactNode;
    group?: string;
    meta?: string;
    keywords?: string;
    disabled?: boolean;
  };
  const options: Option[] = [
    {
      value: targetValue({ kind: "global" }),
      label: t("Global"),
      icon: <Globe className={iconClass} strokeWidth={1.75} />,
    },
  ];
  const groupOption = (group: ProjectGroup, workspace: boolean): Option => {
    const count = groupProjectKeys(group.id, groups, assignments).length;
    return {
      value: targetValue({ kind: "group", id: group.id, workspace }),
      label: group.name,
      icon: workspace ? (
        <LayoutGrid className={iconClass} strokeWidth={1.75} />
      ) : (
        <Folder className={iconClass} strokeWidth={1.75} />
      ),
      group: workspace ? t("Workspaces") : t("Groups"),
      meta: count === 1 ? t("1 project") : t("{p0} projects", { p0: count }),
      disabled: count === 0,
    };
  };
  for (const group of groups) if (group.workspaceFile) options.push(groupOption(group, true));
  for (const group of groups) if (!group.workspaceFile) options.push(groupOption(group, false));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const seen = new Set<string>();
  for (const path of [cwd, ...(recents ?? []).map((entry) => entry.path)]) {
    if (!path || !looksLikeProject(path) || seen.has(pathKey(path))) continue;
    seen.add(pathKey(path));
    const owner = assignments[pathKey(path)];
    options.push({
      value: targetValue({ kind: "project", path }),
      label: projectDisplayName(path),
      icon: <ProjectScopeIcon path={path} />,
      group: t("Projects"),
      meta: owner ? groupNames.get(owner) : undefined,
      keywords: path,
    });
  }
  return {
    options,
    parse: (value: string) => parseTargetValue(value, groups),
    label: (target: DefaultsTarget) =>
      options.find((option) => option.value === targetValue(target))?.label ?? t("Global"),
    has: (target: DefaultsTarget) =>
      options.some((option) => option.value === targetValue(target) && !option.disabled),
  };
}

export function useDefaultsTargets(cwd: string | undefined, recents: RecentProject[] | undefined) {
  const revision = useSyncExternalStore(subscribeGroups, groupsSnapshot, groupsSnapshot);
  // Labels are translated when the options are built, so a language change rebuilds them.
  const locale = getLocale();
  return useMemo(() => {
    const groups = loadProjectGroups();
    return buildDefaultsTargets(cwd, recents, groups, loadProjectGroupAssignments(groups));
  }, [locale, cwd, recents, revision]);
}

/**
 * Bottom bar of Providers > Defaults: what the pending changes apply to, how many there are,
 * and whether the last save reached storage. Stays in view while the form scrolls.
 */
export function ProviderDefaultsSaveBar({
  target,
  options,
  onTargetChange,
  pending,
  saveState,
  onSave,
  onDiscard,
}: {
  target: DefaultsTarget;
  options: ReturnType<typeof useDefaultsTargets>["options"];
  onTargetChange: (value: string) => void;
  pending: number;
  saveState: DefaultsSaveState;
  onSave: () => void;
  onDiscard: () => void;
}) {
  useLocale();
  const tone = pending > 0 ? "warning" : saveState.state === "error" ? "danger" : "secondary";
  const status =
    saveState.state === "error"
      ? t("Not saved. {p0}", { p0: saveState.message })
      : pending > 0
        ? pending === 1
          ? t("1 unsaved change")
          : t("{p0} unsaved changes", { p0: pending })
        : "";
  const groupTarget = target.kind === "group";
  return (
    <div className="provider-save-bar" data-dirty={pending > 0 || undefined}>
      {status ? (
        <div className="provider-save-bar-status">
          <StatusDot tone={tone} />
          <LiveText text={status} className="provider-save-bar-text" />
        </div>
      ) : null}
      <div className="provider-save-bar-actions">
        <span className="provider-save-bar-label">{t("Apply to")}</span>
        <SearchableSelect
          hideLabel
          label={t("Apply defaults to")}
          searchPlaceholder={t("Search projects, groups and workspaces")}
          value={targetValue(target)}
          options={options}
          onChange={onTargetChange}
          groupFilter
          side="top"
          align="end"
          menuMinWidth={380}
          menuMaxHeight={420}
        />
        <Button size="sm" variant="ghost" disabled={pending === 0} onClick={onDiscard}>
          {t("Discard")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={pending === 0}
          success={saveState.state === "saved" && pending === 0}
          successLabel={t("Saved")}
          disabledReason={
            saveState.state === "saved" && pending === 0
              ? t("Saved to {p0}", { p0: saveState.target })
              : undefined
          }
          onClick={onSave}
        >
          {saveState.state === "error" && pending > 0 ? t("Retry") : t("Save")}
        </Button>
      </div>
      {groupTarget ? (
        <p className="provider-save-bar-note">
          {t("Saved into each project of the group. Projects added later follow Global.")}
        </p>
      ) : null}
    </div>
  );
}

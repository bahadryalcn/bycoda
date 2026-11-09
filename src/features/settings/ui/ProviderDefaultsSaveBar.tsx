import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { Folder, Globe, LayoutGrid } from "../../../shared/ui/icons";
import { LiveText } from "../../../shared/ui/LiveText";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { loadProjectGroups, type ProjectGroup } from "../../projects/public/projectGroups";
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

export function useDefaultsTargets(cwd: string | undefined, recents: RecentProject[] | undefined) {
  const revision = useSyncExternalStore(subscribeGroups, groupsSnapshot, groupsSnapshot);
  return useMemo(() => {
    const groups = loadProjectGroups();
    const options: {
      value: string;
      label: string;
      icon?: ReactNode;
      group?: string;
      meta?: string;
      disabled?: boolean;
    }[] = [
      {
        value: targetValue({ kind: "global" }),
        label: t("Global"),
        icon: <Globe className={iconClass} strokeWidth={1.75} />,
      },
    ];
    const seen = new Set<string>();
    for (const path of [cwd, ...(recents ?? []).map((entry) => entry.path)]) {
      if (!path || !looksLikeProject(path) || seen.has(pathKey(path))) continue;
      seen.add(pathKey(path));
      options.push({
        value: targetValue({ kind: "project", path }),
        label: projectDisplayName(path),
        icon: <ProjectScopeIcon path={path} />,
        group: t("Projects"),
      });
    }
    const groupOption = (group: ProjectGroup, workspace: boolean) => {
      const count = groupProjectKeys(group.id, groups).length;
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
    for (const group of groups) if (!group.workspaceFile) options.push(groupOption(group, false));
    for (const group of groups) if (group.workspaceFile) options.push(groupOption(group, true));
    return {
      options,
      parse: (value: string) => parseTargetValue(value, groups),
      label: (target: DefaultsTarget) =>
        options.find((option) => option.value === targetValue(target))?.label ?? t("Global"),
      has: (target: DefaultsTarget) =>
        options.some((option) => option.value === targetValue(target) && !option.disabled),
    };
    // getLocale(): labels are translated when the options are built.
  }, [getLocale(), cwd, recents, revision]);
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
  const tone =
    pending > 0
      ? "warning"
      : saveState.state === "error"
        ? "danger"
        : saveState.state === "saved"
          ? "success"
          : "secondary";
  const status =
    saveState.state === "error"
      ? t("Not saved. {p0}", { p0: saveState.message })
      : pending > 0
        ? pending === 1
          ? t("1 unsaved change")
          : t("{p0} unsaved changes", { p0: pending })
        : saveState.state === "saved"
          ? t("Saved to {p0}", { p0: saveState.target })
          : t("All changes saved");
  const groupTarget = target.kind === "group";
  return (
    <div className="provider-save-bar" data-dirty={pending > 0 || undefined}>
      <div className="provider-save-bar-status">
        <StatusDot tone={tone} />
        <LiveText text={status} className="provider-save-bar-text" />
      </div>
      <div className="provider-save-bar-actions">
        <span className="provider-save-bar-label">{t("Apply to")}</span>
        <SearchableSelect
          hideLabel
          label={t("Apply defaults to")}
          searchPlaceholder={t("Search projects, groups and workspaces")}
          value={targetValue(target)}
          options={options}
          onChange={onTargetChange}
        />
        <Button size="sm" variant="ghost" disabled={pending === 0} onClick={onDiscard}>
          {t("Discard")}
        </Button>
        <Button size="sm" variant="primary" disabled={pending === 0} onClick={onSave}>
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

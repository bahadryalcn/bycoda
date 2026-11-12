import { Badge } from "../../../shared/ui/Badge";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import "./ProviderDefaults.css";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { DefaultsTargetsPicker } from "./providerDefaultsTargetsPicker";
import { selectedTargetValues, type DefaultsDraft } from "../model/providerDefaultsDraft";
import { prepareDefaultsDraft } from "../model/providerDefaultsSupport";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { Text } from "../../../shared/ui/Text";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { Folder, Globe, LayoutGrid } from "../../../shared/ui/icons";
import { LiveText } from "../../../shared/ui/LiveText";
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
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { InfoPopover } from "../../../shared/ui/InfoPopover";

export type DefaultsSaveState =
  | { state: "idle" }
  | { state: "saved"; target: string }
  | { state: "error"; message: string; failed?: string[] };

const iconClass = "icon-sm shrink-0";

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
      icon: <Globe className={iconClass} tone="secondary" strokeWidth={1.75} />,
    },
  ];
  const groupOption = (group: ProjectGroup, workspace: boolean): Option => {
    const count = groupProjectKeys(group.id, groups, assignments).length;
    return {
      value: targetValue({ kind: "group", id: group.id, workspace }),
      label: group.name,
      icon: workspace ? (
        <LayoutGrid className={iconClass} tone="secondary" strokeWidth={1.75} />
      ) : (
        <Folder className={iconClass} tone="secondary" strokeWidth={1.75} />
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
  for (const path of [
    cwd,
    ...(recents ?? []).map((entry) => entry.path),
    ...Object.keys(assignments),
  ]) {
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
    parse: (value: string) =>
      parseTargetValue(
        JSON.stringify(
          selectedTargetValues(
            value,
            options.filter((option) => !option.disabled).map((option) => option.value),
          ),
        ),
        groups,
      ),
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
  selection,
  draft,
  activeProvider,
  providers = [],
  onDraftChange,
}: {
  selection?: string;
  draft?: DefaultsDraft;
  activeProvider?: HarnessId;
  providers?: HarnessId[];
  onDraftChange?: (draft: DefaultsDraft) => void;
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
  const values = selectedTargetValues(
    selection ?? targetValue(target),
    options.filter((option) => !option.disabled).map((option) => option.value),
  );
  if (!values.length) values.push("global");
  const groupTarget = values.some((value) => value.startsWith("group:"));
  const skips =
    draft && activeProvider ? prepareDefaultsDraft(draft, activeProvider, providers).skipped : [];
  return (
    <div
      {...surfaceAttributes(
        { variant: "base", frame: "settings", edge: "block-start" },
        "provider-defaults-save-bar",
      )}
    >
      <Surface
        variant="transparent"
        padding="none"
        radius="none"
        frame="settings"
        edge="block-end"
        className="provider-defaults-boundary"
      />
      {status || skips.length || groupTarget ? (
        <div className="provider-save-bar-status">
          {status ? <StatusDot tone={tone} /> : null}
          <LiveText
            text={status}
            size="secondary"
            tone="primary"
            leading="inherit"
            truncate={saveState.state !== "error"}
          />
          {skips.length || groupTarget ? (
            <div className="provider-defaults-notes">
              <Badge size="xs" tone={skips.length ? "warning" : "neutral"}>
                {skips.length === 1
                  ? t("1 field skipped")
                  : skips.length
                    ? t("{p0} fields skipped", { p0: skips.length })
                    : t("Groups")}
              </Badge>
              <InfoPopover label={t("Apply details")}>
                {skips.map((skip) => (
                  <Text
                    key={`${skip.harness}:${skip.field}`}
                    as="p"
                    size="caption"
                    tone="muted"
                    className="provider-save-bar-note"
                  >
                    {t("{p0}: {p1} is not available for {p2}", {
                      p0: skip.field,
                      p1: skip.value ?? t("Automatic"),
                      p2: HARNESS_TITLE[skip.harness],
                    })}
                  </Text>
                ))}
                {groupTarget ? (
                  <Text
                    as="p"
                    size="caption"
                    tone="secondary"
                    leading="inherit"
                    className="provider-save-bar-note"
                  >
                    {t("Saved into each project of the group. Projects added later follow Global.")}
                  </Text>
                ) : null}
              </InfoPopover>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="provider-save-bar-actions">
        <div className="provider-defaults-field">
          <Text size="caption" tone="muted">
            {t("Apply to")}
          </Text>
          {draft && onDraftChange ? (
            <SegmentedControl
              label={t("Provider scope")}
              value={draft.providerScope ?? "this"}
              options={[
                {
                  value: "this",
                  label: activeProvider ? HARNESS_TITLE[activeProvider] : t("This provider"),
                  icon: activeProvider ? (
                    <HarnessIcon harness={activeProvider} className="icon-sm" />
                  ) : undefined,
                },
                {
                  value: "all",
                  label: t("All providers"),
                  icon: <LayoutGrid className="icon-sm" />,
                },
              ]}
              onValueChange={(value) =>
                onDraftChange({ ...draft, providerScope: value === "all" ? "all" : undefined })
              }
            />
          ) : null}
        </div>
        <div className="provider-defaults-field">
          <Text size="caption" tone="muted">
            {t("Save in")}
          </Text>
          <DefaultsTargetsPicker
            values={values}
            options={options}
            onChange={(next) => onTargetChange(JSON.stringify(next))}
          />
        </div>
        <div className="provider-defaults-buttons">
          <Button size="sm" variant="ghost" disabled={pending === 0} onClick={onDiscard}>
            {t("Discard")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={pending === 0}
            success={saveState.state === "saved" && pending === 0}
            successLabel={saveState.state === "saved" && pending === 0 ? t("Saved") : undefined}
            disabledReason={
              saveState.state === "saved" && pending === 0
                ? t("Saved to {p0}", { p0: saveState.target })
                : undefined
            }
            onClick={onSave}
          >
            {saveState.state === "error" && pending > 0
              ? t("Retry")
              : values.length > 1
                ? t("Save to {p0} targets", { p0: values.length })
                : t("Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { t } from "../../../shared/i18n";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Text } from "../../../shared/ui/Text";
import { Group, Row } from "../../../shared/ui/settings";
import type { RecentProject } from "../../projects/public/recents";
import { SearchableProjectPicker } from "../../projects/public/SearchableProjectPicker";
import { targetValue, type DefaultsTarget } from "../model/providerDefaultsDraft";

/**
 * Where the edits below apply: all projects, or one project. It sits above the fields it
 * governs, so the target is read before a value is changed. Choosing Project opens the shared
 * project picker; closing it without a pick returns to All projects.
 */
export function ProviderDefaultsScopeRow({
  target,
  cwd,
  recents,
  onTargetChange,
  projectsOnlyChats = false,
}: {
  target: DefaultsTarget;
  /** The open project; it is offered in the picker even before it is in the recents. */
  cwd?: string;
  recents?: RecentProject[];
  /** Receives `global` or `project:<path>`. */
  onTargetChange: (value: string) => void;
  /** Project values do not reach unattended work; the row says so. */
  projectsOnlyChats?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const project = target.kind === "project" ? target.path : "";
  const projectMode = choosing || target.kind === "project";
  return (
    <Group id="defaults-scope" layout="full" title={null}>
      <Row
        label={t("Where these settings apply")}
        description={
          projectMode
            ? t(
                "These settings apply only to this project. A row with a reset button differs from All projects; reset returns it to that value.",
              )
            : t(
                "Every new conversation starts with these settings. A project uses them for each setting it does not change.",
              )
        }
        descriptionVisible
      >
        <SegmentedControl
          label={t("Where these settings apply")}
          value={projectMode ? "project" : "global"}
          options={[
            { value: "global", label: t("All projects") },
            { value: "project", label: t("One project") },
          ]}
          onValueChange={(next) => {
            if (next === "project") {
              if (target.kind !== "project") setChoosing(true);
              return;
            }
            setChoosing(false);
            if (target.kind !== "global") onTargetChange(targetValue({ kind: "global" }));
          }}
        />
        {projectMode ? (
          <SearchableProjectPicker
            cwd={project}
            railCwd={cwd}
            recents={recents ?? []}
            appearance="filled"
            chooseLabel={t("Choose project")}
            openOnMount={choosing}
            onDismiss={() => setChoosing(false)}
            onSelectProject={(path) => {
              setChoosing(false);
              onTargetChange(targetValue({ kind: "project", path }));
            }}
          />
        ) : null}
        {projectMode && projectsOnlyChats ? (
          <Text size="caption" tone="muted">
            {t("Chats only")}
          </Text>
        ) : null}
      </Row>
    </Group>
  );
}

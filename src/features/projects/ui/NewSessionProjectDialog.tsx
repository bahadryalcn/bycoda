import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { StandaloneChat } from "../../../shared/ui/icons";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { PickerList, filterPickerOptions, usePickerList } from "../../../shared/ui/picker";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import { isRemoteProjectPath, type RecentProject } from "../model/recents";
import { projectDisplayNameFrom, useProjectLabels } from "../model/projectNames";
import { PROJECT_WINDOW_THRESHOLD, ProjectOptionIcon } from "./ProjectOptionIcon";
import {
  duplicateProjectNames,
  isDuplicateProjectName,
  parentFolderLabel,
} from "./projectIdentity";
import {
  resolveTabGroupColor,
  resolveTabGroupMascot,
  useTabGroupColors,
  useTabGroupCustomColors,
  useTabGroupMascots,
} from "../../workspace/model/tabGroups";

/** Sentinel cwd for a session without a project; see `useNewSessionActions`. */
const NO_PROJECT_CWD = "~";

async function runPick(
  path: string,
  onPick: (path: string) => void | Promise<void>,
  onClose: () => void,
  setError: (message: string) => void,
  settle: () => void,
) {
  try {
    await onPick(path);
    onClose();
  } catch (reason) {
    setError(errorText(reason));
  } finally {
    settle();
  }
}

/** An explicit project choice, including the current project, before creating a chat. */
export function NewSessionProjectDialog({
  projects,
  onPick,
  onClose,
}: {
  projects: readonly RecentProject[];
  onPick: (path: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const logos = useTabGroupLogos();
  const labels = useProjectLabels();
  const colors = useTabGroupColors();
  const customColors = useTabGroupCustomColors();
  const mascots = useTabGroupMascots();
  // Show path context only when it distinguishes projects with the same title.
  const duplicates = duplicateProjectNames(
    projects.map(({ path }) => ({ path, name: projectDisplayNameFrom(path, labels) })),
  );
  const choices = [
    {
      value: NO_PROJECT_CWD,
      title: t("No project"),
      icon: <StandaloneChat className="icon-sm" />,
      disabled: busy,
    },
    ...projects.map(({ path }) => {
      const key = projectKey(path);
      const seed = projectName(path);
      const title = projectDisplayNameFrom(path, labels);
      return {
        value: path,
        title,
        description: isDuplicateProjectName(duplicates, title)
          ? isRemoteProjectPath(path)
            ? `${t("Remote")} · ${path}`
            : parentFolderLabel(path) || path
          : undefined,
        icon: (
          <ProjectOptionIcon
            project={key}
            seed={seed}
            logos={logos}
            mascot={resolveTabGroupMascot(key, mascots)}
            color={resolveTabGroupColor(key, colors, customColors, seed)}
          />
        ),
        disabled: busy,
      };
    }),
  ];
  const pick = async (path: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    await runPick(path, onPick, onClose, setError, () => {
      pending.current = false;
      setBusy(false);
    });
  };
  const picker = usePickerList({
    options: filterPickerOptions(choices, query, undefined, ({ value }) =>
      value === NO_PROJECT_CWD
        ? undefined
        : `${t(isRemoteProjectPath(value) ? "Remote" : "Local")} · ${value}`,
    ),
    value: null,
    onChange: (path) => void pick(path),
    loop: true,
    resetKey: query,
  });
  // The "No project" option is always listed, so an empty list only means the
  // query matched nothing; "No projects yet" would be false here.
  return (
    <Modal
      padding="none"
      title={t("New session in")}
      size="md"
      motion="none"
      onClose={() => {
        if (!pending.current) onClose();
      }}
      initialFocus="input"
    >
      <div className="flex min-h-0 flex-col p-2">
        <PopoverSearchHeader
          label={t("Search projects")}
          value={query}
          onValueChange={setQuery}
          disabled={busy}
          {...picker.searchProps}
        />
        <PickerList
          label={t("New session in")}
          controller={picker}
          query={query}
          checkPlacement="none"
          disabled={busy}
          loading={busy}
          loadingLabel={t("Creating session…")}
          error={
            error ? (
              <InlineError inset="row" details={error}>
                {t("Could not create session.")}
              </InlineError>
            ) : null
          }
          emptyLabel={t("No projects found")}
          windowed={projects.length > PROJECT_WINDOW_THRESHOLD}
          className="max-h-[min(360px,50vh)]"
        />
      </div>
    </Modal>
  );
}

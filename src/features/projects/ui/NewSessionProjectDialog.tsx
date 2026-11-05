import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { PickerList, filterPickerOptions, usePickerList } from "../../../shared/ui/picker";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import { isRemoteProjectPath, type RecentProject } from "../model/recents";
import { projectDisplayName } from "../model/projectNames";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { ProjectMascot } from "./ProjectMascot";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

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
  const colors = loadTabGroupColors();
  const customColors = loadTabGroupCustomColors();
  const mascots = loadTabGroupMascots();
  const options = filterPickerOptions(
    projects.map(({ path }) => {
      const key = projectKey(path);
      const seed = projectName(path);
      const logo = resolveTabGroupLogo(key, logos);
      return {
        value: path,
        title: projectDisplayName(path),
        description: `${t(isRemoteProjectPath(path) ? "Remote" : "Local")} · ${path}`,
        group: t("Projects"),
        icon: logo ? (
          <ProjectLogoIcon path={logo} className="icon-sm rounded-sm" imageClassName="icon-sm" />
        ) : (
          <ProjectMascot
            project={seed}
            name={resolveTabGroupMascot(key, mascots)}
            color={resolveTabGroupColor(key, colors, customColors, seed)}
            className="icon-sm"
          />
        ),
        disabled: busy,
      };
    }),
    query,
  );
  const pick = async (path: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onPick(path);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const picker = usePickerList({
    options,
    value: null,
    onChange: (path) => void pick(path),
    loop: true,
    resetKey: query,
  });
  return (
    <Modal
      title={t("Choose a project for the new session")}
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
          label={t("Projects")}
          controller={picker}
          query={query}
          checkPlacement="none"
          disabled={busy}
          loading={busy}
          loadingLabel={t("Creating session…")}
          error={error}
          emptyLabel={t(projects.length ? "No projects found" : "No projects yet")}
          className="max-h-[min(360px,50vh)]"
        />
      </div>
    </Modal>
  );
}

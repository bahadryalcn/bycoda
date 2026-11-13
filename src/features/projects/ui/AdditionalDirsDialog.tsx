import { Text } from "../../../shared/ui/Text";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useT } from "../../../shared/i18n";
import { useState } from "react";
import { basename } from "../../../platform/tauri/fs";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import {
  additionalDirCandidatesFrom,
  loadAdditionalDirs,
  saveAdditionalDirs,
} from "../model/additionalDirs";
import { useProjectGroupAssignments } from "../model/projectGroups";
import { useRecents } from "../model/recents";

type Props = {
  project: string;
  name: string;
  onClose: () => void;
};

/**
 * Picks which other projects of the same rail group an agent working in this
 * project may also read and edit.
 */
export function AdditionalDirsDialog({ project, name, onClose }: Props) {
  const t = useT();
  const recents = useRecents();
  const assignments = useProjectGroupAssignments();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => loadAdditionalDirs(project));
  const selectedKeys = new Set(selected.map(pathKey));
  // A folder picked earlier stays listed after it leaves the group, so it can
  // still be turned off.
  const candidates = [
    ...additionalDirCandidatesFrom(project, recents, assignments),
    ...selected,
  ].filter(
    (path, index, all) => all.findIndex((other) => pathKey(other) === pathKey(path)) === index,
  );

  const needle = query.trim().toLocaleLowerCase();
  const visible = candidates.filter((path) =>
    `${basename(path)} ${path}`.toLocaleLowerCase().includes(needle),
  );

  const toggle = (path: string) => {
    const next = selectedKeys.has(pathKey(path))
      ? selected.filter((dir) => pathKey(dir) !== pathKey(path))
      : [...selected, path];
    setSelected(next);
    saveAdditionalDirs(project, next);
  };

  return (
    <Modal
      padding="none"
      title={t("Additional folders")}
      description={t(
        "Folders agents in {p0} can also read and edit. Applies to Claude Code and Codex, from the next message.",
        { p0: name },
      )}
      size="sm"
      fitViewport
      onClose={onClose}
    >
      {candidates.length ? (
        <div className="px-2 pt-2">
          <SearchInput
            standalone
            aria-label={t("Search folders")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      {candidates.length === 0 ? (
        <EmptyState
          description={t("Put this project in a group with other projects to offer them here.")}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          context="panel"
          kind="filtered"
          icon={null}
          description={t("No folders match your search.")}
          onReset={() => setQuery("")}
          resetLabel={t("Clear search")}
        />
      ) : (
        <ul className="min-h-0 overflow-y-auto p-2">
          {visible.map((path) => (
            <li key={pathKey(path)}>
              <ActionHost>
                <Checkbox
                  checked={selectedKeys.has(pathKey(path))}
                  onChange={() => toggle(path)}
                  label={
                    <>
                      <span className="flex min-w-0 flex-col">
                        <Text truncate size="secondary" tone="primary">
                          {basename(path)}
                        </Text>
                        <Text truncate size="micro" tone="muted">
                          {prettyCwd(path)}
                        </Text>
                      </span>
                    </>
                  }
                  padding={{ inline: "md", block: "sm" }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
                />
              </ActionHost>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

import { SearchInput } from "../../../shared/ui/SearchInput";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { basename } from "../../../platform/tauri/fs";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import {
  additionalDirCandidates,
  loadAdditionalDirs,
  saveAdditionalDirs,
} from "../model/additionalDirs";

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
  useLocale();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => loadAdditionalDirs(project));
  const selectedKeys = new Set(selected.map(pathKey));
  // A folder picked earlier stays listed after it leaves the group, so it can
  // still be turned off.
  const candidates = [...additionalDirCandidates(project), ...selected].filter(
    (path, index, all) => all.findIndex((other) => pathKey(other) === pathKey(path)) === index,
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
      ) : (
        <ul className="min-h-0 overflow-y-auto p-2">
          {candidates
            .filter((path) =>
              `${basename(path)} ${path}`
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
            )
            .map((path) => (
              <li key={pathKey(path)}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--ui-surface-hover)]">
                  <Checkbox
                    checked={selectedKeys.has(pathKey(path))}
                    onChange={() => toggle(path)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] text-content">{basename(path)}</span>
                    <span className="truncate text-[11px] text-[var(--ui-text-muted)]">
                      {prettyCwd(path)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
        </ul>
      )}
    </Modal>
  );
}

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
      {candidates.length === 0 ? (
        <p className="p-4 text-[12px] leading-5 text-content/55">
          {t("Put this project in a group with other projects to offer them here.")}
        </p>
      ) : (
        <ul className="min-h-0 overflow-y-auto p-2">
          {candidates.map((path) => (
            <li key={pathKey(path)}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-content/5">
                <input
                  type="checkbox"
                  checked={selectedKeys.has(pathKey(path))}
                  onChange={() => toggle(path)}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] text-content">{basename(path)}</span>
                  <span className="truncate text-[11px] text-content/45">{prettyCwd(path)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

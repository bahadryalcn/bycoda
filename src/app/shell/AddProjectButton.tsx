import { useRef, useState } from "react";
import { useT } from "../../shared/i18n";
import { InlineAction } from "../../shared/ui/ActionHost";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Archive, FolderPlus, Internet, Plus } from "../../shared/ui/icons";
import { OPEN_REMOTE_PROJECT_EVENT } from "../../features/connections/model/connections";
import { OPEN_CODE_WORKSPACE_EVENT } from "../../features/projects/model/codeWorkspace";
import { OPEN_SESSION_IMPORT_EVENT } from "../../features/sessions/public/importModel";

/** Adds a folder on this computer, or one on a connected machine. */
export function AddProjectButton({ onOpenFolder }: { onOpenFolder: () => void }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <InlineAction
        reveal="always"
        label={t("Open project")}
        motion="none"
        ref={anchor}
        type="button"
        data-no-drag
        aria-label={t("Open project")}
        data-usage-guide="project-add"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="shrink-0"
      >
        <Plus className="icon-sm" strokeWidth={1.75} />
      </InlineAction>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Open project")}
          align="start"
          width={290}
          returnFocusRef={anchor}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            if (id === "folder") onOpenFolder();
            else window.dispatchEvent(new Event(id));
          }}
          items={[
            {
              kind: "item",
              id: "folder",
              label: t("Open folder…"),
              icon: <FolderPlus className="icon-sm" />,
            },
            {
              kind: "item",
              id: OPEN_CODE_WORKSPACE_EVENT,
              label: t("Open VS Code workspace…"),
              icon: <FolderPlus className="icon-sm" />,
            },
            {
              kind: "item",
              id: OPEN_REMOTE_PROJECT_EVENT,
              label: t("Open folder on a machine…"),
              icon: <Internet className="icon-sm" />,
            },
            {
              kind: "item",
              id: OPEN_SESSION_IMPORT_EVENT,
              label: t("Import Claude Code / Codex sessions…"),
              icon: <Archive className="icon-sm" />,
            },
          ]}
        />
      ) : null}
    </>
  );
}

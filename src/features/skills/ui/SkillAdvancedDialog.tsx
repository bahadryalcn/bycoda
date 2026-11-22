import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError } from "../../../shared/ui/InlineError";
import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { joinPath } from "../../../shared/lib/paths";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { homeDir, revealPath } from "../../../platform/tauri/fs";
import styles from "./SkillsPage.module.css";

type FolderRow = { id: string; label: string; path: string };

/** Where skills live on this computer, one row per folder with a button that opens it. */
export function SkillAdvancedDialog({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [error, setError] = useState("");
  // The home folder is only known to the OS; it never changes while the app runs.
  const home = useQuery({
    queryKey: ["home-dir"],
    queryFn: () => homeDir(),
    staleTime: Infinity,
  }).data;
  const rows: FolderRow[] = [
    ...(cwd ? [{ id: "project", label: t("Project"), path: joinPath(cwd, ".agents/skills") }] : []),
    ...(home
      ? [{ id: "personal", label: t("Personal"), path: joinPath(home, ".agents/skills") }]
      : []),
  ];
  return (
    <Modal title={t("Skill folders")} size="md" onClose={onClose}>
      <div
        className={styles.folders}
        id="setting-skill-folders"
        data-setting-id="skill-folders"
        tabIndex={-1}
      >
        <div className={styles.foldersHeader}>
          <Text size="secondary" tone="secondary" leading="inherit">
            {t("Skills are read from these folders.")}
          </Text>
          <InfoPopover width={360}>
            <p>
              {t(
                "Disabled skills stay on disk. {p0} blocks their names across all sources on the selected machine, including search, reads and explicit invocations. Project skills live in {p1}, personal skills in {p2}; harness folders are also included.",
                {
                  p0: PRODUCT_IDENTITY.displayName,
                  p1: ".agents/skills",
                  p2: "~/.agents/skills",
                },
              )}
            </p>
            <p>
              {t(
                "Changes apply to subsequent turns. Running turns and previously loaded context cannot be erased. Enabling in bycoda does not override provider restrictions.",
              )}
            </p>
            <p>
              {t(
                "Native skill controls: Codex, Claude, OpenCode, Pi and OMP. Cursor, Grok, FX, Hermes, Antigravity and generic ACP receive current restrictions as instructions; their native skill loading cannot be controlled individually through the connected protocol.",
              )}
            </p>
          </InfoPopover>
        </div>
        {rows.map((row) => (
          <div key={row.id} className={styles.folderRow}>
            <div className={styles.folderText}>
              <Text size="secondary" weight="medium" leading="inherit">
                {row.label}
              </Text>
              <Text size="caption" tone="secondary" leading="inherit" className={styles.folderPath}>
                {row.path}
              </Text>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setError("");
                revealPath(row.path).catch((reason: unknown) => setError(errorText(reason)));
              }}
            >
              {t("Open folder")}
            </Button>
          </div>
        ))}
        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Modal>
  );
}

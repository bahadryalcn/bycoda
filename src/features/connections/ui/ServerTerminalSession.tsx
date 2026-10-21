import { useEffect, useState, type ReactNode } from "react";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
} from "../../settings/model/appearancePreferences";
import { File } from "../../../shared/ui/icons";
import type { SshEndpoint } from "../model/serverInventory";
import styles from "./ServerTerminalSession.module.css";

/** Presentation only. The existing SSH PTY owns connection, input and approvals. */
export function ServerTerminalSession({
  endpoint,
  target,
  port,
  identityFile,
  keyGenerationPath,
  children,
}: {
  endpoint?: SshEndpoint;
  target?: string;
  port?: number | null;
  identityFile?: string | null;
  keyGenerationPath?: string;
  children: (
    fontSize: number,
    onFontSizeChange: (size: number) => void,
    lineHeight: number,
  ) => ReactNode;
}) {
  const [preferences, setPreferences] = useState(loadAppearancePreferences);
  const defaultSize = preferences.terminalSize;
  const [zoom, setZoom] = useState({ defaultSize, size: defaultSize });
  if (zoom.defaultSize !== defaultSize) setZoom({ defaultSize, size: defaultSize });
  const fontSize = zoom.defaultSize === defaultSize ? zoom.size : defaultSize;
  const setFontSize = (size: number) => setZoom({ defaultSize, size });
  useEffect(() => {
    const sync = () => setPreferences(loadAppearancePreferences());
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, sync);
  }, []);
  const key = endpoint?.identityFile ?? identityFile;
  const sshPort = endpoint?.port ?? port;
  const address =
    keyGenerationPath ??
    (endpoint ? `${endpoint.user ? `${endpoint.user}@` : ""}${endpoint.host}` : (target ?? "SSH"));
  return (
    <div className={styles.session} data-server-terminal-session>
      <div className={styles.toolbar}>
        <div className={styles.identity}>
          <span className={styles.address} title={address}>
            {address}
          </span>
          {sshPort ? <span className={styles.port}>:{sshPort}</span> : null}
          {key ? (
            <span className={styles.key} title={key}>
              <File aria-hidden className="size-3 shrink-0" />
              <span className={styles.keyName}>{key.split(/[\\/]/).pop()}</span>
            </span>
          ) : null}
        </div>
      </div>
      {children(fontSize, setFontSize, preferences.terminalLineHeight)}
    </div>
  );
}

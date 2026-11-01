import { useEffect, useState, type ReactNode } from "react";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
} from "../../settings/model/appearancePreferences";
import { StatusBadge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { t } from "../../../shared/i18n";
import type { SshEndpoint } from "../model/serverInventory";
import styles from "./ServerTerminalSession.module.css";

/** Presentation only. The existing SSH PTY owns connection, input and approvals. */
export function ServerTerminalSession({
  name,
  lifecycle,
  endpoint,
  target,
  port,
  identityFile,
  keyGenerationPath,
  children,
}: {
  name?: string;
  lifecycle?: "opened-on-computer" | "exited" | "failed" | "closed";
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
          <OverflowTooltip label={name ?? address}>
            <span className={styles.address}>{name ?? address}</span>
          </OverflowTooltip>
          <span className="shrink-0 text-ui-caption text-(--ui-text-muted)" role="status">
            {lifecycle === "opened-on-computer" ? (
              <StatusBadge status="running" />
            ) : lifecycle === "failed" ? (
              <StatusBadge status="failed" />
            ) : (
              t(!lifecycle ? "Opening…" : "Terminal closed")
            )}
          </span>
        </div>
        <InfoPopover label={t("Connection details")}>
          <dl className="grid min-w-0 gap-2">
            <div><dt>{t("Host")}</dt><dd className="select-text break-all">{address}{sshPort ? `:${sshPort}` : ""}</dd></div>
            {key ? <div><dt>{t("Identity file")}</dt><dd className="select-text break-all">{key}</dd></div> : null}
          </dl>
        </InfoPopover>
      </div>
      {children(fontSize, setFontSize, preferences.terminalLineHeight)}
    </div>
  );
}

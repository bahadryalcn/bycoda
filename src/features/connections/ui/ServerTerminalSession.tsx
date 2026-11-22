import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { useEffect, useState, type ReactNode } from "react";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
} from "../../settings/public/appearancePreferences";
import { Badge, StatusBadge } from "../../../shared/ui/Badge";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useT } from "../../../shared/i18n";
import type { SshEndpoint } from "../model/serverInventory";
import styles from "./ServerTerminalSession.module.css";

type ServerTerminalLifecycle = "opened-on-computer" | "exited" | "failed" | "closed";

export function ServerTerminalStatus({ lifecycle }: { lifecycle?: ServerTerminalLifecycle }) {
  const t = useT();
  switch (lifecycle) {
    case "opened-on-computer":
      return (
        <Badge size="xs" appearance="subtle" icon={<StatusDot tone="success" />}>
          {t("Running")}
        </Badge>
      );
    case "failed":
      return <StatusBadge status="failed" size="xs" />;
    case "exited":
      return <Badge size="xs">{t("Exited")}</Badge>;
    case "closed":
      return <Badge size="xs">{t("Terminal closed")}</Badge>;
    default:
      return (
        <Badge size="xs" icon={<Spinner size="xs" />}>
          {t("Opening…")}
        </Badge>
      );
  }
}

/** Presentation only. The existing SSH PTY owns connection, input and approvals. */
export function ServerTerminalSession({
  name,
  lifecycle,
  endpoint,
  target,
  port,
  identityFile,
  keyGenerationPath,
  actions,
  children,
}: {
  name?: string;
  lifecycle?: ServerTerminalLifecycle;
  endpoint?: SshEndpoint;
  target?: string;
  port?: number | null;
  identityFile?: string | null;
  keyGenerationPath?: string;
  actions?: ReactNode;
  children: (
    fontSize: number,
    onFontSizeChange: (size: number) => void,
    lineHeight: number,
    toolbarTarget: HTMLDivElement | null,
  ) => ReactNode;
}) {
  const t = useT();
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [preferences, setPreferences] = useState(loadAppearancePreferences);
  const defaultSize = preferences.terminalSize;
  const [zoom, setZoom] = useState({ defaultSize, size: defaultSize });
  if (zoom.defaultSize !== defaultSize) setZoom({ defaultSize, size: defaultSize });
  const fontSize = zoom.defaultSize === defaultSize ? zoom.size : defaultSize;
  const setFontSize = (size: number) => setZoom({ defaultSize, size });
  // Sync saved terminal typography without replacing the retained terminal.
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
          <span className={styles.status} role="status">
            <ServerTerminalStatus lifecycle={lifecycle} />
          </span>
        </div>
        <div className={styles.actions}>
          {actions}
          <div ref={setToolbarTarget} />
          <InfoPopover label={t("Connection details")}>
            <DescriptionList>
              <DescriptionItem term={t("Host")}>
                {address}
                {sshPort ? `:${sshPort}` : ""}
              </DescriptionItem>
              {key ? <DescriptionItem term={t("Identity file")}>{key}</DescriptionItem> : null}
            </DescriptionList>
          </InfoPopover>
        </div>
      </div>
      {children(fontSize, setFontSize, preferences.terminalLineHeight, toolbarTarget)}
    </div>
  );
}

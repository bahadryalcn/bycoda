import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { useEffect, useState, type ReactNode } from "react";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
} from "../../settings/public/appearancePreferences";
import { Badge, StatusBadge } from "../../../shared/ui/Badge";
import { Spinner } from "../../../shared/ui/Spinner";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { useT } from "../../../shared/i18n";
import type { SshEndpoint } from "../model/serverInventory";
import styles from "./ServerTerminalSession.module.css";

type ServerTerminalLifecycle = "opened-on-computer" | "exited" | "failed" | "closed";

/** Badge for a tab whose terminal is not healthy; a running terminal shows nothing. */
export function ServerTerminalStatus({ lifecycle }: { lifecycle?: ServerTerminalLifecycle }) {
  const t = useT();
  switch (lifecycle) {
    case "opened-on-computer":
      return null;
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
  endpoint,
  target,
  port,
  identityFile,
  keyGenerationPath,
  actions,
  children,
}: {
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
      {/* The tab already names the terminal and shows its state; the toolbar holds only actions. */}
      <PaneHeader
        actions={
          <>
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
          </>
        }
      />
      {children(fontSize, setFontSize, preferences.terminalLineHeight, toolbarTarget)}
    </div>
  );
}

import { ActionHost } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Text } from "../../../shared/ui/Text";
import { ChevronRight, RefreshCw } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { type ShellProfiles } from "../../terminal/public/terminalProfiles";
import { RevealedSetting, settingDomId } from "./settingsControls";
import { useContext, useId, useState, type ReactNode } from "react";

type HostKind = "local" | "synced" | "remote";

export const shellCount = (count: number) =>
  count === 1 ? t("1 shell") : t("{p0} shells", { p0: count });

/**
 * One host in the shell list: identity, detection/connection status, the effective
 * profile and the choice. The machine's shell inventory is its expandable detail.
 */
export function HostShellRow({
  settingId,
  detailId,
  name,
  kind,
  status,
  listed,
  chosen,
  effectiveId,
  missing,
  loading,
  disabled,
  refreshDisabled,
  selectLabel,
  refreshLabel,
  onChoose,
  onRefresh,
  feedback,
}: {
  /** Search id for the host's default-shell row. */
  settingId?: string;
  /** Search id that opens the shell inventory. */
  detailId?: string;
  name: string;
  kind: HostKind;
  status: { tone: BadgeTone; label: string };
  listed: ShellProfiles | null;
  /** Saved pick, "" for Automatic. */
  chosen: string;
  effectiveId: string | undefined;
  missing: boolean;
  loading: boolean;
  /** Blocks choosing a shell (saving, or a read-back is required first). */
  disabled: boolean;
  /** Blocks re-reading the machine (saving). */
  refreshDisabled: boolean;
  selectLabel: string;
  refreshLabel: string;
  onChoose: (id: string) => void;
  onRefresh: () => void;
  feedback?: ReactNode;
}) {
  const revealed = useContext(RevealedSetting);
  const flash = settingId != null && revealed === settingId;
  const detailTargeted = detailId != null && revealed === detailId;
  const [open, setOpen] = useState(detailTargeted);
  const [wasTargeted, setWasTargeted] = useState(detailTargeted);
  if (detailTargeted !== wasTargeted) {
    setWasTargeted(detailTargeted);
    if (detailTargeted) setOpen(true);
  }
  const detailPanel = useId();
  // A machine with no shells keeps its install guidance in view: it is a recovery state, not detail.
  const noShells = !!listed && listed.profiles.length === 0;
  const expanded = open || noShells;
  const systemDefault = listed?.profiles.find((profile) => profile.id === listed.defaultId);
  const effective = listed?.profiles.find((profile) => profile.id === effectiveId);
  return (
    <div
      id={settingId ? settingDomId(settingId) : undefined}
      data-setting-id={settingId}
      data-revealed={flash || undefined}
      tabIndex={-1}
      {...surfaceAttributes(
        { radius: "control", variant: flash ? "selected" : undefined },
        "terminal-host",
      )}
    >
      <ActionHost
        {...surfaceAttributes(
          { radius: "none", separator: "block" },
          "settings-collection-row terminal-host-row",
        )}
      >
        <div className="settings-collection-main terminal-host-identity">
          <Text
            as="p"
            size="secondary"
            tone="primary"
            weight="medium"
            leading="normal"
            className="settings-collection-title terminal-host-name"
          >
            <span>{name}</span>
            <Badge>
              {kind === "local"
                ? t("Local")
                : kind === "synced"
                  ? t("Local sync")
                  : t("Remote server")}
            </Badge>
          </Text>
          <Text as="p" leading="normal" className="settings-collection-meta">
            {missing
              ? t("The shell you picked is no longer installed, so the system default is used.")
              : effective
                ? `${effective.name} · ${effective.path}`
                : t("No shell detected yet")}
          </Text>
        </div>
        <Badge tone={status.tone} role="status">
          {status.label}
        </Badge>
        <div className="terminal-host-select">
          <SearchableSelect
            hideLabel
            label={selectLabel}
            disabled={disabled || loading || !listed}
            loading={loading}
            value={chosen && !missing ? chosen : ""}
            options={[
              {
                value: "",
                label: !listed
                  ? t("Not checked yet")
                  : systemDefault
                    ? t("Automatic ({p0})", { p0: systemDefault.name })
                    : t("Automatic"),
              },
              ...(listed?.profiles ?? []).map((profile) => ({
                value: profile.id,
                label: profile.name,
                description: profile.path,
              })),
            ]}
            onChange={onChoose}
          />
        </div>
        <div className="settings-collection-actions">
          <Button
            variant="ghost"
            iconOnly
            label={refreshLabel}
            loading={loading}
            disabled={refreshDisabled || loading}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden className="icon-sm" strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("Available shells on {p0}", { p0: name })}
            tooltip={t("Available shells")}
            aria-expanded={expanded}
            aria-controls={detailPanel}
            disabled={!listed || noShells}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronRight
              aria-hidden
              className={`icon-sm ${expanded ? "rotate-90" : ""}`}
              strokeWidth={1.75}
            />
          </Button>
        </div>
      </ActionHost>
      {feedback ? (
        <div className="settings-collection-feedback terminal-host-feedback">{feedback}</div>
      ) : null}
      {detailId ? (
        <span
          id={settingDomId(detailId)}
          data-setting-id={detailId}
          tabIndex={-1}
          className="terminal-host-detail-anchor"
        />
      ) : null}
      <div
        id={detailPanel}
        {...surfaceAttributes({ radius: "control", variant: "panel" }, "terminal-host-detail")}
        hidden={!expanded}
      >
        {expanded && listed ? (
          listed.profiles.length ? (
            <ul
              className="terminal-shell-list"
              aria-label={t("Available shells on {p0}", { p0: name })}
            >
              {listed.profiles.map((profile) => (
                <li key={profile.id} className="terminal-shell-item">
                  <div className="settings-collection-main">
                    <Text
                      as="p"
                      size="secondary"
                      tone="primary"
                      weight="medium"
                      leading="normal"
                      truncate
                      className="settings-collection-title"
                    >
                      {profile.name}
                    </Text>
                    <Text as="p" leading="normal" className="settings-collection-meta">
                      {profile.path}
                    </Text>
                  </div>
                  {profile.id === effectiveId ? (
                    <Badge>{t("Default")}</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={disabled || loading}
                      onClick={() => onChoose(profile.id)}
                    >
                      {t("Set as default")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              size="inline"
              className="settings-collection-empty"
              descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
              title={t("No shells found")}
              description={t(
                "Install PowerShell, Git for Windows or another shell, then look again.",
              )}
            />
          )
        ) : null}
      </div>
    </div>
  );
}

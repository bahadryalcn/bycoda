import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Text } from "../../../../shared/ui/Text";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";

import { Select } from "../../../../shared/ui/Select";
import { surfaceAttributes, Surface } from "../../../../shared/ui/Surface";
import { Switch } from "../../../../shared/ui/Switch";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import { StatusText } from "../common/StatusText";
import type { RemoteMachine } from "../../../connections/public/protocol";
import type { BrowserSettings as BrowserSettingsValue } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { LiveBrowserPanel } from "../browser/LiveBrowserPanel";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type BrowserSettingsProps = {
  client: SocialClient;
  accountId: string;
  accountName: string;
  /** A recognized screen waits for the owner: the live view is the way to help. */
  needsHuman: boolean;
  disabled: boolean;
};

/**
 * Browser options of one account: whether its window is visible, and whether it may use the
 * desktop of another computer while the owner is away. The live view shows the window on demand.
 */
export function BrowserSettings({
  client,
  accountId,
  accountName,
  needsHuman,
  disabled,
}: BrowserSettingsProps) {
  const [saved, setSaved] = useState<BrowserSettingsValue>();
  const [draft, setDraft] = useState<BrowserSettingsValue>();
  const [computers, setComputers] = useState<RemoteMachine[]>([]);
  const [loadError, setLoadError] = useState("");
  const [live, setLive] = useState(false);
  const { error, is, write } = useAccountWrite(
    t("The browser settings could not be saved. Try again."),
  );

  useEffect(() => {
    let alive = true;
    client.browser.settings.get(accountId).then(
      (value) => {
        if (!alive) return;
        setSaved(value);
        setDraft(value);
      },
      () => {
        if (alive) setLoadError(t("The browser settings could not be read. Try again."));
      },
    );
    invoke<RemoteMachine[]>("remote_machines").then(
      (list) => alive && setComputers(list),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [accountId, client]);

  if (!saved || !draft) {
    return (
      <section
        {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
        aria-label={t("Browser")}
      >
        {loadError ? (
          <InlineError>{loadError}</InlineError>
        ) : (
          <LoadingText delay={false} className="social-muted">
            {t("Loading…")}
          </LoadingText>
        )}
      </section>
    );
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const gate: ActionGate = disabled
    ? { disabled: true, disabledReason: t("Connect to this computer to change this account.") }
    : !changed
      ? { disabled: true, disabledReason: t("No changes to save.") }
      : draft.desktopControl.allowed && !draft.desktopControl.computerId
        ? { disabled: true, disabledReason: t("Choose the computer desktop control may use.") }
        : { disabled: false };

  const save = () =>
    void write("browser", () => client.browser.settings.set(draft))
      .then((result) => {
        if (result !== undefined) {
          setSaved(result);
          setDraft(result);
        }
      })
      .catch(() => undefined);

  return (
    <section
      {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
      aria-label={t("Browser")}
    >
      {needsHuman ? (
        <p className="social-field-row">
          <StatusText status="needs_human" />
          <Text as="span" tone="muted" leading="snug" className="social-muted">
            {t("Open the live view to finish the step that needs you.")}
          </Text>
        </p>
      ) : null}
      <div className="social-field-row">
        <Select
          hideLabel
          label={t("Browser window")}
          value={draft.visibility}
          disabled={disabled || is("browser")}
          options={[
            { value: "hidden", label: t("Hidden (recommended)") },
            { value: "visible", label: t("Visible on this computer") },
          ]}
          onValueChange={(visibility) =>
            setDraft({ ...draft, visibility: visibility as BrowserSettingsValue["visibility"] })
          }
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => setLive((value) => !value)}
        >
          {live ? t("Close live view") : t("Open live view")}
        </Button>
      </div>
      <Switch
        label={t("Allow desktop control")}
        checked={draft.desktopControl.allowed}
        disabled={disabled || is("browser")}
        onCheckedChange={(allowed) =>
          setDraft({ ...draft, desktopControl: { ...draft.desktopControl, allowed } })
        }
      />
      <Text as="p" tone="muted" leading="snug" className="social-card-description">
        {t("Desktop control runs only when you're away and on another computer.")}
      </Text>
      {draft.desktopControl.allowed ? (
        <Select
          hideLabel
          label={t("Computer for desktop control")}
          value={draft.desktopControl.computerId ?? ""}
          disabled={disabled || is("browser")}
          options={[
            { value: "", label: t("Choose a computer"), disabled: true },
            ...computers.map((machine) => ({ value: machine.id, label: machine.name })),
          ]}
          onValueChange={(computerId) =>
            setDraft({ ...draft, desktopControl: { allowed: true, computerId } })
          }
        />
      ) : null}
      <div className="social-field-row">
        <DisabledReason
          variant="primary"
          size="sm"
          loading={is("browser")}
          onClick={save}
          {...gateProps(gate)}
        >
          {t("Save browser settings")}
        </DisabledReason>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
      {live ? (
        <Surface
          variant="card"
          padding="sm"
          className="social-live-view"
          aria-label={t("Live view of {p1}", { p1: accountName })}
        >
          <LiveBrowserPanel client={client} accountId={accountId} onClose={() => setLive(false)} />
        </Surface>
      ) : null}
    </section>
  );
}

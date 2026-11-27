import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";

import { Select } from "../../../../shared/ui/Select";
import { surfaceAttributes, Surface } from "../../../../shared/ui/Surface";
import { Switch } from "../../../../shared/ui/Switch";
import { StatusText } from "../common/StatusText";
import type { RemoteMachine } from "../../../connections/public/protocol";
import type { BrowserSettings as BrowserSettingsValue } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { LiveBrowserPanel } from "../browser/LiveBrowserPanel";
import { errorText } from "../../../../shared/lib/errors";
import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { accountBlockedReason } from "./blockedReason";
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
  const [loadError, setLoadError] = useState<{ details: string } | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  const { failureTitle, details, is, write } = useAccountWrite(
    t("The browser settings could not be saved. Try again."),
  );

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reads this account's browser settings and the linked computers from the Host/Tauri; both are external, and `alive` drops a read that finishes after the account changed.
  useEffect(() => {
    let alive = true;
    client.browser.settings.get(accountId).then(
      (value) => {
        if (!alive) return;
        setLoadError(undefined);
        setSaved(value);
        setDraft(value);
      },
      (cause: unknown) => {
        if (alive)
          setLoadError({
            details: presentRemoteError(cause, { explicit: true }) || errorText(cause),
          });
      },
    );
    invoke<RemoteMachine[]>("remote_machines").then(
      (list) => alive && setComputers(list),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [accountId, client, attempt]);

  if (!saved || !draft) {
    return (
      <section
        {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "social-card")}
        aria-label={t("Browser")}
      >
        {loadError ? (
          <InlineError
            details={loadError.details}
            retry={{ onRetry: () => setAttempt((value) => value + 1) }}
          >
            {t("The browser settings could not be read. Try again.")}
          </InlineError>
        ) : (
          <LoadingText delay={false} className="social-muted">
            {t("Loading…")}
          </LoadingText>
        )}
      </section>
    );
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  // Nothing to save is obvious from the untouched form, so only real prerequisites are explained.
  const blockedReason = disabled
    ? t("Connect to this computer to change this account.")
    : changed && draft.desktopControl.allowed && !draft.desktopControl.computerId
      ? t("Choose the computer desktop control may use.")
      : undefined;

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
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "social-card")}
      aria-label={t("Browser")}
    >
      {needsHuman ? (
        <div className="social-field-row">
          <StatusText status="needs_human" />
        </div>
      ) : null}
      <div className="social-field-row">
        <Select
          label={t("Browser window")}
          value={draft.visibility}
          disabled={disabled || is("browser")}
          options={[
            { value: "hidden", label: t("Hidden (recommended)") },
            { value: "visible", label: t("Visible on this computer") },
          ]}
          onValueChange={(visibility) =>
            setDraft({
              ...draft,
              visibility: visibility as BrowserSettingsValue["visibility"],
            })
          }
        />
      </div>
      <div className="social-field-row">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          disabledReason={accountBlockedReason(disabled)}
          onClick={() => setLive((value) => !value)}
        >
          {live ? t("Close live view") : t("Open live view")}
        </Button>
      </div>
      <div className="social-card-head">
        <Switch
          label={t("Allow desktop control")}
          checked={draft.desktopControl.allowed}
          disabled={disabled || is("browser")}
          onCheckedChange={(allowed) =>
            setDraft({
              ...draft,
              desktopControl: { ...draft.desktopControl, allowed },
            })
          }
        />
        <InfoPopover className="shrink-0">
          {t("Desktop control runs only when you're away and on another computer.")}
        </InfoPopover>
      </div>
      {draft.desktopControl.allowed ? (
        <Select
          label={t("Computer for desktop control")}
          value={draft.desktopControl.computerId ?? ""}
          disabled={disabled || is("browser")}
          options={[
            computers.length === 0
              ? {
                  value: "",
                  label: t("No other computer is linked"),
                  disabled: true,
                }
              : { value: "", label: t("Choose a computer"), disabled: true },
            ...computers.map((machine) => ({
              value: machine.id,
              label: machine.name,
            })),
          ]}
          onValueChange={(computerId) =>
            setDraft({
              ...draft,
              desktopControl: { allowed: true, computerId },
            })
          }
        />
      ) : null}
      <div className="social-field-row">
        <Button
          variant="primary"
          size="sm"
          loading={is("browser")}
          onClick={save}
          disabled={!changed || !!blockedReason}
          disabledReason={blockedReason}
        >
          {t("Save browser settings")}
        </Button>
      </div>
      {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
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

import { Text } from "../../../shared/ui/Text";
import type { RefObject } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { Popover } from "../../../shared/ui/Popover";
import { TextField } from "../../../shared/ui/TextField";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import {
  ChevronDown,
  ChevronUp,
  CircleDot,
  CornerDownRight,
  Eye,
  ArrowRight,
  Keyboard,
  Pause,
  Play,
} from "../../../shared/ui/icons";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { ButtonGroup } from "../../../shared/ui/ButtonGroup";

type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type Action = (work: () => Promise<unknown>) => Promise<unknown>;

type ControlState = {
  open: boolean;
  url: string | null;
  controlling: boolean;
  viewport?: { width: number; height: number };
  runtime?: { installed?: boolean; installing?: boolean };
};

/** Live viewing is separate from control ownership and page input. */
export function BrowserLiveToggle({
  live,
  open,
  busy,
  selecting,
  onToggle,
}: {
  live: boolean;
  open: boolean;
  busy: boolean;
  selecting: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      iconOnly
      label={t("Live view")}
      tooltip={live ? t("Pause live view") : t("Resume live view")}
      pressed={live}
      disabled={busy || !open || selecting}
      disabledReason={selecting ? t("Cancel selection") : undefined}
      onClick={onToggle}
    >
      {live ? <Pause className="icon-sm" aria-hidden /> : <Play className="icon-sm" aria-hidden />}
    </Button>
  );
}

/** Controlled address draft and navigation availability inside the browser form. */
export function BrowserAddressInput({
  url,
  busy,
  selecting,
  setupRequired,
  validUrl,
  searchEnabled,
  onChange,
}: {
  url: string;
  busy: boolean;
  selecting: boolean;
  setupRequired: boolean;
  validUrl: boolean;
  searchEnabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <TextField
        fieldClassName="host-browser-url"
        label={t("Website address")}
        hideLabel
        value={url}
        maxLength={4096}
        disabled={busy || selecting}
        onChange={(event) => onChange(event.target.value)}
        placeholder="http://localhost:3000"
        required
      />
      <Button
        motion="none"
        type="submit"
        variant="ghost"
        iconOnly
        label={t("Open website")}
        disabled={busy || selecting || setupRequired || !validUrl}
        disabledReason={
          selecting
            ? t("Cancel selection")
            : setupRequired
              ? t("Browser setup required")
              : !url.trim()
                ? undefined
                : searchEnabled
                  ? undefined
                  : t("Use an HTTP or HTTPS address.")
        }
      >
        <ArrowRight className="icon-sm" aria-hidden />
      </Button>
    </>
  );
}

/** One labelled toggle: view-only claims control, an active lease releases it. */
export function BrowserControlToggle({
  controlling,
  busy,
  action,
  request,
}: {
  controlling: boolean;
  busy: boolean;
  action: Action;
  request: Request;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      shape="pill"
      className="host-browser-control-toggle"
      textTone="secondary"
      data-controlling={controlling}
      startIcon={
        controlling ? (
          <CircleDot className="icon-sm" tone="success" aria-hidden />
        ) : (
          <Eye className="icon-sm" aria-hidden />
        )
      }
      tooltip={controlling ? t("Release") : t("Claim control")}
      disabled={busy}
      onClick={() =>
        void action(() =>
          request(
            controlling ? "browser.release" : "browser.claim",
            controlling ? {} : { takeover: true },
          ),
        ).catch(() => {})
      }
    >
      {controlling ? t("Control active") : t("View only")}
    </Button>
  );
}

export function BrowserControlsPopover({
  anchor,
  align,
  onDismiss,
  state,
  busy,
  selecting,
  canInput,
  canPageInput,
  inputDisabledReason,
  setupRequired,
  annotationsAllowed,
  text,
  setText,
  browserStatus,
  notice,
  error,
  errorSummary,
  action,
  request,
  input,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  align: "start" | "end";
  onDismiss: (reason: string) => void;
  state: ControlState | undefined;
  busy: boolean;
  selecting: boolean;
  canInput: boolean;
  canPageInput: boolean;
  inputDisabledReason?: string;
  setupRequired: boolean;
  annotationsAllowed: boolean;
  text: string;
  setText: (value: string) => void;
  browserStatus: string;
  notice: string;
  error: string;
  errorSummary: string;
  action: Action;
  request: Request;
  input: (params: Record<string, unknown>, onSuccess?: () => void) => Promise<unknown>;
}) {
  // `action` reports failures in the panel; the handler only marks the promise as observed.
  const run = (work: () => Promise<unknown>) => void action(work).catch(() => {});
  return (
    <Popover
      anchor={anchor}
      side="bottom"
      align={align}
      width={320}
      kind="dialog"
      aria-label={t("Browser controls and setup")}
      data-dialog-popover
      className="host-browser-controls"
      variant="panel"
      onDismiss={onDismiss}
    >
      <section className="host-browser-control-section" aria-label={t("Session")}>
        <Text size="caption" weight="medium">
          {state?.controlling ? t("Control active") : t("View only")}
          {browserStatus ? ` · ${browserStatus}` : ""}
        </Text>
        {state?.url ? (
          <OverflowTooltip label={state.url}>
            <Text
              as="span"
              size="caption"
              tone="secondary"
              leading="inherit"
              truncate
              className="host-browser-location"
            >
              {state.url}
            </Text>
          </OverflowTooltip>
        ) : null}
        {notice ? (
          <Text size="caption" tone="secondary">
            {notice}
          </Text>
        ) : null}
        <div className="host-tool-actions">
          <Button
            motion="none"
            type="button"
            variant={state?.controlling ? "ghost" : "secondary"}
            size="sm"
            loading={busy}
            disabled={busy}
            onClick={() => run(() => request("browser.claim", { takeover: true }))}
          >
            {state?.controlling ? t("Renew control") : t("Claim control")}
          </Button>
          {state?.controlling && !state.open ? (
            <Button
              motion="none"
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run(() => request("browser.release"))}
            >
              {t("Release")}
            </Button>
          ) : null}
          <InfoPopover label={t("About the host browser")}>
            <p>
              {t(
                "Temporary Chromium runs on the selected machine. Authenticated devices share its view; one device controls it for 30 seconds. Setup runs only when requested.",
              )}
            </p>
            {!annotationsAllowed ? (
              <p>
                {t("Browser selections can be attached only on this conversation's project host.")}
              </p>
            ) : null}
          </InfoPopover>
        </div>
      </section>
      <section
        className="host-browser-control-section"
        aria-label={t("Keyboard and scroll controls")}
      >
        <form
          className="host-browser-type"
          onSubmit={(event) => {
            event.preventDefault();
            if (canPageInput && text) run(() => input({ kind: "text", text }, () => setText("")));
          }}
        >
          <TextField
            fieldClassName="host-tool-grow"
            label={t("Text to type into host browser")}
            hideLabel
            placeholder={t("Type text")}
            value={text}
            maxLength={4096}
            disabled={!canPageInput}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            motion="none"
            type="submit"
            variant="ghost"
            iconOnly
            label={t("Type text")}
            disabled={!canPageInput || !text}
            disabledReason={inputDisabledReason}
          >
            <Keyboard className="icon-sm" aria-hidden />
          </Button>
        </form>
        <ButtonGroup aria-label={t("Keyboard and scroll controls")} surface="transparent">
          <Button
            motion="none"
            type="button"
            variant="ghost"
            size="sm"
            label={t("Enter")}
            disabled={!canPageInput}
            disabledReason={inputDisabledReason}
            onClick={() => run(() => input({ kind: "key", key: "Enter" }))}
          >
            <CornerDownRight className="icon-sm" aria-hidden />
            {t("Enter")}
          </Button>
          <Button
            motion="none"
            type="button"
            variant="ghost"
            size="sm"
            label={t("Scroll up")}
            disabled={!canPageInput}
            disabledReason={inputDisabledReason}
            onClick={() => run(() => input({ kind: "scroll", y: -500 }))}
          >
            <ChevronUp className="icon-sm" aria-hidden />
            {t("Scroll up")}
          </Button>
          <Button
            motion="none"
            type="button"
            variant="ghost"
            size="sm"
            label={t("Scroll down")}
            disabled={!canPageInput}
            disabledReason={inputDisabledReason}
            onClick={() => run(() => input({ kind: "scroll", y: 500 }))}
          >
            <ChevronDown className="icon-sm" aria-hidden />
            {t("Scroll down")}
          </Button>
        </ButtonGroup>
      </section>
      {error ? <InlineError details={error}>{errorSummary}</InlineError> : null}
      <section className="host-browser-control-section" aria-label={t("Browser")}>
        <div className="host-tool-actions">
          {!state && error ? (
            <Button
              motion="none"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run(() => request("browser.status"))}
            >
              {t("Retry")}
            </Button>
          ) : null}
          {state?.open ? (
            <Button
              motion="none"
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canInput}
              tone="danger"
              disabledReason={inputDisabledReason}
              tooltip={t("Close the shared browser on this computer.")}
              onClick={() => run(() => request("browser.close"))}
            >
              {t("Close browser")}
            </Button>
          ) : null}
          {!setupRequired && !state?.runtime?.installed ? (
            <Button
              motion="none"
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || selecting || state?.runtime?.installing}
              onClick={() => run(() => request("browser.setup"))}
            >
              {t("Set up host browser")}
            </Button>
          ) : null}
        </div>
      </section>
    </Popover>
  );
}

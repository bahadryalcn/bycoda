import type { RefObject } from "react";
import { t } from "../../../shared/i18n/technical";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { DetailedInlineError } from "../../../shared/ui/ErrorDetails";
import { Popover } from "../../../shared/ui/Popover";
import { TextField } from "../../../shared/ui/TextField";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import {
  ChevronDown,
  ChevronUp,
  CircleDot,
  CornerDownRight,
  Eye,
  Keyboard,
} from "../../../shared/ui/icons";
import { Disclosure } from "../../../shared/ui/Disclosure";

type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type Action = (work: () => Promise<unknown>) => Promise<unknown>;

type ControlState = {
  open: boolean;
  url: string | null;
  controlling: boolean;
  runtime?: { installed?: boolean; installing?: boolean };
};

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
      data-controlling={controlling}
      startIcon={
        controlling ? (
          <CircleDot className="icon-sm" aria-hidden />
        ) : (
          <Eye className="icon-sm" aria-hidden />
        )
      }
      tooltip={controlling ? t("Release") : t("Claim control")}
      tooltipDetails={[
        controlling
          ? t("Control active · 30 seconds after each action")
          : t("View only · take control to interact"),
      ]}
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
      role="dialog"
      aria-label={t("Browser controls and setup")}
      data-dialog-popover
      className="host-browser-controls font-sans"
      solid
      onDismiss={onDismiss}
    >
      <div className="host-browser-state" role="status">
        <span className="host-tool-status">
          {[
            browserStatus,
            state?.open ? (state.controlling ? t("Control active") : t("View only")) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {state?.url ? (
          <OverflowTooltip label={state.url}>
            <span className="host-browser-location">{state.url}</span>
          </OverflowTooltip>
        ) : null}
        {notice ? <span className="host-tool-muted">{notice}</span> : null}
      </div>
      <section className="host-browser-side-section" aria-label={t("Keyboard and scroll controls")}>
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
          >
            <Keyboard className="icon-sm" aria-hidden />
          </Button>
          <Button
            motion="none"
            type="button"
            variant="ghost"
            iconOnly
            label={t("Enter")}
            disabled={!canPageInput}
            onClick={() => run(() => input({ kind: "key", key: "Enter" }))}
          >
            <CornerDownRight className="icon-sm" aria-hidden />
          </Button>
          <Button
            motion="none"
            type="button"
            variant="ghost"
            iconOnly
            label={t("Scroll up")}
            disabled={!canPageInput}
            onClick={() => run(() => input({ kind: "scroll", y: -500 }))}
          >
            <ChevronUp className="icon-sm" aria-hidden />
          </Button>
          <Button
            motion="none"
            type="button"
            variant="ghost"
            iconOnly
            label={t("Scroll down")}
            disabled={!canPageInput}
            onClick={() => run(() => input({ kind: "scroll", y: 500 }))}
          >
            <ChevronDown className="icon-sm" aria-hidden />
          </Button>
        </form>
        {state?.open && !state.controlling ? (
          <p className="host-tool-muted">{t("View only · take control to interact")}</p>
        ) : null}
      </section>
      {error ? <DetailedInlineError summary={errorSummary} error={error} /> : null}
      {busy ? <Alert tone="info">{t("Working on the host…")}</Alert> : null}
      <div className="host-tool-actions">
        <Button
          motion="none"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => run(() => request("browser.status"))}
        >
          {!state && error ? t("Retry") : t("Status")}
        </Button>
        {!(state?.open && !state.controlling) ? (
          <Button
            motion="none"
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => run(() => request("browser.claim", { takeover: true }))}
          >
            {state?.controlling ? t("Renew control") : t("Claim control")}
          </Button>
        ) : null}
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
        {state?.open ? (
          <Button
            motion="none"
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canInput}
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
      <Disclosure summary={t("Help")} size="sm">
        <p>
          {t(
            "Enter a website address and open it on this computer. Click the preview to interact, or select an element to discuss with your agent.",
          )}
        </p>
        {!annotationsAllowed ? (
          <p>{t("Browser selections can be attached only on this conversation's project host.")}</p>
        ) : null}
        <p>
          {t(
            "Temporary Chromium runs on the selected machine. Authenticated devices share its view; one device controls it for 30 seconds. Setup runs only when requested.",
          )}
        </p>
      </Disclosure>
    </Popover>
  );
}

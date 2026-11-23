import type { RefObject } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { ArrowRight, Pause, Play } from "../../../shared/ui/icons";

/** Pauses the image stream while keeping the page available. */
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
      disabledReason={
        busy ? t("Working on the host…") : selecting ? t("Cancel selection") : t("Open a website")
      }
      onClick={onToggle}
    >
      {live ? <Pause className="icon-sm" aria-hidden /> : <Play className="icon-sm" aria-hidden />}
    </Button>
  );
}

/** Controlled address draft and navigation availability inside the browser form. */
export function BrowserAddressInput({
  inputRef,
  url,
  busy,
  selecting,
  setupRequired,
  validUrl,
  searchEnabled,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
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
        ref={inputRef}
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
          busy
            ? t("Working on the host…")
            : selecting
              ? t("Cancel selection")
              : setupRequired
                ? t("Browser setup required")
                : searchEnabled
                  ? t("Enter a website address or search term.")
                  : t("Use an HTTP or HTTPS address.")
        }
      >
        <ArrowRight className="icon-sm" aria-hidden />
      </Button>
    </>
  );
}

import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { useLiveBrowserView, type LiveBrowserViewStatus } from "../../hooks/useLiveBrowserView";
import type { BrowserViewInput } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";

export type LiveBrowserPanelProps = {
  client: SocialClient;
  accountId: string;
  /** Closing the panel only hides the view. The browser keeps running. */
  onClose(): void;
};

/** Live view of one account's hidden browser window. The owner clicks, types and presses keys here. */
export function LiveBrowserPanel({ client, accountId, onClose }: LiveBrowserPanelProps) {
  const { frame, status, retry, markError } = useLiveBrowserView(client, accountId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const send = async (event: BrowserViewInput): Promise<boolean> => {
    setBusy(true);
    try {
      await client.browserViewInput(accountId, event);
      return true;
    } catch {
      markError(client, accountId);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendInput = (event: BrowserViewInput) => {
    void send(event).catch(() => markError(client, accountId));
  };

  // detail 0 is a keyboard or assistive activation: it has no pointer position, so it sends no click.
  // Enter and Tab stay available as keyboard controls.
  const onImageClick = (event: MouseEvent<HTMLButtonElement>) => {
    const image = imageRef.current;
    if (!frame || !image || event.detail === 0) return;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * frame.width);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * frame.height);
    sendInput({ type: "click", x, y });
  };

  const submitText = async (event: FormEvent) => {
    event.preventDefault();
    if (!text) return;
    if (await send({ type: "type", text })) setText("");
  };

  const message: Record<LiveBrowserViewStatus, string> = {
    connecting: t("Connecting to the browser window…"),
    live: t("Live. Click the page to interact."),
    waiting: t("Waiting for the browser window to start."),
    error: t("The live view is unavailable. Try again."),
  };

  return (
    <section aria-label={t("Live browser view")} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Heading size="item">{t("Browser window")}</Heading>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("Close view")}
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {status === "live" ? (
          <InfoPopover className="shrink-0">{message.live}</InfoPopover>
        ) : (
          <Text as="p" tone={status === "error" ? "danger" : "secondary"}>
            {message[status]}
          </Text>
        )}
        {status === "error" ? (
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            {t("Retry")}
          </Button>
        ) : null}
      </div>
      {frame ? (
        <Button variant="item" layout="media" type="button" onClick={onImageClick}>
          <img
            ref={imageRef}
            src={`data:image/jpeg;base64,${frame.jpegBase64}`}
            alt={t("Live view of the browser window")}
            width={frame.width}
            height={frame.height}
            className="max-w-full h-auto"
          />
        </Button>
      ) : null}
      <form onSubmit={submitText} autoComplete="off" className="flex min-w-0 flex-col gap-2">
        <TextField
          label={t("Text to type")}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || text.length === 0}>
            {t("Type")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => sendInput({ type: "key", key: "Enter" })}
          >
            {t("Enter")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => sendInput({ type: "key", key: "Tab" })}
          >
            {t("Tab")}
          </Button>
        </div>
      </form>
    </section>
  );
}

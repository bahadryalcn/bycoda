import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { Tooltip } from "../../../../shared/ui/Tooltip";
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
  const { frame, status, details, retry, markError } = useLiveBrowserView(client, accountId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const send = async (event: BrowserViewInput): Promise<boolean> => {
    setBusy(true);
    try {
      await client.browserViewInput(accountId, event);
      return true;
    } catch (cause) {
      markError(client, accountId, cause);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendInput = (event: BrowserViewInput) => {
    void send(event).catch((cause: unknown) => markError(client, accountId, cause));
  };

  // A keyboard or assistive activation (detail 0) has no pointer position, so it clicks the center
  // of the page. Pointer clicks map to the frame's own pixels.
  const onImageClick = (event: MouseEvent<HTMLButtonElement>) => {
    const image = imageRef.current;
    if (!frame || !image) return;
    if (event.detail === 0) {
      sendInput({
        type: "click",
        x: Math.round(frame.width / 2),
        y: Math.round(frame.height / 2),
      });
      return;
    }
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

  const message: Record<Exclude<LiveBrowserViewStatus, "error">, string> = {
    connecting: t("Connecting to the browser window…"),
    live: t("Live. Click the page to interact."),
    waiting: t("Waiting for the browser window to start."),
  };

  return (
    <section aria-label={t("Live browser view")} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Heading size="item">{t("Browser window")}</Heading>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("Close view")}
        </Button>
      </header>
      {status === "error" ? (
        <InlineError details={details} retry={{ onRetry: retry }}>
          {t("The live view is unavailable.")}
        </InlineError>
      ) : status !== "live" ? (
        <Text as="p" tone="secondary">
          {message[status]}
        </Text>
      ) : null}
      {frame ? (
        <Tooltip asChild label={message.live}>
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
        </Tooltip>
      ) : null}
      <form onSubmit={submitText} autoComplete="off" className="flex min-w-0 flex-col gap-2">
        <TextField
          label={t("Text to type")}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !text.length}>
            {t("Type into the page")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => sendInput({ type: "key", key: "Enter" })}
          >
            {t("Press Enter")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => sendInput({ type: "key", key: "Tab" })}
          >
            {t("Press Tab")}
          </Button>
        </div>
      </form>
    </section>
  );
}

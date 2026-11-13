import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import type { BrowserViewFrame, BrowserViewInput } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";

/** Frames are requested about twice a second; the Host stops the screencast when requests stop. */
const POLL_MS = 700;

export type LiveBrowserPanelProps = {
  client: SocialClient;
  accountId: string;
  /** Closing the panel only hides the view. The browser keeps running. */
  onClose(): void;
};

type Status = "connecting" | "live" | "waiting" | "error";

/** Live view of one account's hidden browser window. The owner clicks, types and presses keys here. */
export function LiveBrowserPanel({ client, accountId, onClose }: LiveBrowserPanelProps) {
  const [frame, setFrame] = useState<BrowserViewFrame | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await client.browserViewFrame(accountId);
        if (cancelled) return;
        if (next) {
          setFrame(next);
          setStatus("live");
        } else {
          setStatus("waiting");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick().catch(() => setStatus("error"));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, accountId]);

  const send = async (event: BrowserViewInput): Promise<boolean> => {
    setBusy(true);
    try {
      await client.browserViewInput(accountId, event);
      return true;
    } catch {
      setStatus("error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendInput = (event: BrowserViewInput) => {
    void send(event).catch(() => setStatus("error"));
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

  const message: Record<Status, string> = {
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
      <Text as="p" tone={status === "error" ? "danger" : "secondary"}>
        {message[status]}
      </Text>
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

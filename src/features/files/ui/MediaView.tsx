import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { basename, openPathWithDefaultApp, prepareLocalFile } from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/technical";
import { mediaKind } from "../model/mediaPreview";
import { DocumentMessage } from "./DocumentMessage";
import { formatFileSize } from "../model/filePreview";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";

type Props = {
  path: string;
  active?: boolean;
  readBytes?: () => Promise<Uint8Array>;
  mimeType?: string;
  externalPath?: string | null;
};
type State =
  | { status: "loading"; received?: number; total?: number }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };
const BUTTON =
  "rounded-md border border-stroke px-2.5 py-1 text-xs text-content/80 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-content/10 active:bg-content/15 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

/** Native controls stream authorized local/cache files without loading video into the JS heap. */
export function MediaView({
  path,
  active = true,
  readBytes,
  mimeType,
  externalPath = path,
}: Props) {
  useLocale();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<string>();
  const player = useRef<HTMLMediaElement | null>(null);
  const generation = useRef(0);
  const localCopy = !!externalPath?.startsWith("remote://") && !localExplorerPath(externalPath);
  useEffect(() => {
    if (!active) {
      setState({ status: "loading" });
      return;
    }
    const controller = new AbortController();
    const request = ++generation.current;
    let ownedUrl: string | undefined;
    setState({ status: "loading" });
    setActionError(undefined);
    void (async () => {
      try {
        let url: string;
        if (readBytes) {
          const bytes = await readBytes();
          if (controller.signal.aborted) return;
          const type = /^(audio|video)\/[a-z0-9.+-]+$/i.test(mimeType ?? "") ? mimeType : undefined;
          ownedUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
          url = ownedUrl;
        } else {
          const local = await prepareLocalFile(path, {
            signal: controller.signal,
            onProgress: (received, total) => {
              if (!controller.signal.aborted) setState({ status: "loading", received, total });
            },
          });
          if (controller.signal.aborted) return;
          url = convertFileSrc(local);
        }
        if (request === generation.current) setState({ status: "ready", url });
      } catch (reason) {
        if (!controller.signal.aborted) setState({ status: "error", message: String(reason) });
      }
    })();
    return () => {
      controller.abort();
      generation.current++;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [path, readBytes, mimeType, retry, active]);

  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);
  const failPlayback = () =>
    setState({
      status: "error",
      message: t("This media format could not be played. Open it in the default app."),
    });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-3">
        {state.status === "ready" ? (
          mediaKind(path) === "audio" ? (
            <audio
              ref={(element) => {
                player.current = element;
              }}
              aria-label={basename(path)}
              src={state.url}
              controls
              preload="metadata"
              onError={failPlayback}
              className="w-full max-w-xl"
            />
          ) : (
            <video
              ref={(element) => {
                player.current = element;
              }}
              aria-label={basename(path)}
              src={state.url}
              controls
              playsInline
              preload="metadata"
              onError={failPlayback}
              className="max-h-full w-full object-contain"
            />
          )
        ) : state.status === "error" ? (
          <DocumentMessage title={t("Couldn’t open {p0}", { p0: basename(path) })} error>
            <span role="alert">{state.message}</span>
            <button type="button" onClick={() => setRetry((value) => value + 1)} className={BUTTON}>
              {t("Retry")}
            </button>
          </DocumentMessage>
        ) : (
          <p role="status" className="text-sm text-content/60">
            {t("Loading…")}
            {state.total
              ? ` ${formatFileSize(state.received ?? 0)} / ${formatFileSize(state.total)}`
              : ""}
          </p>
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-stroke px-3 py-2 text-xs text-content/60">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {basename(path)}
        </span>
        {externalPath ? (
          <button
            type="button"
            className={BUTTON}
            title={
              localCopy
                ? t("Changes to this local copy are not saved to the connected machine.")
                : undefined
            }
            onClick={() => {
              const request = generation.current;
              setActionError(undefined);
              void openPathWithDefaultApp(externalPath).catch((reason: unknown) => {
                if (request === generation.current) setActionError(String(reason));
              });
            }}
          >
            {t(localCopy ? "Open local copy" : "Open in default app")}
          </button>
        ) : null}
        {actionError ? (
          <span role="alert" className="basis-full text-danger">
            {actionError}
          </span>
        ) : null}
      </footer>
    </div>
  );
}

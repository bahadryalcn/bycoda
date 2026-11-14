import { lazy, Suspense, useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import {
  fetchInboxMedia,
  invalidateInboxMedia,
  sniffInboxMedia,
  type InboxMediaType,
} from "../model/inboxMedia";

const PdfViewer = lazy(() => import("../../files/public/PdfViewer"));

type Props = { src: string; alt?: string };
type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string; type: InboxMediaType; bytes: Uint8Array<ArrayBuffer> }
  | { status: "unsupported" }
  | { status: "error" };

export function InboxMedia(props: Props) {
  return <InboxMediaContent key={props.src} {...props} />;
}

function InboxMediaContent({ src, alt }: Props) {
  useLocale();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const label = alt?.trim() || src;

  // Load authenticated bytes through the owning native route; retire blobs and stale responses.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });
    void fetchInboxMedia(src)
      .then((bytes) => {
        if (cancelled) return;
        const type = sniffInboxMedia(bytes);
        if (!type) {
          setState({ status: "unsupported" });
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
        setState({ status: "ready", url: objectUrl, type, bytes });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, attempt]);

  const ready = state.status === "ready" ? state : null;
  const retry = () => {
    invalidateInboxMedia(src);
    setAttempt((value) => value + 1);
  };
  return (
    <>
      {ready?.type.kind === "video" ? (
        <span className="inbox-media my-2 inline-block w-full max-w-xl">
          <video
            src={ready.url}
            controls
            playsInline
            preload="metadata"
            className="block max-h-[28rem] w-full"
            onError={() => setState({ status: "error" })}
          />
        </span>
      ) : ready?.type.kind === "image" ? (
        <Button
          variant="ghost"
          controlHeight="content"
          frame="preview"
          aria-label={label}
          onClick={() => setExpanded(true)}
          className="inbox-media my-2 w-full max-w-xl"
        >
          <img
            src={ready.url}
            alt={alt ?? ""}
            draggable={false}
            className="block max-h-[28rem] w-full object-contain"
            onError={() => setState({ status: "error" })}
          />
        </Button>
      ) : (
        <Button
          variant="link"
          loading={state.status === "loading"}
          onClick={() => setExpanded(true)}
        >
          {label}
        </Button>
      )}
      {expanded && ready?.type.kind === "image" ? (
        <ImageLightbox
          src={ready.url}
          alt={label}
          onClose={() => setExpanded(false)}
          onImageError={() => setState({ status: "error" })}
        />
      ) : expanded ? (
        <Modal
          title={label}
          size="lg"
          fitViewport
          onClose={() => setExpanded(false)}
          footer={
            <ModalActions>
              {state.status === "error" ||
              state.status === "unsupported" ||
              ready?.type.kind === "pdf" ? (
                <Button onClick={retry}>{t("Retry")}</Button>
              ) : null}
              <Button variant="secondary" onClick={() => openUrlSafely(src)}>
                {t("Open in browser")}
              </Button>
            </ModalActions>
          }
        >
          {state.status === "loading" ? (
            <LoadingText />
          ) : state.status === "error" ? (
            <Alert tone="danger">{t("Preview unavailable")}</Alert>
          ) : ready?.type.kind === "pdf" ? (
            <Suspense fallback={<LoadingText />}>
              <PdfViewer bytes={ready.bytes} />
            </Suspense>
          ) : (
            <EmptyState size="inline" kind="empty" description={t("Preview unavailable")} />
          )}
        </Modal>
      ) : null}
    </>
  );
}

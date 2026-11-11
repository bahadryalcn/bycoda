import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { Button } from "../../../shared/ui/Button";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { fetchInboxMedia, sniffInboxMedia, type InboxMediaType } from "../model/inboxMedia";

type Props = {
  src: string;
  alt?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string; type: InboxMediaType }
  | { status: "error" };

export function InboxMedia({ src, alt }: Props) {
  useLocale();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });

    void fetchInboxMedia(src)
      .then((bytes) => {
        const type = sniffInboxMedia(bytes);
        if (!type) throw new Error("unsupported");
        const url = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({ status: "ready", url, type });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (state.status === "loading") {
    return (
      <span
        className="inbox-media my-2 inline-flex h-32 w-full max-w-xl items-center justify-center rounded-(--ui-radius-card) border border-(--ui-card-border) bg-transparent"
        aria-hidden
      >
        <Skeleton inline aria-hidden width="40%" />
      </span>
    );
  }

  if (state.status === "error") {
    return <MediaFallback src={src} alt={alt} />;
  }

  if (state.type.kind === "video") {
    return (
      <span className="inbox-media my-2 inline-block w-full max-w-xl overflow-hidden rounded-(--ui-radius-card) border border-(--ui-card-border) bg-transparent">
        <video
          src={state.url}
          controls
          playsInline
          preload="metadata"
          className="block max-h-[28rem] w-full bg-scrim"
        >
          <MediaFallback src={src} alt={alt} />
        </video>
      </span>
    );
  }

  const label = alt?.trim() || t("Image");
  return (
    <img
      src={state.url}
      alt={alt ?? ""}
      title={label}
      draggable={false}
      className="inbox-media my-2 inline-block max-h-[28rem] w-full max-w-xl cursor-zoom-in rounded-(--ui-radius-card) border border-(--ui-card-border) bg-transparent object-contain"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openUrlSafely(src);
      }}
    />
  );
}

function MediaFallback({ src, alt }: { src: string; alt?: string }) {
  const label = alt?.trim() || src;
  return (
    <Button variant="link" onClick={() => openUrlSafely(src)}>
      {label}
    </Button>
  );
}

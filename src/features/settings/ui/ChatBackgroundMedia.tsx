import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";
import { useDecorativeMotionEnabled, useSystemReducedMotion } from "../model/decorativeMotion";
import { t } from "../../../shared/i18n";

type BackgroundMediaProps = {
  path: string | null;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** Decorative media only. Each selection owns its failures and native resources. */
export function ChatBackgroundMedia(props: BackgroundMediaProps) {
  return props.path ? <BackgroundMedia key={props.path} {...props} /> : null;
}

function BackgroundMedia({ path, active = true, className = "", style }: BackgroundMediaProps) {
  const motion = useDecorativeMotionEnabled();
  const reduced = useSystemReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const videoElement = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(document.visibilityState !== "hidden");
  const [frame, setFrame] = useState<{ path: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const kind = chatBackgroundKind(path);
  const running = active && motion && !reduced && visible && pageVisible;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Observe DOM intersection and document visibility while this decorative layer is mounted.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    const visibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Release the detached video's decoder and source immediately on failure, hiding or selection change.
  useEffect(() => {
    const video = videoElement.current;
    if (!video) return;
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [running, path, failed]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Hold one native preview token while this visible scene is active; fence late replies and close on teardown.
  useEffect(() => {
    if (!running || !path || kind !== "html" || failed === path) return;
    let disposed = false;
    const token = crypto.randomUUID();
    const close = () => {
      void invoke("close_html_preview", { token }).catch(console.error);
    };
    const timeout = window.setTimeout(() => {
      disposed = true;
      setFailed(path);
      close();
    }, 10_000);
    void invoke<string>("read_chat_background_html", { path })
      .then((content) => {
        if (disposed) return null;
        return invoke<string>("create_html_preview", {
          token,
          path: "background://scene.html",
          content,
        });
      })
      .then((id) => {
        clearTimeout(timeout);
        if (disposed) {
          close();
          return;
        }
        if (id) setFrame({ path, url: `${convertFileSrc(id, "html-preview")}/index.html` });
      })
      .catch(() => {
        clearTimeout(timeout);
        if (!disposed) setFailed(path);
        close();
      });
    return () => {
      disposed = true;
      clearTimeout(timeout);
      setFrame(null);
      close();
    };
  }, [path, kind, running, failed]);

  return (
    <div
      ref={container}
      className={`chat-background-media ${className}`}
      style={style}
      aria-hidden="true"
      inert
    >
      {path && failed !== path && running ? (
        kind === "video" ? (
          <video
            ref={videoElement}
            key={path}
            src={convertFileSrc(path)}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setFailed(path)}
            tabIndex={-1}
          />
        ) : kind === "html" && frame?.path === path ? (
          <iframe
            title={t("Chat background")}
            src={frame.url}
            sandbox="allow-scripts"
            allow="microphone 'none'; camera 'none'; display-capture 'none'; geolocation 'none'"
            referrerPolicy="no-referrer"
            tabIndex={-1}
          />
        ) : null
      ) : null}
    </div>
  );
}

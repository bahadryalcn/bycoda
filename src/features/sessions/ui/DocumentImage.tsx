import { useEffect, useRef, useState, type CSSProperties, type ComponentProps } from "react";
import { readProjectImage } from "../../../platform/tauri/fs";
import { sniffDocumentImageMime } from "../../files/model/filePreview";

/** The presentational attributes a document's `<img>` keeps. */
export type DocumentImageAttributes = {
  alt?: string;
  title?: string;
  width?: number | string;
  height?: number | string;
  align?: string;
};

/** A bare number is pixels, as in an HTML attribute; anything else is CSS. */
function cssSize(value: number | string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return /^\d+(?:\.\d+)?$/.test(String(value)) ? `${value}px` : String(value);
}

/**
 * Where a document's image cannot be shown, such as a remote badge or a file
 * that is missing, its alt text stands in, muted so it reads as a placeholder.
 */
export function ImageAltText({ alt, title }: { alt?: string; title?: string }) {
  const text = alt?.trim();
  if (!text) return null;
  return (
    <span
      data-image-alt=""
      title={title}
      className="text-[0.92em] italic text-(--ui-text-secondary)"
    >
      {text}
    </span>
  );
}

function releaseBlob(ref: { current: string | null }) {
  if (!ref.current) return;
  URL.revokeObjectURL(ref.current);
  ref.current = null;
}

/**
 * An image a Markdown document shows from its own project, at its natural or
 * declared size like on GitHub. The file loads once it scrolls near view and
 * is displayed only if its bytes are an image, through a blob URL that is
 * revoked when the image goes away. Anything unreadable shows its alt text.
 */
export function DocumentImage(props: ComponentProps<typeof ProjectImage>) {
  // A different file owns a different resource lifecycle; never flash an old blob.
  return <ProjectImage key={`${props.root}\0${props.relative}`} {...props} />;
}

function ProjectImage({
  path,
  root,
  relative,
  alt,
  title,
  width,
  height,
  align,
}: DocumentImageAttributes & {
  /** Absolute path, for display and tests. */
  path: string;
  root: string;
  relative: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The blob URL this image holds, revoked once, whichever comes first: an
  // image that fails to decode, a new path, or unmount.
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    readProjectImage(root, relative).then(
      (bytes) => {
        if (cancelled) return;
        const mime = sniffDocumentImageMime(relative, bytes);
        if (!mime) {
          setFailed(true);
          return;
        }
        const created = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
        blobRef.current = created;
        setUrl(created);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      releaseBlob(blobRef);
    };
  }, [near, root, relative]);

  if (failed) return <ImageAltText alt={alt} title={title ?? relative} />;

  // Inline, as in GitHub, so `<p align="center">` centers it and badges sit in
  // a row; the base stylesheet would otherwise make every image a block.
  const style: CSSProperties = {
    display: "inline",
    maxInlineSize: "100%",
    inlineSize: cssSize(width),
    blockSize: cssSize(height) ?? "auto",
  };
  if (!url) {
    return (
      <span
        ref={boxRef}
        data-document-image={path}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        style={{
          ...style,
          display: "inline-block",
          blockSize: cssSize(height),
          verticalAlign: "middle",
        }}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt ?? ""}
      title={title}
      width={width}
      height={height}
      {...(align ? { align } : {})}
      data-document-image={path}
      draggable={false}
      style={style}
      onError={() => {
        releaseBlob(blobRef);
        setUrl(null);
        setFailed(true);
      }}
    />
  );
}

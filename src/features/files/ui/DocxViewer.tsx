import { t, useLocale } from "../../../shared/i18n/technical";
import { useEffect, useRef, useState } from "react";
import mammoth from "mammoth/mammoth.browser";
import { documentErrorMessage } from "../model/documentViewer";
import { sanitizeDocumentHtml } from "../model/documentHtml";
import { DocumentMessage } from "./DocumentMessage";
import { useAnchoredZoom } from "./documentZoom";
import { ZoomBadge } from "./ZoomBadge";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

type State =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "error"; message: string };

// Descendant styles for the converted markup, which carries no classes of its own.
const DOCUMENT_CLASS = [
  "mx-auto max-w-[820px] px-8 py-6 text-[14px] leading-7 text-content select-text break-words",
  "[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-[26px] [&_h1]:font-semibold",
  "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[21px] [&_h2]:font-semibold",
  "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[17px] [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:font-semibold [&_h5]:mt-3 [&_h5]:font-semibold [&_h6]:mt-3 [&_h6]:font-semibold",
  "[&_p]:my-3",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_a]:underline [&_a]:decoration-content/40",
  "[&_img]:my-3 [&_img]:max-w-full",
  "[&_table]:my-4 [&_table]:border-collapse [&_td]:border [&_td]:border-stroke [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-stroke [&_th]:px-2 [&_th]:py-1",
].join(" ");

export default function DocxViewer({ bytes }: { bytes: Uint8Array }) {
  useLocale();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    mammoth.convertToHtml({ arrayBuffer }).then(
      (result) => {
        if (!cancelled) {
          setState({
            status: "ready",
            html: sanitizeDocumentHtml(result.value),
          });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: documentErrorMessage(cause) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center text-[12px] text-content/45">
        {t("Converting document…")}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <DocumentMessage title={t("Couldn’t read this document")} error>
        {state.message}
      </DocumentMessage>
    );
  }
  if (!state.html.trim()) {
    return <DocumentMessage title={t("This document has no readable content")} />;
  }
  return <DocxPages html={state.html} />;
}

function DocxPages({ html }: { html: string }) {
  useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { zoom, reset } = useAnchoredZoom(scrollRef, "docx", {
    min: MIN_ZOOM,
    max: MAX_ZOOM,
  });
  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="h-full overflow-auto overscroll-contain">
        <div
          className={DOCUMENT_CLASS}
          // `zoom` scales text, spacing and the page width together.
          style={{ zoom }}
          // Sanitized above: no scripts, handlers, remote loads or live links.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <ZoomBadge zoom={zoom} onReset={reset} />
    </div>
  );
}

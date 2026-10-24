import { t, useLocale } from "../../../shared/i18n/technical";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadDocx } from "../model/docxClient";
import { documentErrorMessage } from "../model/documentViewer";
import { sanitizeDocumentBody } from "../model/documentHtml";
import { DocumentMessage } from "./DocumentMessage";
import { useAnchoredZoom } from "./documentZoom";
import { ZoomBadge } from "./ZoomBadge";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

type State =
  | { status: "loading" }
  | { status: "ready"; body: HTMLElement; empty: boolean }
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
    const controller = new AbortController();
    setState({ status: "loading" });
    loadDocx(bytes, controller.signal)
      .then((html) => {
        if (!controller.signal.aborted) {
          const body = sanitizeDocumentBody(html);
          setState({
            status: "ready",
            body,
            empty: ![...body.childNodes].some(
              (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
            ),
          });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: documentErrorMessage(cause) });
        }
      });
    return () => {
      controller.abort();
    };
  }, [bytes]);

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center text-[12px] text-[var(--ui-text-muted)]">
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
  if (state.empty) {
    return <DocumentMessage title={t("This document has no readable content")} />;
  }
  return <DocxPages body={state.body} />;
}

function DocxPages({ body }: { body: HTMLElement }) {
  useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Retain nodes through StrictMode effect replay without parsing sanitized HTML
  // a second time. Each viewer owns this bounded, already-sanitized tree.
  const nodes = useMemo(() => [...body.childNodes], [body]);
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let index = 0;
    let frame = 0;
    const append = () => {
      const fragment = document.createDocumentFragment();
      const deadline = performance.now() + 6;
      let count = 0;
      do {
        fragment.append(nodes[index++]);
        count += 1;
      } while (index < nodes.length && count < 50 && performance.now() < deadline);
      page.append(fragment);
      if (index < nodes.length) frame = requestAnimationFrame(append);
    };
    if (nodes.length) append();
    return () => {
      cancelAnimationFrame(frame);
      // Return owned nodes in source order so a StrictMode/Activity replay can
      // reattach the complete sanitized document without reparsing or cloning it.
      for (const node of nodes) body.append(node);
      page.replaceChildren();
    };
  }, [body, nodes]);
  const { zoom, reset } = useAnchoredZoom(scrollRef, "docx", {
    min: MIN_ZOOM,
    max: MAX_ZOOM,
  });
  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="h-full overflow-auto overscroll-contain">
        <div
          ref={pageRef}
          className={DOCUMENT_CLASS}
          // `zoom` scales text, spacing and the page width together.
          style={{ zoom }}
        />
      </div>
      <ZoomBadge zoom={zoom} onReset={reset} />
    </div>
  );
}

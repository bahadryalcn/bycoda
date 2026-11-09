import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Attachment } from "../../src/features/sessions/model/session";
import {
  attachmentTokens,
  insertAtSelection,
  removeAttachmentFromText,
} from "../../src/features/sessions/model/attachmentTokens";
import { AttachmentChip } from "../../src/features/sessions/ui/AttachmentChip";
import { AttachmentTokenText } from "../../src/features/sessions/ui/AttachmentTokenText";
import { ComposerAttachmentHighlight } from "../../src/features/sessions/ui/ComposerAttachmentHighlight";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

const parameters = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", parameters.get("theme") === "light");
document.documentElement.dataset.canvasBackground = "pure";
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#243f46"/><path d="M0 180L110 64L190 130L290 35L400 180Z" fill="#a5b9a6"/><circle cx="80" cy="42" r="18" fill="#efdfb5"/></svg>')}`;
const samples: Attachment[] = [
  {
    id: "image",
    name: "mountain-reference-for-the-new-project.png",
    kind: "image",
    mimeType: parameters.has("recover") ? "image/svg+xml" : "image/png",
    size: 242991,
    previewUrl: parameters.has("recover")
      ? URL.createObjectURL(
          new Blob([decodeURIComponent(image.slice(image.indexOf(",") + 1))], {
            type: "image/svg+xml",
          }),
        )
      : parameters.has("broken")
        ? "data:image/png;base64,broken"
        : image,
    ...(parameters.has("recover")
      ? {
          loadPreview: async () => btoa(decodeURIComponent(image.slice(image.indexOf(",") + 1))),
        }
      : {}),
  },
  {
    id: "audio",
    name: "customer-interview-final-recording.m4a",
    kind: "audio",
    mimeType: "audio/mp4",
    size: 3145728,
  },
  {
    id: "video",
    name: "product-walkthrough-final-review.mp4",
    kind: "file",
    mimeType: "video/mp4",
    size: 18457433,
  },
  {
    id: "pdf",
    name: "research-findings-and-project-requirements.pdf",
    kind: "file",
    mimeType: "application/pdf",
    size: 794321,
  },
  {
    id: "markdown",
    name: "implementation-notes-and-next-steps.md",
    kind: "file",
    mimeType: "text/markdown",
    size: 4821,
  },
  {
    id: "text",
    name: "customer-feedback-from-support.txt",
    kind: "file",
    mimeType: "text/plain",
    size: 1204,
  },
  {
    id: "code",
    name: "AttachmentPresentation.component.tsx",
    kind: "file",
    mimeType: "text/plain",
    size: 8932,
  },
  {
    id: "archive",
    name: "design-assets-complete-export.zip",
    kind: "file",
    mimeType: "application/zip",
    size: 7340032,
  },
  { id: "folder", name: "Project references", kind: "file", mimeType: "inode/directory", size: 0 },
  {
    id: "missing",
    name: "unavailable-original-source.pdf",
    kind: "file",
    mimeType: "application/pdf",
    size: 24093,
    missing: true,
  },
];

// Historical remote attachments retain metadata and an owning-Host reader,
// rather than the temporary preview URL available while composing.
const persistedImage: Attachment = {
  id: "persisted-image",
  name: "saved-mountain-reference.svg",
  kind: "image",
  mimeType: "image/svg+xml",
  size: 320,
  path: "/isolated-host/saved-mountain-reference.svg",
  loadPreview: async () => btoa(decodeURIComponent(image.slice(image.indexOf(",") + 1))),
};
const messageAttachments = [samples[0], persistedImage, ...samples.slice(1, 5)];

function EditableExample({ name, initial }: { name: string; initial: Attachment[] }) {
  const [attachments, setAttachments] = useState(initial);
  const [text, setText] = useState(
    `Please review ${attachmentTokens(initial).join(" ")} before the next step.`,
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  const tokens = attachmentTokens(attachments);
  return (
    <section aria-label={name} className="min-w-0">
      <h2 className="mb-2 text-ui-secondary font-medium">{name}</h2>
      <div className="rounded-xl border border-(--color-stroke) bg-(--ui-surface) p-3">
        <div className="flex flex-wrap items-start gap-2">
          {attachments.map((attachment, index) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              token={tokens[index]}
              onRemove={() => {
                setText(removeAttachmentFromText(text, attachments, index));
                setAttachments(attachments.filter((item) => item.id !== attachment.id));
              }}
              onInsertToken={() => {
                const field = input.current;
                const next = insertAtSelection(
                  text,
                  field ? { start: field.selectionStart, end: field.selectionEnd } : null,
                  tokens[index],
                );
                caret.current = next.caret;
                setText(next.text);
              }}
            />
          ))}
        </div>
        <div className="relative mt-3 text-ui-body leading-5.5">
          <div
            aria-hidden="true"
            className="composer-highlight pointer-events-none absolute inset-0 whitespace-pre-wrap wrap-break-word p-2 font-sans text-(--color-content)"
          >
            <ComposerAttachmentHighlight
              text={text}
              attachments={attachments}
              renderText={(value) => value}
            />
          </div>
          <textarea
            ref={input}
            aria-label={`${name} message`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={name === "Composer" ? 3 : 2}
            className="relative block w-full resize-none bg-transparent p-2 font-sans text-transparent caret-(--color-content) outline-none"
          />
        </div>
      </div>
    </section>
  );
}

function Fixture() {
  return (
    <main className="mx-auto min-h-dvh max-w-5xl space-y-5 bg-(--color-background) px-5 py-5 text-(--color-content)">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-ui-body font-semibold">Attachments</h1>
        <span className="text-ui-caption text-(--ui-text-secondary)">
          Isolated shared-component fixture
        </span>
      </header>
      <EditableExample name="Composer" initial={samples} />
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
        <EditableExample name="Quick composer" initial={samples.slice(0, 2)} />
        <EditableExample name="Queue editor" initial={samples.slice(3, 5)} />
      </div>
      <section aria-label="Message" className="min-w-0">
        <h2 className="mb-2 text-ui-secondary font-medium">Message</h2>
        <p className="mb-3 text-ui-body leading-7">
          <AttachmentTokenText
            text={`Compare ${attachmentTokens(messageAttachments).join(" and ")} with these references.`}
            attachments={messageAttachments}
          />
        </p>
        <div className="flex flex-wrap items-start gap-2">
          {messageAttachments.map((attachment, index) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              token={attachmentTokens(messageAttachments)[index]}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Fixture />
    </QueryClientProvider>,
  ),
);

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AttachmentChip } from "../../src/features/sessions/ui/AttachmentChip";
import { GeneratedImage } from "../../src/features/sessions/ui/GeneratedImage";
import { AgentMarkdown } from "../../src/features/sessions/ui/AgentMarkdown";
import { ToolDiffPreview } from "../../src/features/sessions/ui/ToolDiffPreview";
import { UserTextPreview } from "../../src/features/sessions/ui/UserTextPreview";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Attachment } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

const reads: Record<string, number> = {};
Object.assign(window, { artifactFormatReads: reads });

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function attachment(name: string, mimeType: string, bytes: Uint8Array): Attachment {
  const data = base64(bytes);
  reads[name] = 0;
  return {
    id: name,
    name,
    kind: "file",
    mimeType,
    size: bytes.byteLength,
    // An opaque path exercises the display name's format instead of the disk suffix.
    path: `/fixture-host/attachments/${name.split(".")[0]}`,
    loadPreview: async () => {
      reads[name]++;
      return data;
    },
  };
}

/** An owned, deterministic one-page parser fixture; offsets are ASCII byte offsets. */
function pdfBytes(): Uint8Array {
  const stream =
    "BT /F1 22 Tf 50 230 Td (PDF preview verified) Tj 0 -38 Td /F1 12 Tf (Owned browser integration fixture) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function workbookBytes(): Promise<Uint8Array> {
  const { utils, write } = await import("xlsx");
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ["Name", "Result"],
      ["Workbook marker", "Verified"],
    ]),
    "Overview",
  );
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ["Metric", "Value"],
      ["Answer", 42],
    ]),
    "Metrics",
  );
  return new Uint8Array(write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function recorderMime(): string | undefined {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof HTMLCanvasElement.prototype.captureStream !== "function"
  )
    return undefined;
  return ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((mime) =>
    MediaRecorder.isTypeSupported(mime),
  );
}

async function recordVideo(mimeType: string): Promise<Attachment> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d")!;
  const stream = canvas.captureStream(12);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  let frame = 0;
  const paint = () => {
    context.fillStyle = frame % 2 ? "#183f64" : "#274b34";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "24px sans-serif";
    context.fillText("Owned playback fixture", 22, 72);
    context.font = "16px sans-serif";
    context.fillText(`Frame ${frame++}`, 22, 110);
  };
  paint();
  const timer = window.setInterval(paint, 80);
  try {
    await new Promise<void>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Fixture recorder failed"));
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 1_000);
    });
    const blob = new Blob(chunks, { type: mimeType });
    return attachment(
      mimeType.includes("mp4") ? "playback.mp4" : "playback.webm",
      mimeType.split(";")[0],
      new Uint8Array(await blob.arrayBuffer()),
    );
  } finally {
    window.clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
  }
}

function Fixture() {
  const [documents, setDocuments] = useState<Attachment[]>([]);
  const [video, setVideo] = useState<Attachment>();
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string>();
  const [support, setSupport] = useState(recorderMime() ? "available" : "unsupported");
  useEffect(() => {
    let cancelled = false;
    void workbookBytes().then((bytes) => {
      if (!cancelled)
        setDocuments([
          attachment("proof.pdf", "application/pdf", pdfBytes()),
          attachment(
            "proof.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            bytes,
          ),
        ]);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main className="min-h-dvh bg-background-base p-8 text-content" data-recorder-support={support}>
      <h1 className="text-xl font-medium">Attachment format integration</h1>
      <p className="py-3 text-sm text-content/60">
        Owned parser and playback fixtures. Browser acceptance only.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {documents.map((document) => (
          <AttachmentChip key={document.id} attachment={document} />
        ))}
        {video ? (
          <AttachmentChip attachment={video} />
        ) : (
          <button
            type="button"
            disabled={recording || support === "unsupported"}
            className="rounded bg-content/10 px-3 py-2 text-sm disabled:opacity-50"
            onClick={() => {
              const mime = recorderMime();
              if (!mime) {
                setSupport("unsupported");
                return;
              }
              setRecording(true);
              void recordVideo(mime)
                .then(setVideo, (error: unknown) => {
                  if (error instanceof DOMException && error.name === "NotSupportedError")
                    setSupport("unsupported");
                  else setRecordError(String(error));
                })
                .finally(() => setRecording(false));
            }}
          >
            {recording ? "Recording test video…" : "Create owned test video"}
          </button>
        )}
      </div>
      {recordError ? <p role="alert">{recordError}</p> : null}
    </main>
  );
}

function GeneratedImagesFixture() {
  const [data] = useState(() => {
    const canvas = document.createElement("canvas");
    const shape = new URLSearchParams(location.search).get("shape");
    canvas.width = shape === "tall" ? 900 : shape === "small" ? 160 : 1440;
    canvas.height = shape === "tall" ? 2400 : shape === "small" ? 100 : 900;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "48px sans-serif";
    context.fillText("Left edge", 20, 80);
    context.fillText("Right edge", canvas.width - 280, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return (
    <main
      style={{
        inlineSize: "100%",
        maxInlineSize: 600,
        minInlineSize: 0,
        marginInline: "auto",
        background: "var(--ui-surface)",
      }}
    >
      <GeneratedImage
        image={{
          data,
          name: "wide.png",
          path: "/fixture/wide.png",
          mimeType: "image/png",
          size: 0,
        }}
      />
    </main>
  );
}

function ChatOverflowFixture() {
  const [opened, setOpened] = useState("");
  const path = `/workspace/${"long-directory-name/".repeat(18)}changes.ts`;
  return (
    <main className="mx-auto w-full max-w-2xl min-w-0 p-4">
      <section aria-label="File change" className="flex min-w-0 items-center gap-2">
        <span>Edit</span>
        <ToolDiffPreview
          preview={{ kind: "write", path, lines: [{ kind: "add", text: "added" }] }}
          label={path}
          status="accepted"
          onOpen={() => setOpened(path)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <span className="shrink-0">TS</span>
          <span data-file-label className="min-w-0 truncate">
            {path}
          </span>
        </ToolDiffPreview>
      </section>
      <section aria-label="User text">
        <UserTextPreview
          parts={[{ kind: "text", text: "unbroken".repeat(200), compact: true }]}
          messageId="overflow-user"
          renderActions={() => null}
        />
      </section>
      <AgentMarkdown
        text={[
          "```ts",
          ...Array.from(
            { length: 16 },
            (_, i) => `const value${i} = '${"long-value".repeat(20)}';`,
          ),
          "```",
          "",
          "| Name | Value |",
          "| --- | --- |",
          `| ${"long-cell".repeat(80)} | result |`,
          "",
          "Message after wide content.",
        ].join("\n")}
      />
      <output aria-label="Opened file">{opened ? "opened" : ""}</output>
    </main>
  );
}

function LocalImageFixture() {
  const [opened, setOpened] = useState("");
  const [ready] = useState(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 900;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "48px sans-serif";
    context.fillText("LEFT EDGE", 20, 80);
    context.fillText("RIGHT EDGE", 1100, 80);
    context.fillText("BOTTOM EDGE", 560, 860);
    const data = canvas.toDataURL("image/png").split(",")[1];
    mockIPC((command) => {
      if (command === "read_binary_file") return data;
      throw new Error(`Unsupported fixture command: ${command}`);
    });
    return true;
  });
  return ready ? (
    <main
      style={{
        inlineSize: "100%",
        maxInlineSize: 864,
        marginInline: "auto",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <AgentMarkdown
        text={"![Chat preview](/fixture/chat-preview.png)\n\nThe complete message after the image."}
        cwd="/fixture"
        localMedia
        onOpenFile={setOpened}
      />
      <output aria-label="Opened image">{opened}</output>
    </main>
  ) : null;
}

createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("chat-overflow") ? (
    <ChatOverflowFixture />
  ) : new URLSearchParams(location.search).has("local-image") ? (
    <LocalImageFixture />
  ) : new URLSearchParams(location.search).has("generated-images") ? (
    <GeneratedImagesFixture />
  ) : (
    <Fixture />
  ),
);

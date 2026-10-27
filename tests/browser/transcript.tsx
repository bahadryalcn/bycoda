import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { ActivityDock } from "../../src/features/sessions/ui/ActivityDock";
import type { Block } from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

saveTranscriptAnchor(false);
saveTranscriptLayout(new URLSearchParams(location.search).has("full-width") ? "full" : "chat");

// Settled plain text isolates layout during scrolling from streaming, image
// loading and asynchronous syntax highlighting. Turns deliberately vary in size.
const blocks: Block[] = Array.from({ length: 20 }, (_, index): Block[] => [
  {
    id: `user-${index}`,
    role: "user",
    text: `Prompt ${index}: explain this behavior and preserve my place while reading.`,
  },
  {
    id: `reply-${index}`,
    role: "assistant",
    text: Array.from(
      { length: 8 + (index % 5) * 8 },
      (_, paragraph) =>
        `Paragraph ${paragraph}. This is a settled answer with enough text to exercise variable message heights.`,
    ).join("\n\n"),
  },
]).flat();

// Like the transcript pool, parking detaches the transcript from the page.
const root = document.getElementById("root")!;
if (
  new URLSearchParams(window.location.search).has("artifacts") ||
  new URLSearchParams(window.location.search).has("rewind") ||
  new URLSearchParams(location.search).has("streaming") ||
  new URLSearchParams(location.search).has("chat-layout") ||
  new URLSearchParams(location.search).has("message-bubbles") ||
  new URLSearchParams(location.search).has("native-turn-recovery")
) {
  root.style.width = "100%";
  root.style.height = "100dvh";
}
const host = document.createElement("div");
host.className = "contents";
root.appendChild(host);

function Fixture() {
  const [parked, setParked] = useState(false);
  const streaming = new URLSearchParams(location.search).has("streaming");
  const [streamText, setStreamText] = useState("Streaming response");
  const [running, setRunning] = useState(true);
  const longText = new URLSearchParams(window.location.search).has("longText");
  const artifacts = new URLSearchParams(window.location.search).has("artifacts");
  const rewind = new URLSearchParams(window.location.search).has("rewind");
  const nativeTurnRecovery = new URLSearchParams(window.location.search).has(
    "native-turn-recovery",
  );
  useEffect(() => {
    Object.assign(window, {
      appendFixtureStream: (text: string) => setStreamText((value) => value + text),
      finishFixtureStream: () => setRunning(false),
      savedFixtureNotes: [] as string[],
      parkTranscript: () => {
        host.remove();
        setParked(true);
      },
      showTranscript: () => {
        root.appendChild(host);
        setParked(false);
      },
    });
  }, []);
  if (nativeTurnRecovery)
    return (
      <AgentTranscript
        sessionId="native-turn-recovery-session"
        managedWorkspaceId="native-turn-recovery-workspace"
        cwd="/isolated/worktree"
        blocks={[
          { id: "native-request", role: "user", text: "Update the file in this worktree." },
          {
            id: "native-error",
            role: "system",
            notice: "error",
            text: "A different managed turn is still active or has an unknown outcome",
          },
          {
            id: "native-draft",
            role: "user",
            draft: true,
            text: "Keep my next request as a draft.",
          },
        ]}
      />
    );
  return (
    <AgentTranscript
      blocks={
        streaming
          ? [
              ...blocks,
              {
                id: "stream-user",
                role: "user",
                text: "Preserve my place while streaming.",
                durationMs: running ? undefined : 1200,
              },
              { id: "stream-reply", role: "assistant", text: streamText },
            ]
          : rewind
            ? [
                { id: "prior-request", role: "user", text: "Keep this conversation." },
                { id: "prior-answer", role: "assistant", text: "Earlier response." },
                {
                  id: "wrong-request",
                  role: "user",
                  text: "Sent to the wrong session.",
                  turnOutcome: "stopped",
                },
              ]
            : artifacts
              ? [
                  {
                    id: "artifact-user",
                    role: "user",
                    text: "Inspect these results and the attached table.",
                    attachments: [
                      {
                        id: "table",
                        kind: "file",
                        name: "results.csv",
                        mimeType: "text/csv",
                        size: 26,
                        data: btoa("Name,Result\nBuild,passed\n"),
                      },
                    ],
                  },
                  {
                    id: "artifact-write",
                    role: "tool",
                    text: "Write src/App.tsx",
                    tool: {
                      kind: "write",
                      status: "completed",
                      preview: {
                        kind: "write",
                        path: "src/App.tsx",
                        contentOnly: true,
                        lines: [{ kind: "context", text: "export const ready = true;" }],
                        inspection: {
                          kind: "content",
                          text: "export function App() {\n  return <main>Connected workspace</main>;\n}\n// saved-code-marker",
                        },
                      },
                    },
                  },
                  {
                    id: "artifact-output",
                    role: "tool",
                    text: "Run pnpm build",
                    tool: {
                      kind: "shell",
                      status: "completed",
                      detail: "Build succeeded: output-marker",
                    },
                  },
                ]
              : longText
                ? [
                    {
                      id: "long-text",
                      role: "user",
                      text: "Selectable excerpt\n" + "Long content ".repeat(200),
                    },
                  ]
                : blocks
      }
      visible={!parked}
      busy={streaming ? running : artifacts}
      onSaveNote={
        streaming
          ? async (text) => {
              (window as unknown as { savedFixtureNotes: string[] }).savedFixtureNotes.push(text);
            }
          : undefined
      }
      canRewindMessage={rewind ? () => true : undefined}
      onRewindMessage={
        rewind
          ? (block, action) => {
              Object.assign(window, { lastRewind: { blockId: block.id, action } });
            }
          : undefined
      }
      parked={parked}
    />
  );
}

function ChatLayoutFixture() {
  const backgroundWork = new URLSearchParams(location.search).has("background-work");
  const startedAt = Date.now() - 269_000;
  const layoutBlocks: Block[] = [
    {
      id: "layout-user",
      role: "user",
      startedAt,
      text: `${new URLSearchParams(location.search).has("mixed-attachments") ? "[file1] " : ""}[image1] Sohbet ekranındaki mesajları daha okunabilir yap. [image2] [image3] [image4] [image5] [image6] [image7] Ekler ve çalışan işlemler de anlaşılır olmalı.`,
      attachments: [
        ...(new URLSearchParams(location.search).has("mixed-attachments")
          ? [
              {
                id: "layout-file",
                name: "notes.txt",
                kind: "file" as const,
                mimeType: "text/plain",
                size: 20,
                data: btoa("Attachment file content"),
              },
            ]
          : []),
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `layout-image-${index}`,
          name: `screenshot-${index + 1}.png`,
          kind: "image" as const,
          mimeType: "image/png",
          size: 42,
          previewUrl: "/brand/bycoda/mark-light.svg",
        })),
      ],
    },
    {
      id: "layout-intro",
      role: "assistant",
      text: "Mesajları, ekleri ve çalışma durumunu ayrı bir hiyerarşide düzenliyorum. Komut ayrıntıları gerektiğinde açılabilir kalacak.",
    },
    ...Array.from({ length: 10 }, (_, index): Block => ({
      id: `layout-command-${index}`,
      role: "tool",
      text: backgroundWork
        ? `cd G:/Projects/my_projects/monocode && pnpm exec vitest run ${"src/features/sessions/very-long-unbroken-command-path/".repeat(5)}task-${index}.test.ts > temp/verification/background-work/task-${index}.log 2>&1`
        : `Run pnpm exec check src/features/sessions/ui/very-long-command-path-${index}.tsx`,
      tool: {
        kind: "shell",
        background: backgroundWork,
        callId: backgroundWork ? `layout-call-${index}` : undefined,
        status: index === 9 ? "in_progress" : "completed",
        detail: `Command result ${index}: readable-output-marker`,
      },
    })),
  ];
  return (
    <div
      className="flex h-dvh min-w-0 flex-col bg-background-base text-content"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, transparent, transparent 7px, var(--color-stroke) 8px)",
      }}
    >
      <div className="min-h-0 min-w-0 flex-1">
        <AgentTranscript
          blocks={layoutBlocks}
          busy
          liveStatusInDock
          harness="codex"
          model="gpt-6.1"
        />
      </div>
      <div data-composer className="mx-auto w-full max-w-4xl px-4 py-2">
        <ActivityDock
          sessionId="layout-session"
          blocks={layoutBlocks}
          busy
          backgroundTasks={backgroundWork ? ["layout-command-9"] : undefined}
          backgroundAgents={backgroundWork ? 0 : undefined}
          perItemStop={backgroundWork}
          onStopAgent={backgroundWork ? async () => {} : undefined}
          onStopAll={backgroundWork ? async () => {} : undefined}
          pendingQuestion={false}
          atEnd
          onOpenAgent={() => {}}
        />
      </div>
    </div>
  );
}

function MessageBubblesFixture() {
  return (
    <div className="h-full min-w-0">
      <AgentTranscript
        onSaveNote={() => {}}
        blocks={[
          { id: "short-user", role: "user", text: "Merhaba", startedAt: 1792612800000 },
          { id: "short-reply", role: "assistant", text: "Merhaba, nasıl yardımcı olabilirim?" },
          {
            id: "long-user",
            role: "user",
            text: "Bu uzun mesaj ekran genişliğine göre satırlara bölünmeli. ".repeat(8),
          },
          { id: "long-reply", role: "assistant", text: "Uzun mesajı aldım." },
          { id: "draft-user", role: "user", text: "Bekleyen taslak", draft: true },
        ]}
      />
    </div>
  );
}

createRoot(host).render(
  new URLSearchParams(location.search).has("message-bubbles") ? (
    <MessageBubblesFixture />
  ) : new URLSearchParams(location.search).has("chat-layout") ? (
    <ChatLayoutFixture />
  ) : (
    <Fixture />
  ),
);

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import type { Block } from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

saveTranscriptAnchor(false);
saveTranscriptLayout("chat");

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
if (new URLSearchParams(window.location.search).has("artifacts")) {
  root.style.width = "100%";
  root.style.height = "100dvh";
}
const host = document.createElement("div");
host.className = "contents";
root.appendChild(host);

function Fixture() {
  const [parked, setParked] = useState(false);
  const longText = new URLSearchParams(window.location.search).has("longText");
  const artifacts = new URLSearchParams(window.location.search).has("artifacts");
  useEffect(() => {
    Object.assign(window, {
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
  return (
    <AgentTranscript
      blocks={
        artifacts
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
      busy={artifacts}
      parked={parked}
    />
  );
}

createRoot(host).render(<Fixture />);

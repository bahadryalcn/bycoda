import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentMarkdown } from "../../src/features/sessions/ui/AgentMarkdown";
import { ImageLightbox } from "../../src/shared/ui/ImageLightbox";
import "../../src/styles/index.css";

const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#6699aa"/><path d="M0 0L800 500M800 0L0 500" stroke="white" stroke-width="8"/></svg>');
const code = Array.from({ length: 350 }, (_, i) => `const value${i} = { text: "line ${i}", count: ${i} };`).join("\n");
const table = "| File | Result | Details |\n| --- | --- | --- |\n| src/features/long-file-name.tsx | passed | A longer explanation that wraps within a readable column. |\n| host/checkpoints.ts | passed | More details |";
function Fixture() {
  const [lightbox, setLightbox] = useState(false);
  const [text, setText] = useState("```typescript\n" + code.slice(0, 500));
  return <main style={{ maxInlineSize: "100%", padding: 12 }}>
    <button onClick={() => setLightbox(true)}>Open image</button>
    <button onClick={() => setText("```typescript\n" + code + "\n```")}>Finish code</button>
    <section data-table-panel style={{ inlineSize: "min(320px, 100%)", minInlineSize: 0 }}><AgentMarkdown text={table} /></section>
    <section data-code-panel style={{ inlineSize: "min(600px, 100%)", minInlineSize: 0 }}><AgentMarkdown text={text} streaming={!text.endsWith("```")} /></section>
    {lightbox && <ImageLightbox src={image} alt="Zoom regression image" onClose={() => setLightbox(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

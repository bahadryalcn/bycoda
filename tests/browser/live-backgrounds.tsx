import { useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import {
  LiveBackgroundCanvas,
  LiveBackgroundLayer,
} from "../../src/features/settings/ui/LiveBackgroundCanvas";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import {
  LIVE_BACKGROUNDS,
  saveLiveBackground,
  type LiveBackground,
} from "../../src/features/settings/model/liveBackground";
import { Button } from "../../src/shared/ui/Button";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const requestedEffect = params.get("effect") as LiveBackground;
const effect = LIVE_BACKGROUNDS.includes(requestedEffect) ? requestedEffect : "neural-tree";
saveLiveBackground(effect);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");

function Fixture() {
  const [speaking, setSpeaking] = useState(false);
  const [speech, setSpeech] = useState(0);
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!speaking) return;
    const timer = window.setInterval(() => setSpeech((n) => n + 9), 80);
    return () => clearInterval(timer);
  }, [speaking]);
  return (
    <main>
      <div className="flex gap-2 p-3">
        <Button onClick={() => setSpeaking((v) => !v)}>
          {speaking ? "Stop reply" : "Start reply"}
        </Button>
        <Button onClick={() => setActive((v) => !v)}>{active ? "Pause" : "Resume"}</Button>
      </div>
      <div
        data-scene
        className="relative mx-auto overflow-hidden bg-(--ui-surface)"
        style={{ width: 260, height: 300 }}
      >
        <LiveBackgroundCanvas
          effect={effect}
          speech={speaking ? speech : -1}
          active={active}
          intensity={0.7}
          className="absolute inset-0"
        />
      </div>
      <section
        data-preview-pane
        className="relative isolate w-full overflow-hidden bg-(--ui-surface)"
        style={
          {
            "--appearance-chat-width": params.get("chatWidth") === "full" ? "100%" : "56rem",
            height: 640,
          } as CSSProperties
        }
      >
        <LiveBackgroundLayer
          active={active}
          visible
          speech={speaking ? speech : -1}
          activity={speaking ? speech : -1}
        />
        <article
          data-reading-area
          className="relative mx-auto w-full px-6 py-16 text-content"
          style={{ maxWidth: "var(--appearance-chat-width)" }}
        >
          <p className="mb-5 text-ui-primary leading-relaxed">
            Keep the conversation easy to read. The assistant can explain a complex change while the
            artwork stays in the unused outer margin. This paragraph deliberately occupies several
            lines so the preview exercises the actual reading area on both narrow and wide panes.
          </p>
          <pre className="overflow-x-auto rounded-md border border-stroke bg-(--ui-surface-raised) p-4 text-ui-secondary">
            <code>{`function summarize(items: string[]) {\n  return items.map((item) => item.trim());\n}\n\nconst result = summarize(["Quiet", "Readable"]);`}</code>
          </pre>
          <p className="mt-5 text-ui-primary leading-relaxed">
            The same layout must remain clear when a reply is streaming, when motion is reduced, and
            when the pane is resized. No decorative thread or character should cross these lines.
          </p>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

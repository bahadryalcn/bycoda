import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../../src/shared/ui/Button";
import "../../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
type NativeMenu = {
  rid: number;
  items: { id: string; label: string; checked?: boolean; disabled?: boolean }[];
};
function Fixture() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ width: 380, height: 56 });
  const [menu, setMenu] = useState<NativeMenu | null>(null);
  const send = (message: unknown) =>
    frame.current?.contentWindow?.postMessage(message, location.origin);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "fixture-native-menu") setMenu(event.data.menu);
      if (
        event.data?.type === "fixture-native-fit" &&
        Number.isFinite(event.data.width) &&
        Number.isFinite(event.data.height)
      )
        setSize({ width: event.data.width, height: event.data.height });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  const child = new URLSearchParams(params);
  child.set("compact", params.get("compact") ?? "1");
  return (
    <main
      data-native-menu-proof
      style={{ padding: 24, maxInlineSize: 720, color: "var(--ui-text-primary)" }}
    >
      <h1 style={{ fontSize: 16 }}>Native voice menu · fixture evidence</h1>
      <p>
        Actual voice webview at its requested size; OS menu transport is mocked. This is not native
        menu paint.
      </p>
      <iframe
        ref={frame}
        title="Synthetic native voice window"
        src={`/tests/browser/voice/voice-overlay.html?${child}`}
        onLoad={() => send({ type: "fixture-native-sync" })}
        style={{
          display: "block",
          width: size.width,
          height: size.height,
          border: "1px solid var(--ui-tone-neutral-border)",
        }}
      />
      <p data-native-window-size>
        {size.width} × {size.height} webview
      </p>
      {menu && (
        <section
          aria-label="Synthetic OS menu transport"
          style={{
            display: "grid",
            gap: 4,
            maxInlineSize: 280,
            padding: 12,
            border: "1px solid var(--ui-tone-neutral-border)",
            background: "var(--ui-surface)",
          }}
        >
          <p>Mocked OS menu · outside the webview</p>
          <div role="menu" aria-label="Synthetic turn ending menu">
            {menu.items.map((item) => (
              <Button
                key={item.id}
                aria-label={item.label}
                fullWidth
                variant="ghost"
                role="menuitemradio"
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => send({ type: "fixture-native-pick", rid: menu.rid, id: item.id })}
              >
                {item.checked ? "✓ " : ""}
                {item.label}
              </Button>
            ))}
          </div>
          <Button variant="ghost" onClick={() => send({ type: "fixture-native-dismiss" })}>
            Dismiss synthetic menu
          </Button>
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);

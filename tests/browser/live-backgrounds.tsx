import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveBackgroundCanvas } from "../../src/features/settings/ui/LiveBackgroundCanvas";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import {
  LIVE_BACKGROUNDS,
  type LiveBackground,
} from "../../src/features/settings/model/liveBackground";
import { Button } from "../../src/shared/ui/Button";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const effect = params.get("effect") as LiveBackground;
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
        className="relative w-full overflow-hidden"
        style={{ height: "min(80vh, 760px)" }}
      >
        <LiveBackgroundCanvas
          effect={LIVE_BACKGROUNDS.includes(effect) ? effect : "world-tree"}
          speech={speaking ? speech : -1}
          active={active}
          intensity={0.7}
          className="absolute inset-0"
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

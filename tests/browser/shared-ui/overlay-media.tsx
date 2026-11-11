import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../../src/shared/ui/Button";
import { ImageAnnotationCanvas } from "../../../src/shared/ui/ImageAnnotationCanvas";
import type {
  ImageAnnotationDocument,
  ImageAnnotationTool,
} from "../../../src/shared/ui/ImageAnnotationCanvas";
import { ImageCompare } from "../../../src/shared/ui/ImageCompare";
import { ImageLightbox } from "../../../src/shared/ui/ImageLightbox";
import { ArrowUp, Pencil, Pin, Square, Undo2 } from "../../../src/shared/ui/icons";
import "../../../src/styles/index.css";

// Memory-only media fixture. Images are generated on a canvas at load (no
// network, no production data) and nothing is exported to disk or clipboard.
// It is fixture evidence for the shared media family, not installed acceptance.

type Palette = { sky: [string, string]; land: [string, string]; sun: string; ink: string };
function photo(palette: Palette, width = 960, height = 640) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.65);
  sky.addColorStop(0, palette.sky[0]);
  sky.addColorStop(1, palette.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.sun;
  ctx.beginPath();
  ctx.arc(width * 0.72, height * 0.3, height * 0.11, 0, Math.PI * 2);
  ctx.fill();
  const land = ctx.createLinearGradient(0, height * 0.6, 0, height);
  land.addColorStop(0, palette.land[0]);
  land.addColorStop(1, palette.land[1]);
  ctx.fillStyle = land;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.7);
  for (let x = 0; x <= width; x += 40)
    ctx.lineTo(x, height * (0.62 + 0.06 * Math.sin(x / 90) + 0.03 * Math.cos(x / 37)));
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 130 + 20, height);
    ctx.lineTo(i * 130 + 70, height * 0.82);
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

const IMAGES = {
  bright: photo({
    sky: ["#f4f8ff", "#fffbe8"],
    land: ["#e9efe0", "#fbfbf3"],
    sun: "#ffffff",
    ink: "#d8dccc",
  }),
  dark: photo({
    sky: ["#04060c", "#10162a"],
    land: ["#0b120d", "#030504"],
    sun: "#1b2238",
    ink: "#16221a",
  }),
  mixed: photo({
    sky: ["#2b6cb0", "#f6ad55"],
    land: ["#2f5233", "#e8d9a8"],
    sun: "#fff3c4",
    ink: "#1d3a20",
  }),
  broken: "/tests/browser/missing-photo.png",
};

declare global {
  interface Window {
    __mediaLog: string[];
  }
}
window.__mediaLog = [];
const log = (entry: string) => window.__mediaLog.push(entry);

function CompareCard({
  title,
  before,
  after,
  orientation,
  id,
}: {
  title: string;
  before: string;
  after: string;
  orientation?: "horizontal" | "vertical";
  id: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2" data-testid={`compare-${id}`}>
      <h2 className="text-ui-secondary text-(--ui-text-secondary)">{title}</h2>
      <ImageCompare
        before={<img src={before} alt={`${title} before`} />}
        after={<img src={after} alt={`${title} after`} />}
        orientation={orientation}
        onPositionChange={(value) => log(`compare:${id}:${Math.round(value)}`)}
      />
    </section>
  );
}

const TOOLS = [
  { value: "box", label: "Draw rectangle", icon: Square },
  { value: "arrow", label: "Draw arrow", icon: ArrowUp },
  { value: "pen", label: "Draw freehand", icon: Pencil },
  { value: "pin", label: "Add numbered pin", icon: Pin },
] as const;

function Annotator({ src, id }: { src: string; id: string }) {
  const [tool, setTool] = useState<ImageAnnotationTool>("box");
  const [current, setCurrent] = useState<ImageAnnotationDocument>({ marks: [] });
  const [undo, setUndo] = useState<ImageAnnotationDocument[]>([]);
  const [exported, setExported] = useState("");
  return (
    <section
      className="border-stroke bg-(--ui-surface) flex min-w-0 flex-col gap-2 rounded-(--ui-radius-panel) border p-2"
      data-testid={`annotator-${id}`}
    >
      <div role="toolbar" aria-label="Image annotation tools" className="flex flex-wrap gap-1">
        {TOOLS.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant="ghost"
            iconOnly
            label={label}
            tooltip={label}
            selected={tool === value}
            aria-pressed={tool === value}
            onClick={() => setTool(value)}
          >
            <Icon className="icon-md" aria-hidden />
          </Button>
        ))}
        <Button
          variant="ghost"
          iconOnly
          label="Undo annotation"
          tooltip="Undo annotation"
          disabled={!undo.length}
          onClick={() => {
            setCurrent(undo[undo.length - 1]!);
            setUndo(undo.slice(0, -1));
          }}
        >
          <Undo2 className="icon-md" aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!current.marks.length}
          onClick={() => {
            const text = `export:${current.marks.length}`;
            setExported(text);
            log(text);
          }}
        >
          Export
        </Button>
        <span data-testid={`annotation-count-${id}`} className="text-ui-caption self-center">
          {current.marks.length} marks {exported}
        </span>
      </div>
      <div className="h-64 min-h-0">
        <ImageAnnotationCanvas
          src={src}
          alt="Frozen frame"
          tool={tool}
          document={current}
          onChange={(next) => {
            setUndo((value) => [...value.slice(-49), current]);
            setCurrent(next);
          }}
        />
      </div>
    </section>
  );
}

type Scene = null | "bright" | "dark" | "broken";

function App() {
  const [scene, setScene] = useState<Scene>(null);
  const [lastClosed, setLastClosed] = useState("");
  return (
    <div className="bg-(--ui-surface-base) text-(--ui-text) flex h-screen flex-col overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <Button
          variant="secondary"
          data-testid="open-lightbox-bright"
          onClick={() => setScene("bright")}
        >
          Preview bright photo
        </Button>
        <Button
          variant="secondary"
          data-testid="open-lightbox-dark"
          onClick={() => setScene("dark")}
        >
          Preview dark photo
        </Button>
        <Button
          variant="secondary"
          data-testid="open-lightbox-broken"
          onClick={() => setScene("broken")}
        >
          Preview broken image
        </Button>
        <span data-testid="last-closed" className="text-ui-caption text-(--ui-text-muted)">
          {lastClosed}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        <CompareCard
          id="bright-dark"
          title="Bright / dark"
          before={IMAGES.bright}
          after={IMAGES.dark}
        />
        <CompareCard
          id="mixed-bright"
          title="Mixed / bright"
          before={IMAGES.mixed}
          after={IMAGES.bright}
        />
        <CompareCard id="dark-dark" title="Dark / dark" before={IMAGES.dark} after={IMAGES.dark} />
        <CompareCard
          id="vertical"
          title="Vertical mixed / dark"
          before={IMAGES.mixed}
          after={IMAGES.dark}
          orientation="vertical"
        />
        <CompareCard
          id="broken"
          title="Broken remote"
          before={IMAGES.broken}
          after={IMAGES.bright}
        />
        <Annotator src={IMAGES.mixed} id="mixed" />
        <Annotator src={IMAGES.broken} id="broken" />
      </div>
      {scene ? (
        <ImageLightbox
          src={IMAGES[scene]}
          alt={`${scene} photo`}
          onClose={() => {
            log(`lightbox-close:${scene}`);
            setLastClosed(`closed ${scene}`);
            setScene(null);
          }}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

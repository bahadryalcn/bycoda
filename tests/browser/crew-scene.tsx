import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CrewScene } from "../../src/features/sessions/ui/CrewScene";
import { newSession, type Block } from "../../src/features/sessions/model/session";
import { saveCrewGrowthEnabled } from "../../src/features/settings/model/settings";
import { languageReady } from "../../src/shared/i18n";
import { CrewSettings } from "../../src/features/settings/ui/AppearanceBehaviorSettings";
import { CODE_WIDTH, CREW_TOP } from "../../src/features/sessions/ui/crewCodeArt";
import type { CrewPlace } from "../../src/features/sessions/ui/crewLayout";
import { starWarsLayout } from "../../src/features/sessions/ui/starWarsLayout";
import type { CrewActivity } from "../../src/features/sessions/ui/crewMotion";
import { STAR_WARS_ARTWORK } from "../../src/features/sessions/ui/starWarsCrew";
import {
  starWarsMotionAt,
  type StarWarsIdentity,
} from "../../src/features/sessions/ui/starWarsMotion";
import {
  createStarWarsPainter,
  loadStarWarsCrew,
} from "../../src/features/sessions/ui/starWarsPainter";
import "../../src/styles/index.css";

export type MotionFrameOptions = {
  character: StarWarsIdentity;
  time: number;
  charge?: number;
  animate?: boolean;
  stabilizeBody?: boolean;
  state?: Partial<CrewActivity>;
};

export type MotionFrameMetadata = {
  regions: Record<"head" | "action" | "lower", readonly [number, number]>;
};

export type StarWarsStageOptions = Omit<MotionFrameOptions, "character"> & { count?: number };

declare global {
  interface Window {
    renderStarWarsFrame?: (options: MotionFrameOptions) => Promise<MotionFrameMetadata>;
    renderStarWarsStage?: (options: StarWarsStageOptions) => Promise<void>;
    starWarsFixtureLayout: (count: number, viewportWidth?: number) => CrewPlace[];
  }
}

window.starWarsFixtureLayout = starWarsLayout;

/** Deterministic fixture only: the same production loader, rig and painter as CrewScene. */
function mountMotionFixture() {
  const source = document.createElement("canvas");
  const paint = createStarWarsPainter(source);
  const canvas = document.createElement("canvas");
  canvas.id = "star-wars-motion";
  const crop = { left: -145, top: -270, width: 290, height: 286 };
  canvas.width = crop.width * 2;
  canvas.height = crop.height * 2;
  canvas.setAttribute("aria-label", "Star Wars motion frame");
  const stage = document.createElement("canvas");
  stage.id = "star-wars-stage";
  stage.width = 760;
  stage.height = 390;
  stage.hidden = true;
  stage.setAttribute("aria-label", "Star Wars crescent action frame");
  document.getElementById("root")!.append(canvas, stage);
  const ready = loadStarWarsCrew();
  window.renderStarWarsStage = async ({
    time,
    charge = 1,
    animate = true,
    count = 6,
    state = {},
  }) => {
    await ready;
    canvas.hidden = true;
    stage.hidden = false;
    const activity: CrewActivity[] = Array.from({ length: count }, () => ({
      stand: 1,
      talk: 0,
      working: true,
      ...state,
      charge,
      arrival: 1,
    }));
    paint([], activity, 1280, animate ? time : 0);
    const c = stage.getContext("2d")!;
    c.clearRect(0, 0, stage.width, stage.height);
    c.drawImage(source, 0, 0, stage.width, stage.height);
  };
  window.renderStarWarsFrame = async ({
    character,
    time,
    charge = 1,
    animate = true,
    stabilizeBody = false,
    state = {},
  }) => {
    await ready;
    canvas.hidden = false;
    stage.hidden = true;
    const seat = STAR_WARS_ARTWORK.findIndex(({ id }) => id === character);
    const activity: CrewActivity[] = STAR_WARS_ARTWORK.map((_, index) => ({
      stand: 1,
      talk: 0,
      working: true,
      ...state,
      charge,
      arrival: index === seat ? 1 : 0,
    }));
    // CrewScene freezes its clock at zero for both motion preferences and reduced motion.
    paint([], activity, 1280, animate ? time : 0);
    const place = starWarsLayout(activity.length).find(({ id }) => id === seat)!;
    const scale = source.width / CODE_WIDTH;
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    if (stabilizeBody) {
      // Undo only the rigid body transform in this verification view. Independent
      // head/arm/weapon changes remain visible in the production renderer's pixels.
      const motion = starWarsMotionAt(character, seat, animate ? time : 0, activity[seat]);
      const unit = canvas.width / crop.width;
      const pivotX = -crop.left * unit;
      const pivotY = (-224 + (226 * 150) / 160 - crop.top) * unit;
      c.translate(pivotX, pivotY);
      c.rotate((-motion.bodyAngle * Math.PI) / 180);
      c.translate(
        -pivotX - ((motion.bodyX * 150) / 160) * unit,
        -pivotY - ((motion.bodyY * 150) / 160) * unit,
      );
    }
    c.drawImage(
      source,
      (place.x + crop.left * place.scale) * scale,
      (place.y + CREW_TOP + crop.top * place.scale) * scale,
      crop.width * place.scale * scale,
      crop.height * place.scale * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    c.restore();
    const previewY = (stageY: number) =>
      Math.round(((stageY - crop.top) / crop.height) * canvas.height);
    const crown = -(STAR_WARS_ARTWORK[seat].headroom - 9);
    const halfChargeLevel = (-2 + crown) / 2 - 4;
    return {
      regions: {
        head: [previewY(crown - 28), previewY(Math.min(crown + 85, halfChargeLevel - 8))],
        action: [previewY(-190), previewY(-20)],
        lower: [previewY(-50), previewY(-8)],
      },
    };
  };
}

function Fixture() {
  const [session, setSession] = useState(() => newSession("claude", "/fixture"));
  const [background, setBackground] = useState(false);
  const [helpers, setHelpers] = useState(1);
  const [name, setName] = useState("Designer");
  const [previewContext, setPreviewContext] = useState<number | undefined>(undefined);
  const start = () =>
    setSession((previous) => ({
      ...previous,
      busy: false,
      blocks: [{ id: "first", role: "user", text: "Start designing" }],
      context: { used: 10_000, window: 200_000 },
    }));
  const useHelpers = () =>
    setSession((previous) => ({
      ...previous,
      busy: true,
      blocks: [
        { id: "first", role: "user", text: "Start designing" },
        ...Array.from({ length: helpers }, (_, id): Block => ({
          id: `designer-${id}`,
          role: "tool",
          text: "Agent",
          tool: {
            callId: `designer-${id}`,
            kind: "agent",
            status: "in_progress",
            agentContext: { used: id === 0 ? 140_000 : 80_000 },
          },
          agentRun: { name: id === 0 ? name : `Reviewer ${id}`, steps: [] },
        })),
      ],
      context: { used: 100_000, window: 200_000 },
    }));
  return (
    <main className="min-h-screen bg-background-base p-4 text-content">
      <div className="flex flex-wrap gap-3 text-xs">
        <button onClick={start}>Start session</button>
        <button onClick={useHelpers}>Use helpers</button>
        <button onClick={() => setSession((previous) => ({ ...previous, busy: false }))}>
          Finish
        </button>
        <button
          onClick={() => {
            setName("UX Designer");
            setSession((previous) => ({
              ...previous,
              blocks: previous.blocks.map((block) =>
                block.id === "designer-0"
                  ? { ...block, agentRun: { ...block.agentRun!, name: "UX Designer" } }
                  : block,
              ),
            }));
          }}
        >
          Rename
        </button>
        <button onClick={() => saveCrewGrowthEnabled(false)}>Growth off</button>
        <button onClick={() => setBackground((previous) => !previous)}>Toggle background</button>
        <label>
          Context preview
          <input
            aria-label="Context preview"
            type="number"
            min="0"
            max="100"
            value={previewContext === undefined ? "" : previewContext * 100}
            onChange={(event) =>
              setPreviewContext(
                event.target.value === "" ? undefined : Number(event.target.value) / 100,
              )
            }
          />
        </label>
        <label>
          Helpers{" "}
          <input
            aria-label="Helpers"
            type="number"
            min="1"
            max="12"
            value={helpers}
            onChange={(event) => setHelpers(Number(event.target.value))}
          />
        </label>
        <label>
          Name{" "}
          <input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      </div>
      <details>
        <summary>Crew settings</summary>
        <CrewSettings />
      </details>
      <CrewScene
        sessionId={session.id}
        session={session}
        crew={
          previewContext === undefined
            ? undefined
            : Array.from({ length: 6 }, (_, id) => ({
                role: id === 2 ? "lead" : id === 3 ? "advisor" : "subagent",
                working: id === 2 || id === 3,
                context: previewContext,
              }))
        }
        variant={background ? "background" : "hero"}
      />
    </main>
  );
}

if (new URLSearchParams(location.search).has("motion")) mountMotionFixture();
else
  void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));

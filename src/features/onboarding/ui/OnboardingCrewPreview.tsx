import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { type CrewTheme } from "../../settings/model/settings";
import {
  createCodeArtPainter,
  loadCrewSignLogo,
  type CodeArtPainter,
} from "../../sessions/ui/crewCodeArt";
import { createStarWarsPainter, loadStarWarsCrew } from "../../sessions/ui/starWarsPainter";
import type { CrewActivity } from "../../sessions/ui/crewMotion";

const CREW: CrewActivity[] = Array.from({ length: 6 }, (_, id) => ({
  role: id === 2 ? "lead" : id === 3 ? "advisor" : "subagent",
  stand: id === 2 || id === 3 ? 1 : 0,
  talk: 0,
  charge: 1,
}));

/** One still frame per option; previews don't subscribe to sessions or start animation loops. */
export function OnboardingCrewPreview({ theme }: { theme: CrewTheme }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let paint: CodeArtPainter | undefined;
    setFailed(false);
    void (theme === "star-wars" ? loadStarWarsCrew() : loadCrewSignLogo())
      .then(() => {
        if (!alive || !canvas.current) return;
        paint =
          theme === "star-wars"
            ? createStarWarsPainter(canvas.current)
            : createCodeArtPainter(canvas.current, { renderer: "canvas" });
        paint(Array(6).fill("idle"), CREW, 1280, 0);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      paint?.dispose?.();
    };
  }, [theme]);
  return (
    <div className="onboarding-crew-preview" aria-hidden="true">
      {failed ? <span>{t("Preview unavailable")}</span> : <canvas ref={canvas} />}
    </div>
  );
}

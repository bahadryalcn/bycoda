import { valueHash } from "../../../shared/lib/valueHash";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { shouldRunLoop } from "../../../shared/lib/animationGate";
import { useDecorativeMotionEnabled } from "../../settings/model/decorativeMotion";
import {
  createCodeArtPainter,
  loadCrewSignLogo,
  CODE_WIDTH,
  CODE_HEIGHT,
  CREW_TOP,
  type TeaPose,
} from "./crewCodeArt";
import {
  loadCrewGrowthEnabled,
  subscribeCrewGrowthEnabled,
  loadCrewTheme,
  subscribeCrewTheme,
} from "../../settings/model/settings";
import { crewCharge, starWarsCharacter } from "./starWarsCrew";
import { createStarWarsPainter, loadStarWarsCrew } from "./starWarsPainter";
import "./CrewScene.css";
import { useShellSessions } from "../model/sessionsStore";
import type { Session } from "../model/session";
import { crewAge, crewSeats, previewCrewSeats, type CrewSeat } from "../model/crewActivity";
import {
  type CrewAgeState,
  type CrewRole,
  crewMotionAt,
  converseWithNeighbours,
  applySmokingBreak,
  applyConversationMood,
  applyIdleLife,
} from "./crewMotion";
import { crewLayout } from "./crewLayout";
import { starWarsLayout } from "./starWarsLayout";

/** Six staggered tea sips, with long still intervals and no body movement. */
export function crewActionAt(id: number, elapsed: number): TeaPose {
  const phase = elapsed - 1500 - id * 5500;
  if (phase < 0) return "idle";
  const moment = phase % 36000;
  if (moment < 180) return "sip-low";
  if (moment < 360) return "sip-lift";
  if (moment < 540) return "sip-high";
  if (moment < 2100) return "sip";
  if (moment < 2300) return "sip-high";
  if (moment < 2500) return "sip-lift";
  if (moment < 2700) return "sip-low";
  return "idle";
}

/** How long a crew member takes to grow (or shrink, after compaction) into the next stage. */
const AGE_CHANGE_MS = 900;

type SceneProps = {
  className?: string;
  variant?: "hero" | "background";
  /** The session whose crew this is; without one every uncle sits. */
  sessionId?: string;
  /** The pane's own copy; remote panes are not in the shell store. */
  session?: Session;
  /** Previews and tests: this many seats work (lead, advisor, then subagents). */
  workingCount?: number;
  /** Previews and tests: an explicit crew. */
  crew?: readonly CrewSeat[];
};
type SeatLabel = {
  id: number;
  role: CrewRole;
  working: boolean;
  x: number;
  y: number;
  width: number;
};

/** Reserve headwear and movement room above each age, including a fading older figure. */
function labelHeight(stage: number, working: boolean, id: number): number {
  const seated = stage === 3 ? [196, 204, 214, 202, 202, 204][id % 6] : [90, 145, 200][stage];
  return seated + (working ? [20, 36, 48, 54][stage] : 0) + 8;
}

function roleText(role: CrewRole): string {
  return role === "lead" ? t("Main agent") : role === "advisor" ? t("Advisor") : t("Subagent");
}

/** Keyed by session so standing, arrival and clock state can never leak between sessions. */
export function CrewScene(props: SceneProps) {
  return <CrewStage key={props.sessionId ?? ""} {...props} />;
}

function CrewStage({
  className = "",
  variant = "hero",
  sessionId,
  session,
  workingCount: previewCount,
  crew: previewCrew,
}: SceneProps) {
  useLocale();
  const theme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const starWars = theme === "star-wars";
  const sessions = useShellSessions();
  const crew =
    previewCrew ??
    (previewCount !== undefined
      ? previewCrewSeats(previewCount)
      : crewSeats(
          sessionId,
          session ? [session, ...sessions.filter((item) => item.id !== session.id)] : sessions,
        ));
  // Off: everyone is an uncle, whatever their context.
  const growthEnabled = useSyncExternalStore(
    subscribeCrewGrowthEnabled,
    loadCrewGrowthEnabled,
    loadCrewGrowthEnabled,
  );
  const ageOf = (seat: CrewSeat | undefined) =>
    growthEnabled ? crewAge(seat?.context) : crewAge(undefined);
  const crewKey = crew
    .map((seat) => {
      const age = ageOf(seat);
      return `${seat.role}/${seat.working}/${age.stage}/${Math.round(age.growth * 20)}/${starWars ? crewCharge(seat.context, growthEnabled)?.toFixed(2) : ""}`;
    })
    .join(";");
  const crewRef = useRef(crew);
  crewRef.current = crew;
  const ageOfRef = useRef(ageOf);
  ageOfRef.current = ageOf;
  /** Last drawn stage per seat and when it changed, for the growth cross-fade. */
  const ages = useRef<{ stage: number; from?: number; changedAt: number }[]>([]);
  const [artStatus, setArtStatus] = useState<"loading" | "ready" | "error">("loading");
  const [artRetry, setArtRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setArtStatus("loading");
    void (starWars ? loadStarWarsCrew() : loadCrewSignLogo()).then(
      () => {
        if (live) setArtStatus("ready");
      },
      () => {
        if (live) setArtStatus("error");
      },
    );
    return () => {
      live = false;
    };
  }, [starWars, artRetry]);
  const workingCount = crew.filter((seat) => seat.working).length;
  const standing = useRef<number[]>(Array(6).fill(0));
  const arrivals = useRef<number[]>(Array(6).fill(1));
  const displayedCount = useRef(6);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [labels, setLabels] = useState<SeatLabel[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const startedAt = useRef<number | null>(null);
  const enabled = useDecorativeMotionEnabled();
  const [running, setRunning] = useState(false);
  const frame = starWars
    ? variant === "background"
      ? 100
      : 50
    : variant === "background"
      ? 200
      : 120;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // WebView may defer the first observer callback: use the current bounds until it arrives.
    const bounds = element.getBoundingClientRect();
    let intersects =
      typeof IntersectionObserver === "undefined" ||
      (bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.bottom > 0 &&
        bounds.top < window.innerHeight);
    const update = () => {
      setViewportWidth(element.clientWidth || 1280);
      setRunning(
        shouldRunLoop({
          enabled,
          documentHidden: document.hidden,
          visible: intersects,
          sized: element.clientWidth > 0 && element.clientHeight > 0,
        }),
      );
    };
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersects = entry.isIntersecting;
            update();
          });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    intersection?.observe(element);
    resize?.observe(element);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      intersection?.disconnect();
      resize?.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const draw = starWars ? createStarWarsPainter(surface) : createCodeArtPainter(surface);
    let previous: number | undefined;
    let previousLabels: number | undefined;
    let lastFrame = performance.now();
    const paint = (elapsed: number) => {
      const seats = crewRef.current;
      const seatWorking = (id: number) => seats[id]?.working === true;
      const now = performance.now();
      const step = running ? Math.min(1, (now - lastFrame) / 600) : 1;
      lastFrame = now;
      // Cached SVG joints run at 20/10 Hz; the heavier code art stays at 8/5 Hz.
      // Both use this shared clock and skip unchanged frames.
      const expressionTime = Math.floor(elapsed / frame) * frame;
      displayedCount.current = Math.max(displayedCount.current, seats.length, 6);
      const activity = Array.from({ length: displayedCount.current }, (_, id) => {
        const target = seatWorking(id) ? 1 : 0;
        const current = standing.current[id] ?? (id >= 6 ? 1 : 0);
        standing.current[id] =
          target > current ? Math.min(target, current + step) : Math.max(target, current - step);
        const arrival = arrivals.current[id] ?? 0;
        const arrivalStep = running ? step * 0.65 : 1;
        arrivals.current[id] =
          id < 6
            ? 1
            : target
              ? Math.min(1, arrival + arrivalStep)
              : Math.max(0, arrival - arrivalStep);
        const goal = ageOfRef.current(seats[id]);
        let record = ages.current[id];
        if (!record) record = ages.current[id] = { stage: goal.stage, changedAt: -Infinity };
        else if (record.stage !== goal.stage)
          record = ages.current[id] = { stage: goal.stage, from: record.stage, changedAt: now };
        // Quantized to the expression clock, like every other motion value.
        const change = running
          ? Math.min(1, (Math.floor((now - record.changedAt) / frame) * frame) / AGE_CHANGE_MS)
          : 1;
        const age: CrewAgeState =
          change < 1 && record.from !== undefined
            ? {
                stage: goal.stage,
                growth: Math.round(goal.growth * 20) / 20,
                from: record.from,
                change,
              }
            : { stage: goal.stage, growth: Math.round(goal.growth * 20) / 20 };
        return {
          ...crewMotionAt(
            id,
            expressionTime,
            id >= 6 ? 1 : standing.current[id],
            running && !!target && arrivals.current[id] > 0.95,
          ),
          arrival: arrivals.current[id],
          role: seats[id]?.role ?? ("subagent" as CrewRole),
          working: !!target,
          charge: starWars ? crewCharge(seats[id]?.context, growthEnabled) : undefined,
          age,
        };
      });
      while (
        displayedCount.current > Math.max(6, seats.length) &&
        arrivals.current[displayedCount.current - 1] === 0
      )
        displayedCount.current--;
      activity.length = displayedCount.current;
      const layout = (starWars ? starWarsLayout : crewLayout)(
        displayedCount.current,
        viewportWidth,
      );
      if (running)
        converseWithNeighbours(
          activity,
          layout.filter((place) => seatWorking(place.id)),
          expressionTime,
        );
      activity.forEach((state, id) => {
        applyConversationMood(state, id, expressionTime, running && seatWorking(id));
        if (!starWars) applySmokingBreak(state, id, expressionTime, running);
        applyIdleLife(state, id, expressionTime, running);
      });
      // A working uncle stands and never sips; a seated one only sips tea or smokes.
      const actions = Array.from({ length: displayedCount.current }, (_, id) =>
        activity[id].working || activity[id].stand > 0 || activity[id].smoking
          ? ("idle" as const)
          : crewActionAt(id, elapsed),
      );
      const shown: SeatLabel[] = layout
        .filter((place) => place.id < 6 || (activity[place.id]?.arrival ?? 0) > 0.95)
        .map((place) => {
          const state = activity[place.id];
          const age = state.age!;
          const character = starWars ? starWarsCharacter(place.id, state.role) : undefined;
          // Labels stay above the full action, including Yoda's airborne pose.
          const height = character
            ? character.headroom + (character.id === "yoda" ? 32 : 8)
            : Math.max(
                labelHeight(age.stage, !!state.working, place.id),
                labelHeight(age.from ?? age.stage, !!state.working, place.id),
              );
          const neighbours = layout.filter((other) => other.id !== place.id);
          const spacing = Math.min(...neighbours.map((other) => Math.abs(other.x - place.x)));
          return {
            id: place.id,
            role: state.role!,
            working: !!state.working,
            x: Math.round(place.x),
            y: Math.round(place.y - height * place.scale),
            width: Math.min(spacing - 8, 2 * place.x, 2 * (CODE_WIDTH - place.x)),
          };
        });
      const labelSignature = valueHash(shown);
      if (labelSignature !== previousLabels) {
        previousLabels = labelSignature;
        setLabels(shown);
      }
      const steamTime = running ? expressionTime : 0;
      const signature = valueHash([actions, activity, steamTime]);
      if (signature === previous) return;
      previous = signature;
      draw(actions, activity, viewportWidth, steamTime);
    };
    if (!running) {
      paint(0);
      return () => draw.dispose?.();
    }
    startedAt.current ??= performance.now();
    const start = startedAt.current;
    paint(performance.now() - start);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      paint(performance.now() - start);
      timer = setTimeout(tick, frame / 2);
    };
    timer = setTimeout(tick, frame / 2);
    return () => {
      clearTimeout(timer);
      draw.dispose?.();
    };
  }, [running, crewKey, viewportWidth, frame, artStatus, starWars, growthEnabled]);
  return (
    <div
      ref={container}
      className={`crew-scene crew-scene--${variant} ${className}`}
      data-variant={variant}
      data-theme={theme}
      data-art-status={artStatus}
      data-motion={running ? "running" : "still"}
      data-working-count={workingCount}
      role={variant === "hero" ? (artStatus === "error" ? "group" : "img") : undefined}
      aria-label={
        variant === "hero"
          ? starWars
            ? t(
                "Star Wars crew: Obi-Wan leads and Yoda advises. {p0} crew members, {p1} working. Color and meters show context usage, not task progress.",
                { p0: crew.length, p1: workingCount },
              )
            : t(
                "{p0} crew members beneath the bycoda sign: the main agent, the advisor and subagents; {p1} working and standing. Monochrome binary code art.",
                { p0: crew.length, p1: workingCount },
              )
          : undefined
      }
      aria-hidden={variant === "background" ? true : undefined}
    >
      {starWars && (
        <div className="crew-scene__theme-title" aria-hidden="true">
          <span>STAR WARS</span>
          <small>{t("Agent crew")}</small>
        </div>
      )}
      <div className="crew-scene__stage">
        {starWars && artStatus !== "ready" && (
          <div className="crew-scene__status" role="status">
            {artStatus === "loading" ? (
              t("Loading crew…")
            ) : (
              <button type="button" onClick={() => setArtRetry((value) => value + 1)}>
                {t("Retry loading crew")}
              </button>
            )}
          </div>
        )}
        <canvas
          key="code-art-layout-v2"
          ref={canvas}
          width={CODE_WIDTH}
          height={CODE_HEIGHT}
          aria-hidden="true"
        />
        <div className="crew-scene__labels" aria-hidden="true">
          {labels.map((label) => {
            const character = starWarsCharacter(label.id, label.role);
            const charge = crewCharge(crew[label.id]?.context, growthEnabled);
            const percent = charge === undefined ? undefined : Math.round(charge * 100);
            const displayName =
              crew[label.id]?.name || (starWars ? character.name : roleText(label.role));
            return (
              <span
                key={label.id}
                className="crew-scene__label"
                data-role={label.role}
                data-working={label.working ? "true" : "false"}
                data-age={ageOf(crew[label.id]).stage}
                data-character={starWars ? character.id : undefined}
                data-charge={starWars && growthEnabled ? (percent ?? "unknown") : undefined}
                title={
                  starWars
                    ? `${displayName} · ${character.name} · ${roleText(label.role)}${growthEnabled ? ` · ${percent === undefined ? t("Context unknown") : t("Context: {p0}%", { p0: percent })}` : ""}`
                    : displayName
                }
                style={{
                  insetInlineStart: `${(label.x / CODE_WIDTH) * 100}%`,
                  insetBlockStart: `${((label.y + CREW_TOP) / CODE_HEIGHT) * 100}%`,
                  inlineSize: `${(label.width / CODE_WIDTH) * 100}%`,
                }}
              >
                {starWars ? (
                  <>
                    <span className="crew-scene__name">{displayName}</span>
                    <span className="crew-scene__detail">
                      {roleText(label.role)}
                      {growthEnabled ? ` · ${percent === undefined ? "—" : `${percent}%`}` : ""}
                    </span>
                    {growthEnabled && (
                      <span className="crew-scene__meter">
                        <span
                          style={{
                            inlineSize: `${percent ?? 0}%`,
                            backgroundColor: character.accent,
                          }}
                        />
                      </span>
                    )}
                  </>
                ) : (
                  displayName
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

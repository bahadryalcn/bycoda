/** Code-art pacing uncle. A pixel silhouette with a dark rim stays legible at 32 px on both themes. */
export type PacingPose = {
  x: number;
  dir: number;
  walk: boolean;
  phase: number;
};
export const PACING_STEPS = [
  20, -10, 5, -20, 40, -15, 30, -10, 50, -20, 15, -35, 60, -10, 25, -80,
] as const;
export const PACING_STEP_SECONDS = 0.34;
const PAUSE_SECONDS = 0.28;
const TURN_SECONDS = 0.3;
type PacingLeg = {
  from: number;
  to: number;
  dir: number;
  duration: number;
  steps: number;
};

/** The actual rail width determines the route; edge turns shorten a requested run. */
export function createPacingRoute(span: number): PacingLeg[] {
  if (span <= 0) return [];
  const stride = Math.min(16, Math.max(4, span / 50));
  const legs: PacingLeg[] = [];
  let x = 0;
  const add = (target: number) => {
    const to = Math.min(span, Math.max(0, target));
    if (Math.abs(to - x) < 0.001) return;
    const steps = Math.abs(to - x) / stride;
    legs.push({
      from: x,
      to,
      dir: Math.sign(to - x),
      steps,
      duration: steps * PACING_STEP_SECONDS,
    });
    x = to;
  };
  for (const steps of PACING_STEPS) add(x + steps * stride);
  // Walk back to the starting edge instead of teleporting when the route repeats.
  add(0);
  return legs;
}

export function pacingPose(t: number, span = 844): PacingPose {
  const legs = createPacingRoute(span);
  if (!legs.length) return { x: 0, dir: 1, walk: false, phase: 0 };
  const cycle = legs.reduce(
    (sum, leg, i) =>
      sum +
      leg.duration +
      PAUSE_SECONDS +
      (leg.dir !== legs[(i + 1) % legs.length].dir ? TURN_SECONDS : 0),
    0,
  );
  let moment = ((t % cycle) + cycle) % cycle;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const next = legs[(i + 1) % legs.length];
    if (moment < leg.duration)
      return {
        x: (leg.from + ((leg.to - leg.from) * moment) / leg.duration) / span,
        dir: leg.dir,
        walk: true,
        phase: (moment / PACING_STEP_SECONDS) * Math.PI,
      };
    moment -= leg.duration;
    if (moment < PAUSE_SECONDS) return { x: leg.to / span, dir: leg.dir, walk: false, phase: 0 };
    moment -= PAUSE_SECONDS;
    if (next.dir !== leg.dir) {
      if (moment < TURN_SECONDS)
        return {
          x: leg.to / span,
          dir: leg.dir * Math.cos((moment / TURN_SECONDS) * Math.PI),
          walk: false,
          phase: 0,
        };
      moment -= TURN_SECONDS;
    }
  }
  return { x: 0, dir: 1, walk: false, phase: 0 };
}
type Rect = [x: number, y: number, w: number, h: number, color: string];
const C = {
  rim: "rgba(18, 14, 10, 0.88)",
  cap: "#6b5744",
  capTop: "#8a7259",
  brim: "#45382c",
  hair: "#b9b3aa",
  skin: "#efbb92",
  skinShade: "#cf926a",
  eye: "#2a211b",
  moustache: "#3a2f28",
  moustacheTip: "#77695d",
  shirt: "#ece6d8",
  cardigan: "#b5853f",
  cardiganShade: "#8b622b",
  cardiganLight: "#d3a35c",
  sleeve: "#9a6e31",
  button: "#4a3520",
  trousers: "#5f6677",
  trousersFar: "#474d5b",
  shoe: "#2c2420",
  bead: "#f0a92e",
  beadLit: "#ffe08a",
};
const glyphs = ["const", "=>", "{}", "if", "();", "let", "[]", "0110", "</>"];

/** Sprite grid is 24 x 32 units facing right; feet rest on y = 32, one unit above the bar edge. */
function sprite(step: number, walk: boolean) {
  const bob = walk ? (1 - Math.abs(step)) * 0.8 : 0;
  const legs: Rect[] = [];
  const reach = walk ? step * 3 : 0;
  const leg = (hip: number, offset: number, color: string) => {
    const lift = walk && offset * step > 0 && Math.abs(step) < 0.85 ? 1 : 0;
    legs.push(
      [hip + offset / 2, 24, 3, 4, color],
      [hip + offset, 27.5, 3, 3 - lift, color],
      [hip + offset, 30 - lift, 4, 2, C.shoe],
    );
  };
  leg(9.5, -reach, C.trousersFar);
  leg(12, reach, C.trousers);
  const y = (rects: Rect[]): Rect[] => rects.map(([x, top, w, h, c]) => [x, top - bob, w, h, c]);
  const body = y([
    // Stooped back, cardigan and a comfortably round belly.
    [8, 16, 9, 9.5, C.cardigan],
    [7, 17, 1, 7, C.cardiganShade],
    [8, 16, 2, 9.5, C.cardiganShade],
    [17, 18, 2, 7, C.cardigan],
    [19, 19.5, 1, 4.5, C.cardigan],
    [17, 18.5, 1.5, 2, C.cardiganLight],
    [14, 16, 2.5, 2, C.shirt],
    [15, 18, 1, 1, C.shirt],
    [17.5, 20.5, 1, 1, C.button],
    [18, 23, 1, 1, C.button],
    // Flat cap, grey sideburn, big nose and a heavy moustache.
    [10, 15, 5, 1.5, C.skinShade],
    [8, 8, 8.5, 7.5, C.skin],
    [16.5, 9, 1, 5, C.skin],
    [17, 10, 1.5, 2.2, C.skinShade],
    [8, 8, 1.5, 4.5, C.hair],
    [9.5, 9.5, 1.5, 2.5, C.skinShade],
    [14.5, 9.5, 1, 1, C.eye],
    [12.5, 12.2, 6, 1.8, C.moustache],
    [12.5, 14, 1, 1, C.moustacheTip],
    [18, 13.2, 1, 1, C.moustacheTip],
    [8, 4, 8, 1.5, C.capTop],
    [7, 5.5, 10, 2, C.cap],
    [7, 7.5, 9.5, 1, C.brim],
    [15, 7, 4.5, 1.5, C.brim],
  ]);
  // Elbow bent backward, hands clasped at the small of the back.
  const arm = y([
    [9, 17, 3.5, 3, C.sleeve],
    [6.5, 19, 3.5, 3, C.sleeve],
    [5.5, 21.5, 3.5, 2, C.sleeve],
    [4.5, 22.5, 3, 2.5, C.skin],
  ]);
  return { legs, body, arm, bob };
}
const textured = new Set([C.cardigan, C.cardiganShade, C.sleeve, C.trousers, C.trousersFar]);
function character(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  scale: number,
  p: PacingPose,
  elapsed: number,
) {
  const step = p.walk ? Math.sin(p.phase) : 0;
  const { legs, body, arm, bob } = sprite(step, p.walk);
  const all = [...legs, ...body, ...arm];
  ctx.save();
  ctx.translate(x, baseline);
  // Soft ground shadow keeps him anchored to the bar.
  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.beginPath();
  ctx.ellipse(0, -1.2, 7 * scale, 1.2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.scale(scale * p.dir, scale);
  ctx.translate(-12, -33);
  // A one-unit dark rim around the whole silhouette, then the arm gets its own inner rim.
  ctx.fillStyle = C.rim;
  for (const [rx, ry, w, h] of all) ctx.fillRect(rx - 1, ry - 1, w + 2, h + 2);
  const fill = (rects: Rect[]) => {
    for (const [rx, ry, w, h, c] of rects) {
      ctx.fillStyle = c;
      ctx.fillRect(rx, ry, w, h);
    }
  };
  fill(legs);
  fill(body);
  ctx.fillStyle = C.rim;
  for (const [rx, ry, w, h] of arm) ctx.fillRect(rx - 0.5, ry - 0.5, w + 1, h + 1);
  fill(arm);
  // Clothing is woven from real code glyphs; they read as texture small and as code up close.
  const cloth = new Path2D();
  for (const [rx, ry, w, h, c] of all) if (textured.has(c)) cloth.rect(rx, ry, w, h);
  ctx.save();
  ctx.clip(cloth);
  ctx.font = "2.2px monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255, 244, 220, 0.3)";
  for (let row = 0; row < 8; row++)
    ctx.fillText(
      glyphs
        .slice(row % 3)
        .concat(glyphs)
        .join(" "),
      2 - (row % 2) * 1.5,
      15 + row * 2.2,
    );
  ctx.restore();
  // Amber tespih hangs from the clasped hands; idle hands keep counting beads.
  ctx.save();
  ctx.translate(6, 25 - bob);
  ctx.rotate(p.walk ? Math.sin(p.phase - 0.6) * 0.32 : Math.sin(elapsed * 1.7) * 0.06);
  const beads = 12;
  const counted = Math.floor(elapsed * 4) % beads;
  for (let i = 0; i < beads; i++) {
    const angle = -Math.PI / 2 + (i / beads) * Math.PI * 2;
    const bx = Math.cos(angle) * 1.7 - 0.5;
    const by = 2.6 + Math.sin(angle) * 2.6;
    ctx.fillStyle = C.rim;
    ctx.fillRect(bx - 0.5, by - 0.5, 2, 2);
    ctx.fillStyle = !p.walk && i === counted ? C.beadLit : C.bead;
    ctx.fillRect(bx, by, 1, 1);
  }
  ctx.fillStyle = C.bead;
  ctx.fillRect(-0.7, 5.6, 1, 2.2);
  ctx.restore();
  ctx.restore();
}

export function drawPacingUncle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsed: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const scale = height / 32;
  const span = Math.max(0, width - 36);
  const p = pacingPose(elapsed, span);
  // Snap to half pixels so the sprite stays crisp while it walks.
  const x = Math.round(((width - span) / 2 + p.x * span) * 2) / 2;
  character(ctx, x, height, scale, p, elapsed);
}

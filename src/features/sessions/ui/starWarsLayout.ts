import type { CrewPlace } from "./crewLayout";

/** A single deep crescent in the scene's fixed 760px canvas coordinates. */
export function starWarsLayout(count: number, _viewportWidth = 1280): CrewPlace[] {
  const total = Math.max(6, Number.isFinite(count) ? Math.floor(count) : 6);
  const order = Array.from({ length: 6 }, (_, id) => id);
  for (let id = 6; id < total; id++) id % 2 === 0 ? order.unshift(id) : order.push(id);

  // Keep the six familiar faces together, with Obi-Wan and Yoda at the rear.
  // Equal horizontal spacing leaves their faces readable along the entire arc.
  // The stage scales as a whole in narrow panes, so its composition stays intact.
  const zoom = 6 / total;
  return order.map((id, index) => {
    const offset = (2 * index) / (total - 1) - 1;
    const forward = offset * offset;
    return {
      id,
      // Allow up to 120 local units of weapon sweep on the right, 100 on the left.
      x: 380 + 280 * offset,
      // Floor = y + CREW_TOP (70): center 216, wings 312, with room above for labels.
      y: 146 + 96 * forward,
      scale: zoom * (0.74 + 0.04 * forward),
    };
  });
}

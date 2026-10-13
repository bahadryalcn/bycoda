export type CrewPlace = { id: number; x: number; y: number; scale: number };
/** A single crescent, fitted as a whole camera view; never stack people in rows. */
export function crewLayout(count: number, _viewportWidth = 1280): CrewPlace[] {
  const total = Math.max(6, Math.floor(count));
  if (total === 6)
    return [
      [65, 312],
      [185, 292],
      [305, 275],
      [455, 275],
      [575, 292],
      [695, 312],
    ].map(([x, y], id) => ({ id, x, y, scale: 1 }));
  // Alternate left/right arrivals; keep the original six in the centre of the group.
  const order = Array.from({ length: 6 }, (_, id) => id);
  for (let id = 6; id < total; id++) id % 2 === 0 ? order.unshift(id) : order.push(id);
  // A deeper crescent for crowds: the middle sits farther back (higher, slightly smaller),
  // so neighbours may overlap a little at the shoulders without ever forming a second row.
  // Painters draw back-to-front by y, so overlaps stay correct.
  // Spacing tightens one step per arrival, so the group only ever zooms out.
  const spacing = total > 6 ? Math.max(94, 118 - (total - 7) * 4) : 132;
  const tableIndex = order.indexOf(2);
  const worldWidth = total * spacing + 30 + (total > 6 ? 36 : 0);
  const scale = Math.min(1, 760 / worldWidth);
  const depth = Math.min(70, 18 + total * 3);
  return order.map((id, index) => {
    const offset = (index - (total - 1) / 2) / ((total - 1) / 2);
    const back = 1 - offset * offset;
    const perspective = 1 - 0.1 * back;
    const worldX =
      spacing / 2 + (total > 6 ? 18 : 0) + index * spacing + (index > tableIndex ? 30 : 0);
    return { id, x: worldX * scale, y: 314 - depth * back, scale: scale * perspective };
  });
}

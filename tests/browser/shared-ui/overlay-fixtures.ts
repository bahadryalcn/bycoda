// Session 5 overlay/menu/feedback/media fixtures share one suite. OVERLAY_FIXTURE
// selects one page with its own port and build directory so independent owners
// can build and run their page without waiting for, or breaking, the others.
export const overlayFixtures = { popups: 1531, menus: 1532, feedback: 1533, media: 1534 };

export function overlayFixture(env: Record<string, string | undefined> = process.env) {
  const name = env.OVERLAY_FIXTURE;
  if (!name) return { names: Object.keys(overlayFixtures), port: 1530, id: "all" };
  if (!Object.hasOwn(overlayFixtures, name)) throw new Error(`Unknown OVERLAY_FIXTURE: ${name}`);
  return { names: [name], port: overlayFixtures[name as keyof typeof overlayFixtures], id: name };
}

import { describe, expect, it } from "vitest";
import { AVATAR_GRID, isAvatarEye, memberAvatarRects } from "./memberAvatarArt";
import {
  AVATAR_ACCESSORY,
  AVATAR_FACE,
  AVATAR_HEADWEAR,
  AVATAR_OUTFIT,
  AVATAR_PALETTE_COUNT,
  seededAvatarTraits,
  type MemberAvatarTraits,
} from "./memberAvatarTraits";

const base: MemberAvatarTraits = {
  headwear: "flat-cap",
  face: "walrus",
  glasses: false,
  outfit: "cardigan",
  palette: 0,
  accessory: "none",
};

describe("memberAvatarRects", () => {
  it("keeps every rect of every trait combination inside the grid", () => {
    const outside: string[] = [];
    for (const headwear of AVATAR_HEADWEAR)
      for (const face of AVATAR_FACE)
        for (const outfit of AVATAR_OUTFIT)
          for (const accessory of AVATAR_ACCESSORY)
            for (const glasses of [false, true])
              for (let palette = 0; palette < AVATAR_PALETTE_COUNT; palette++) {
                const traits = { headwear, face, glasses, outfit, palette, accessory };
                for (const [x, y, w, h, color] of memberAvatarRects(traits))
                  if (
                    x < 0 ||
                    y < 0 ||
                    w <= 0 ||
                    h <= 0 ||
                    x + w > AVATAR_GRID ||
                    y + h > AVATAR_GRID ||
                    !color
                  )
                    outside.push(JSON.stringify(traits));
              }
    expect(outside).toEqual([]);
  });

  it("draws different parts differently", () => {
    const key = (t: MemberAvatarTraits) => JSON.stringify(memberAvatarRects(t));
    for (const headwear of AVATAR_HEADWEAR.slice(1))
      expect(key({ ...base, headwear })).not.toBe(key(base));
    for (const face of AVATAR_FACE.slice(1)) expect(key({ ...base, face })).not.toBe(key(base));
    expect(key({ ...base, glasses: true })).not.toBe(key(base));
    expect(key({ ...base, palette: 3 })).not.toBe(key(base));
    expect(key({ ...base, accessory: "key" })).not.toBe(key(base));
  });

  it("is deterministic", () => {
    const traits = seededAvatarTraits("member-7");
    expect(memberAvatarRects(traits)).toEqual(memberAvatarRects({ ...traits }));
  });

  it("blinks by changing only the eye rects", () => {
    const open = memberAvatarRects(base);
    const closed = memberAvatarRects(base, { blink: true });
    expect(closed).toHaveLength(open.length);
    const changed = open.filter((rect, i) => rect.join() !== closed[i].join());
    expect(changed).toHaveLength(2);
    expect(changed.every(isAvatarEye)).toBe(true);
  });

  it("keeps both eyes visible behind glasses", () => {
    for (const headwear of AVATAR_HEADWEAR)
      for (const face of AVATAR_FACE)
        for (const accessory of AVATAR_ACCESSORY) {
          const rects = memberAvatarRects({ ...base, headwear, face, accessory, glasses: true });
          const eyes = rects.flatMap((rect, i) => (isAvatarEye(rect) ? [i] : []));
          expect(eyes).toHaveLength(2);
          for (const i of eyes) {
            const [x, y, w, h] = rects[i];
            for (const [ox, oy, ow, oh] of rects.slice(i + 1))
              expect(ox < x + w && x < ox + ow && oy < y + h && y < oy + oh).toBe(false);
          }
        }
  });
});

const THEMES = ["classic", "star-wars", "lotr", "matrix"] as const;
const bodyColor = (rects: ReturnType<typeof memberAvatarRects>) => {
  const counts = new Map<string, number>();
  for (const [, y, w, h, c] of rects) if (y >= 19) counts.set(c, (counts.get(c) ?? 0) + w * h);
  return JSON.stringify([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]);
};

describe.each(THEMES)("memberAvatarRects theme %s", (theme) => {
  it("stays inside the grid and is deterministic", () => {
    for (let i = 0; i < 40; i++) {
      const traits = seededAvatarTraits(`member-${i}`);
      const rects = memberAvatarRects(traits, { theme });
      expect(rects).toEqual(memberAvatarRects({ ...traits }, { theme }));
      for (const [x, y, w, h, color] of rects) {
        expect(x >= 0 && y >= 0 && w > 0 && h > 0).toBe(true);
        expect(x + w <= AVATAR_GRID && y + h <= AVATAR_GRID).toBe(true);
        expect(color).toBeTruthy();
      }
    }
  });

  it("keeps two eyes that nothing is drawn over, and blinks only them", () => {
    for (const glasses of [false, true])
      for (const headwear of AVATAR_HEADWEAR)
        for (const face of AVATAR_FACE)
          for (const accessory of AVATAR_ACCESSORY) {
            const traits = { ...base, glasses, headwear, face, accessory };
            const rects = memberAvatarRects(traits, { theme });
            const eyes = rects.flatMap((rect, i) => (isAvatarEye(rect) ? [i] : []));
            expect(eyes).toHaveLength(2);
            for (const i of eyes) {
              const [x, y, w, h] = rects[i];
              for (const [ox, oy, ow, oh] of rects.slice(i + 1))
                expect(ox < x + w && x < ox + ow && oy < y + h && y < oy + oh).toBe(false);
            }
            const closed = memberAvatarRects(traits, { theme, blink: true });
            const changed = rects.filter((rect, i) => rect.join() !== closed[i].join());
            expect(changed).toHaveLength(2);
            expect(changed.every(isAvatarEye)).toBe(true);
          }
  });

  it("gives each palette its own body color and each accessory its own rects", () => {
    const colors = new Set<string>();
    for (let palette = 0; palette < AVATAR_PALETTE_COUNT; palette++)
      colors.add(bodyColor(memberAvatarRects({ ...base, palette }, { theme })));
    expect(colors.size).toBe(AVATAR_PALETTE_COUNT);
    const key = (accessory: MemberAvatarTraits["accessory"]) =>
      JSON.stringify(memberAvatarRects({ ...base, accessory }, { theme }));
    for (const accessory of AVATAR_ACCESSORY.slice(1)) expect(key(accessory)).not.toBe(key("none"));
  });

  it("draws every headwear, face and glasses differently", () => {
    const key = (t: MemberAvatarTraits) => JSON.stringify(memberAvatarRects(t, { theme }));
    for (const headwear of AVATAR_HEADWEAR.slice(1))
      expect(key({ ...base, headwear })).not.toBe(key(base));
    for (const face of AVATAR_FACE.slice(1)) expect(key({ ...base, face })).not.toBe(key(base));
    expect(key({ ...base, glasses: true })).not.toBe(key(base));
  });
});

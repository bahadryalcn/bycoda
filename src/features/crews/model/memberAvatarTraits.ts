/**
 * A crew member's look: a few named parts, stored on the Host as owner choices and
 * otherwise derived from a stable seed. The same seed gives the same member in every
 * crew and on every device; drawing per scene theme maps these parts to that theme.
 */
export const AVATAR_HEADWEAR = ["flat-cap", "takke", "beret", "bald", "grey-hair"] as const;
export const AVATAR_FACE = ["walrus", "bushy", "short-beard", "white-beard", "shaven"] as const;
export const AVATAR_OUTFIT = ["cardigan", "vest", "jacket"] as const;
export const AVATAR_ACCESSORY = [
  "none",
  "tespih",
  "magnifier",
  "brush",
  "notebook",
  "key",
  "wrench",
  "pen",
] as const;
/** Outfit color sets; the drawing owns the actual palette entries. */
export const AVATAR_PALETTE_COUNT = 6;

export type MemberAvatarTraits = {
  headwear: (typeof AVATAR_HEADWEAR)[number];
  face: (typeof AVATAR_FACE)[number];
  glasses: boolean;
  outfit: (typeof AVATAR_OUTFIT)[number];
  /** 0..AVATAR_PALETTE_COUNT-1 */
  palette: number;
  accessory: (typeof AVATAR_ACCESSORY)[number];
};

/** Owner choices saved on the member; any missing part comes from the seed. */
export type MemberAvatarChoice = Partial<MemberAvatarTraits>;

/** FNV-1a, 32 bit: small, stable across platforms and releases. */
export function avatarHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pick<T>(options: readonly T[], hash: number, shift: number): T {
  return options[(hash >>> shift) % options.length];
}

/** Every part derived from the seed; `salt` moves to the next look on a collision. */
export function seededAvatarTraits(seed: string, salt = 0): MemberAvatarTraits {
  const a = avatarHash(salt ? `${seed}#${salt}` : seed);
  const b = avatarHash(`${seed}~${salt}`);
  return {
    headwear: pick(AVATAR_HEADWEAR, a, 0),
    face: pick(AVATAR_FACE, a, 8),
    glasses: ((a >>> 16) & 3) === 0,
    outfit: pick(AVATAR_OUTFIT, a, 20),
    palette: (b >>> 0) % AVATAR_PALETTE_COUNT,
    accessory: pick(AVATAR_ACCESSORY, b, 8),
  };
}

/** The seed of a member: its library profile when it has one, so copies look alike. */
export function memberAvatarSeed(member: { id: string; source?: { id: string } }): string {
  return member.source?.id ?? member.id;
}

export function resolveMemberAvatar(
  seed: string,
  choice?: MemberAvatarChoice,
  fallback?: MemberAvatarChoice,
  salt = 0,
): MemberAvatarTraits {
  return { ...seededAvatarTraits(seed, salt), ...fallback, ...choice };
}

const signature = (t: MemberAvatarTraits) =>
  `${t.headwear}|${t.face}|${+t.glasses}|${t.outfit}|${t.palette}`;

/**
 * Looks for one crew: members without saved choices step to the next seeded look
 * until no two members share head, face, glasses, outfit and colors. Saved choices
 * are kept even when they collide; the owner picked them.
 */
export function resolveTeamAvatars(
  members: readonly {
    id: string;
    source?: { id: string };
    avatar?: MemberAvatarChoice;
  }[],
  fallbacks: Readonly<Record<string, MemberAvatarChoice>> = {},
): Map<string, MemberAvatarTraits> {
  const result = new Map<string, MemberAvatarTraits>();
  const used = new Set<string>();
  const ordered = [...members].sort(
    (x, y) => Number(!x.avatar) - Number(!y.avatar) || x.id.localeCompare(y.id),
  );
  for (const member of ordered) {
    const seed = memberAvatarSeed(member);
    let traits = resolveMemberAvatar(seed, member.avatar, fallbacks[seed]);
    if (!member.avatar && !fallbacks[seed]) {
      for (let salt = 1; used.has(signature(traits)) && salt < 64; salt++)
        traits = resolveMemberAvatar(seed, undefined, undefined, salt);
    }
    used.add(signature(traits));
    result.set(member.id, traits);
  }
  return result;
}

import { PROJECT_CODE_ICONS, type ProjectIconCategory } from "./projectCodeIcons";
/** Colored code-art project symbols; persisted selection IDs remain stable. */
export const MASCOT_GRID = 24;
type MascotRows = readonly string[];
export type ProjectMascot = {
  name: string;
  label: string;
  color: string;
  highlight: string;
  category: ProjectIconCategory;
  keywords: string;
  /** Compatibility fields for older renderers; sigils are vector paths. */
  rest: MascotRows;
  talk: MascotRows;
  restPath: string;
  talkPath: string;
};

/** Old saved names resolve to new shapes, never to the old arcade characters. */
const LEGACY_SIGILS: Record<string, string> = {
  invader: "weave",
  ghost: "orbit",
  robot: "bridge",
  cat: "link",
  skull: "compass",
  crab: "union",
  mushroom: "sprout",
  rocket: "compass",
  dino: "bridge",
  frog: "braid",
};

export const PROJECT_MASCOTS: readonly ProjectMascot[] = Object.keys(PROJECT_CODE_ICONS).map(
  (name) => {
    const { path, ...appearance } = PROJECT_CODE_ICONS[name];
    return {
      name,
      ...appearance,
      rest: [],
      talk: [],
      restPath: path,
      talkPath: path,
    };
  },
);

// Adding choices must not silently change icons for projects without a saved pick.
export const DEFAULT_PROJECT_MASCOT_NAMES = [
  "weave",
  "bridge",
  "orbit",
  "union",
  "link",
  "compass",
  "braid",
  "sprout",
] as const;

function searchable(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
export function filterProjectMascots(
  query: string,
  category: ProjectIconCategory | "All" = "All",
): readonly ProjectMascot[] {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  return PROJECT_MASCOTS.filter(
    (icon) =>
      (category === "All" || icon.category === category) &&
      terms.every((term) => searchable(`${icon.label} ${icon.keywords}`).includes(term)),
  );
}

/** Migrate a persisted selection without depending on a particular project hash. */
export function normalizeProjectMascotName(name: string | null | undefined): string | null {
  if (!name) return null;
  const resolved = Object.prototype.hasOwnProperty.call(LEGACY_SIGILS, name)
    ? LEGACY_SIGILS[name]
    : name;
  return PROJECT_MASCOTS.some((sigil) => sigil.name === resolved) ? resolved : null;
}

/** Stable project assignment; explicit saved selections retain a new counterpart. */
export function projectMascot(project: string, name?: string | null): ProjectMascot {
  const resolvedName = normalizeProjectMascotName(name);
  const chosen = PROJECT_MASCOTS.find((sigil) => sigil.name === resolvedName);
  if (chosen) return chosen;
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 131 + project.charCodeAt(i)) >>> 0;
  return PROJECT_MASCOTS.find(
    (icon) =>
      icon.name === DEFAULT_PROJECT_MASCOT_NAMES[hash % DEFAULT_PROJECT_MASCOT_NAMES.length],
  )!;
}

import { expect, it } from "vitest";
import {
  normalizeDesignMetadata,
  designLook,
  designIsCurrent,
  followSavedLibrary,
  type DesignDraft,
} from "./designs";
import { authoredSceneSource, packOfflineScene } from "./designSource";

it("roundtrips authored source without sending the bundled library back to the model", () => {
  const source = "<style>body{margin:0}</style><script>THREE.Scene</script>";
  const html = packOfflineScene(source, "var THREE={};");
  expect(authoredSceneSource(html)).toBe(source);
  expect(authoredSceneSource("<b>old imported scene</b>")).toBe("<b>old imported scene</b>");
  expect(() => packOfflineScene("x".repeat(120001), "")).toThrow("120000");
});

it("keeps background creations from carrying unrelated theme or file preferences", () => {
  const normalized = normalizeDesignMetadata({
    name: "  Lake  ",
    kind: "scene",
    prompt: "Dusk",
    look: {
      hue: 180,
      image: {
        scope: "all",
        emptyOpacity: 0.3,
        sessionOpacity: 0.2,
        blur: 0,
        effect: "none",
        path: "C:/hidden",
      },
      path: "C:/hidden",
    },
  });
  const look = designLook("scene", normalized.look);
  expect(look).not.toHaveProperty("hue");
  expect(JSON.stringify(look)).not.toContain("hidden");
  expect(look.live?.scene).toBe("none");
  expect(normalized.name).toBe("Lake");
});

it("rejects unnamed or unsupported portable metadata", () => {
  for (const value of [
    null,
    { name: "", kind: "scene", prompt: "", look: {} },
    { name: "X", kind: "executable", prompt: "", look: {} },
  ])
    expect(() => normalizeDesignMetadata(value)).toThrow();
});

it("derives current from immutable media and preferences after reopening or renaming", () => {
  const hash = "a".repeat(64);
  const draft: DesignDraft = {
    kind: "scene",
    name: "Renamed",
    prompt: "",
    path: `/library/${hash.slice(0, 24)}.html`,
    look: {
      image: { scope: "all", emptyOpacity: 0.3, sessionOpacity: 0.2, blur: 1, effect: "none" },
    },
  };
  const current = { path: `/assets/asset-${hash}.html`, image: draft.look.image };
  expect(designIsCurrent(draft, current, false)).toBe(true);
  expect(designIsCurrent(draft, { ...current, image: { ...current.image, blur: 2 } }, false)).toBe(
    false,
  );
  expect(designIsCurrent(draft, { path: current.path, ...draft.look.image, blur: 99 }, true)).toBe(
    true,
  );
  expect(designIsCurrent({ ...draft, path: "/different.html" }, current, false)).toBe(false);
  expect(
    designIsCurrent({ kind: "motion", name: "Empty", prompt: "", look: {} }, { motion: {} }, false),
  ).toBe(false);
});

it("lets an open draft follow its saved design through rename and delete", () => {
  const saved = {
    id: "one",
    name: "Lake",
    createdAt: 1,
    updatedAt: 1,
    look: {},
    creation: { kind: "scene" as const, prompt: "" },
  };
  const draft: DesignDraft = { kind: "scene", name: "Lake", prompt: "", look: {}, saved };
  expect(followSavedLibrary(draft, [saved])).toBe(draft);
  const renamed = { ...saved, name: "Renamed", updatedAt: 2 };
  expect(followSavedLibrary(draft, [renamed])?.saved).toEqual(renamed);
  expect(followSavedLibrary(draft, [])?.saved).toBeUndefined();
  expect(followSavedLibrary(null, [])).toBeNull();
});

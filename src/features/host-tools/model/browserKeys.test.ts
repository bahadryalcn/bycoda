import { describe, expect, it } from "vitest";
import { browserKeyInput } from "./browserKeys";

const press = (
  key: string,
  held: Partial<Record<"ctrl" | "alt" | "shift" | "meta", boolean>> = {},
) =>
  browserKeyInput({
    key,
    ctrlKey: !!held.ctrl,
    altKey: !!held.alt,
    shiftKey: !!held.shift,
    metaKey: !!held.meta,
  });

describe("browserKeyInput", () => {
  it("sends named keys with the held modifiers", () => {
    expect(press("Tab", { shift: true })).toEqual({
      kind: "key",
      key: "Tab",
      modifiers: ["Shift"],
    });
    expect(press("Delete")).toEqual({ kind: "key", key: "Delete", modifiers: [] });
    expect(press("ArrowLeft", { ctrl: true, shift: true })?.modifiers).toEqual([
      "Control",
      "Shift",
    ]);
  });

  it("sends Ctrl/Cmd shortcuts as upper-case keys", () => {
    expect(press("z", { ctrl: true })).toEqual({ kind: "key", key: "Z", modifiers: ["Control"] });
    expect(press("a", { meta: true })).toEqual({ kind: "key", key: "A", modifiers: ["Meta"] });
  });

  it("leaves text and paste to their own paths", () => {
    expect(press("a")).toBeUndefined();
    expect(press("A", { shift: true })).toBeUndefined();
    expect(press(" ")).toBeUndefined();
    expect(press("v", { ctrl: true })).toBeUndefined();
    expect(press("é", { ctrl: true, alt: true })).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { newestFirst } from "./modelStoreReaders";

describe("newestFirst", () => {
  const names = (list: { name: string }[]) => list.map((item) => item.name);

  it("lists a provider's models by version, newest first", () => {
    const sorted = newestFirst(
      ["Fable 5.1", "Fable 5", "Opus 5", "Opus 5.5", "Sonnet 5", "Opus 4.8"].map((name) => ({
        name,
      })),
    );
    expect(names(sorted)).toEqual([
      "Opus 5.5",
      "Fable 5.1",
      "Fable 5",
      "Opus 5",
      "Sonnet 5",
      "Opus 4.8",
    ]);
  });

  it("keeps unversioned entries first and equal versions in catalog order", () => {
    const sorted = newestFirst(["Opus 5", "Auto", "Sonnet 5", "Default"].map((name) => ({ name })));
    expect(names(sorted)).toEqual(["Auto", "Default", "Opus 5", "Sonnet 5"]);
  });
});

import { expect, it } from "vitest";
import { rankLocalModels, supportsDictationLanguage } from "./localDictationModels";

const model = (id: string, extra: object = {}) => ({
  id,
  label: id,
  path: `owned/${id}`,
  installed: false,
  ...extra,
});

it("accepts any language when the catalog lists none", () => {
  expect(supportsDictationLanguage(model("a"), "tr")).toBe(true);
  expect(supportsDictationLanguage(model("a", { languages: ["en"] }), "tr")).toBe(false);
  expect(supportsDictationLanguage(model("a", { languages: ["en"] }), "")).toBe(true);
});

it("ranks language matches, then installed, then recommended, keeping catalog order for ties", () => {
  const ranked = rankLocalModels(
    [
      model("english", { languages: ["en"], installed: true, recommended: true }),
      model("plain"),
      model("recommended", { recommended: true }),
      model("installed", { installed: true }),
    ],
    "tr",
  );
  expect(ranked.map((item) => item.id)).toEqual(["installed", "recommended", "plain", "english"]);
});

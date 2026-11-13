import { expect, it } from "vitest";
import { importCount } from "./SessionImportResult";

it.each(["en", "tr", "ja"])("gives translators complete count labels for 0/1/2 in %s", (locale) => {
  const labels: Record<string, Record<string, string>> = {
    en: {},
    tr: { conversation: "{p0} konuşma", folder: "{p0} klasör", group: "{p0} grup" },
    ja: {
      conversation: "{p0} 件の会話",
      folder: "{p0} 個のフォルダー",
      group: "{p0} 個のグループ",
    },
  };
  for (const noun of ["conversation", "folder", "group"] as const)
    for (const count of [0, 1, 2]) {
      let key = "";
      const text = importCount(
        (message, values) => {
          key = message;
          return (labels[locale]![noun] ?? message).replace("{p0}", String(values?.p0));
        },
        count,
        noun,
      );
      expect(key).toBe(`{p0} ${noun}${count === 1 ? "" : "s"}`);
      expect(text).toContain(String(count));
      if (locale !== "en") expect(text).not.toContain(noun);
    }
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";
import zhCN from "./locales/zh-CN.json";

// Regression for #303: label/value strings use "Label: {p0}" and index labels
// use their own key, and every slot starts at {p0} in every locale.
const locales: Record<string, Record<string, string>> = {
  de,
  en,
  es,
  fr,
  ja,
  pt,
  tr,
  "zh-CN": zhCN,
};

const labelValueKeys = [
  "Last activity: {p0}",
  "Model: {p0}",
  "Request: {p0}",
  "Checking Host {p0}…",
];
const indexLabelKeys = ["Job {p0}", "Position {p0}"];
const retiredKeys = [
  "Last activity {p0}",
  "Request {p0}",
  "Model {p0}",
  "Model: {p1}",
  "Checking Host {p1}…",
];

const callSites = [
  ["app/shell/SessionDetailTimes.tsx", "Last activity: {p0}"],
  ["app/shell/SessionRecoveryPanel.tsx", "Last activity: {p0}"],
  ["features/decision-models/ui/LocalInstallWizard.tsx", "Model: {p0}"],
  ["features/settings/ui/appearance/controls/BackgroundGenerator.tsx", "Model: {p0}"],
  ["features/model-routing/ui/order/ModelOrderRow.tsx", "Position {p0}"],
  ["features/assistant/ui/room/JobReviewDialog.tsx", "Job {p0}"],
  ["features/crews/ui/CrewWorkTimeline.tsx", "Request: {p0}"],
] as const;

describe("label/value and index placeholder strings", () => {
  it.each(callSites)("%s uses %s", (file, label) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    expect(source).toContain(`t("${label}", {`);
    for (const retired of retiredKeys) {
      expect(source).not.toContain(`t("${retired}", {`);
    }
  });

  it.each(Object.entries(locales))(
    "%s has the standardized keys with a {p0} slot",
    (_, catalog) => {
      for (const key of [...labelValueKeys, ...indexLabelKeys]) {
        expect(catalog[key], key).toBeTypeOf("string");
        expect(catalog[key], key).toContain("{p0}");
        expect(catalog[key], key).not.toContain("{p1}");
      }
    },
  );

  it.each(Object.entries(locales))("%s no longer has the retired variants", (_, catalog) => {
    for (const key of retiredKeys) {
      expect(Object.keys(catalog), key).not.toContain(key);
    }
  });

  it("keeps the English wording of the standardized keys", () => {
    expect(en["Last activity: {p0}"]).toBe("Last activity: {p0}");
    expect(en["Model: {p0}"]).toBe("Model: {p0}");
    expect(en["Position {p0}"]).toBe("Position {p0}");
    expect(en["Job {p0}"]).toBe("Job {p0}");
  });
});

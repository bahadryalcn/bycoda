import { describe, expect, it } from "vitest";
import en from "../../../shared/i18n/locales/en.json";
import tr from "../../../shared/i18n/locales/tr.json";

describe("planned work terminology", () => {
  it("names planned goals Epics while preserving sprint goals", () => {
    expect(en.Goals).toBe("Epics");
    expect(tr.Goals).toBe("Epicler");
    expect(en["Sprint goal"]).toBe("Sprint goal");
    expect(tr["Sprint goal"]).toBe("Sprint amacı");
  });
});

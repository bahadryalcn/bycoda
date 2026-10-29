import { beforeAll, describe, expect, it } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import type { SocialSnapshot } from "./social";
import { defaultProgram, type SocialProgram } from "./socialProgram";
import {
  localDateTimeInput,
  programConfigFromProgram,
  summarizeProgramSuggestion,
} from "./socialProgramForm";

beforeAll(async () => {
  await setLanguagePreference("en");
});

const snapshot = {
  accounts: [{ id: "a", name: "Brand" }],
  profiles: [],
  campaigns: [{ id: "c", name: "Pool item" }],
} as unknown as SocialSnapshot;
const context = { locale: "en", snapshot, projects: [{ id: "p", name: "Alpha", cwd: "/a" }] };

describe("program form model", () => {
  it("summarizes suggested fields with owner-readable names", () => {
    const config = {
      ...defaultProgram("p", 1_000),
      name: "Launch",
      accountIds: ["a", "gone"],
      totalPosts: null,
      poolCampaignIds: ["c"],
    };
    expect(summarizeProgramSuggestion("name", config, context)).toBe("Launch");
    expect(summarizeProgramSuggestion("projectId", config, context)).toBe("Alpha");
    expect(summarizeProgramSuggestion("accountIds", config, context)).toBe("Brand, Removed account");
    expect(summarizeProgramSuggestion("totalPosts", config, context)).toBe("Unlimited");
    expect(summarizeProgramSuggestion("poolCampaignIds", config, context)).toBe("Pool item");
    expect(summarizeProgramSuggestion("unknown", config, context)).toBe(
      "Review the exact settings below.",
    );
  });

  it("strips identity and runtime state when loading a stored program into the form", () => {
    const program: SocialProgram = {
      ...defaultProgram("p", 1_000),
      id: "program",
      revision: 3,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      executorId: "host",
      generationCount: 1,
      imageGenerationCount: 0,
      generationDay: "",
      dailyGenerationCount: 0,
      nextSequence: 4,
    };
    const config = programConfigFromProgram(program);
    expect(config).toEqual(defaultProgram("p", 1_000));
    expect(config).not.toHaveProperty("id");
    expect(config).not.toHaveProperty("revision");
  });

  it("formats device-local datetime-local values", () => {
    expect(localDateTimeInput(0)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

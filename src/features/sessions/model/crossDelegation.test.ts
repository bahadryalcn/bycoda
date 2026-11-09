import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_LIMITS,
  decodeSubagents,
  encodeAdvisor,
  encodeSubagents,
  type DelegateModelRef,
} from "../../../shared/model/host-contracts/delegation";
import type { AgentModel } from "./models";
import { resetDisabledModels, saveModelEnabled } from "./models";
import {
  crossDelegationSettings,
  crossDelegationSummary,
  delegationNextValue,
  delegationOptionSelected,
  delegationShortLabel,
  isDelegationSetting,
  type DelegationInput,
} from "./crossDelegation";

const CLAUDE_OPUS: AgentModel = { id: "claude:opus-5-5", harness: "claude", name: "Opus 5.5" };
const CLAUDE_SONNET: AgentModel = { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5" };
const CODEX_A: AgentModel = { id: "codex:gpt-a", harness: "codex", name: "GPT A" };
const CODEX_B: AgentModel = { id: "codex:gpt-b", harness: "codex", name: "GPT B" };
const CURSOR_C: AgentModel = { id: "cursor:composer", harness: "cursor", name: "Composer" };

const BY_HARNESS: Record<string, AgentModel[]> = {
  claude: [CLAUDE_OPUS, CLAUDE_SONNET],
  codex: [CODEX_A, CODEX_B],
  cursor: [CURSOR_C],
};

const source = {
  modelsFor: (harness: string) => BY_HARNESS[harness] ?? [],
};

function input(overrides: Partial<DelegationInput> = {}): DelegationInput {
  return {
    current: CLAUDE_OPUS,
    harnesses: ["claude", "codex", "cursor"] as DelegationInput["harnesses"],
    source: source as DelegationInput["source"],
    values: {},
    unavailable: (name) => `Unavailable · ${name}`,
    ...overrides,
  };
}

function settingsFor(overrides: Partial<DelegationInput> = {}) {
  const [subagents, advisor] = crossDelegationSettings(input(overrides));
  return { subagents, advisor };
}

const ref = (harness: string, model: string): DelegateModelRef => ({
  harness: harness as DelegateModelRef["harness"],
  model,
});

// Local storage backs the disabled-model list; provide a minimal in-memory one.
function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

beforeEach(() => {
  mockLocalStorage();
  resetDisabledModels();
});

afterEach(() => {
  resetDisabledModels();
});

describe("crossDelegationSettings", () => {
  it.each([CLAUDE_OPUS, CODEX_A])(
    "matches a legacy implicit default account for $harness",
    (model) => {
      const implicit = ref(model.harness, model.id);
      const values = {
        crossAdvisor: encodeAdvisor(implicit)!,
        crossSubagents: encodeSubagents([implicit])!,
      };
      const { advisor, subagents } = settingsFor({
        current: model,
        currentAccountId: "work",
        harnesses: [model.harness],
        accountChoices: true,
        source: {
          ...source,
          accounts: {
            [model.harness]: [
              { id: "work", label: "Work" },
              { id: "default", label: "Default" },
            ],
          },
        },
        values,
      });
      for (const setting of [advisor, subagents]) {
        expect(setting.options.some((option) => option.label.startsWith("Unavailable"))).toBe(
          false,
        );
        const selected = setting.options.filter((option) =>
          delegationOptionSelected(setting, values, option.value),
        );
        expect(selected).toHaveLength(1);
        expect(selected[0].label).toContain("Default");
      }
      // Native selects compare serialized values; retain the saved wire reference.
      expect(advisor.options.some((option) => option.value === values.crossAdvisor)).toBe(true);
      const explicitDefault = encodeAdvisor({ ...implicit, providerAccountId: "default" })!;
      expect(delegationNextValue(subagents, values, explicitDefault)).toBe("");
      expect(values.crossAdvisor).toBe(encodeAdvisor(implicit));
    },
  );

  it.each([undefined, "removed"])(
    "retains unavailable account %s when not offered",
    (providerAccountId) => {
      const saved = {
        ...ref("codex", CODEX_A.id),
        ...(providerAccountId ? { providerAccountId } : {}),
      };
      const values = { crossAdvisor: encodeAdvisor(saved)! };
      const { advisor } = settingsFor({
        harnesses: ["codex"],
        accountChoices: true,
        source: { ...source, accounts: { codex: [{ id: "work", label: "Work" }] } },
        values,
      });
      expect(crossDelegationSummary(advisor, values)).toContain("Unavailable");
    },
  );

  it("returns the subagent and advisor rows keyed by the reserved keys", () => {
    const { subagents, advisor } = settingsFor();
    expect(subagents.id).toBe(CROSS_SUBAGENTS_KEY);
    expect(advisor.id).toBe(CROSS_ADVISOR_KEY);
    expect(isDelegationSetting(subagents)).toBe(true);
    expect(isDelegationSetting(advisor)).toBe(true);
  });

  it("lists every enabled model of every harness, with the off choice first", () => {
    const { subagents } = settingsFor();
    expect(subagents.options[0]).toEqual({ value: "", label: "Off" });
    expect(subagents.options.slice(1).map((option) => option.label)).toEqual([
      "Claude Code · Opus 5.5",
      "Claude Code · Sonnet 5",
      "Codex · GPT A",
      "Codex · GPT B",
      "Cursor · Composer",
    ]);
  });

  it("encodes each option as the JSON ref the Host decodes", () => {
    const { subagents } = settingsFor({ harnesses: ["codex"] });
    expect(subagents.options[1]).toEqual({
      value: encodeAdvisor(ref("codex", "codex:gpt-a")),
      label: "Codex · GPT A",
    });
  });

  it("hides models the owner disabled", () => {
    saveModelEnabled(CODEX_B.id, false);
    const { subagents } = settingsFor({ harnesses: ["codex"] });
    expect(subagents.options.map((option) => option.label)).toEqual(["Off", "Codex · GPT A"]);
  });

  it("offers the current model for an independent advisor and for subagents", () => {
    const { subagents, advisor } = settingsFor();
    const advisorLabels = advisor.options.map((option) => option.label);
    const subagentLabels = subagents.options.map((option) => option.label);
    expect(advisorLabels).toContain("Claude Code · Opus 5.5");
    expect(advisorLabels).toContain("Claude Code · Sonnet 5");
    expect(subagentLabels).toContain("Claude Code · Opus 5.5");
  });

  it("keeps saved refs that are no longer offered, marked unavailable", () => {
    const saved = encodeSubagents([ref("codex", "codex:retired")]) ?? "";
    const { subagents } = settingsFor({
      harnesses: ["codex"],
      values: { [CROSS_SUBAGENTS_KEY]: saved },
    });
    expect(subagents.options.at(-1)).toEqual({
      value: encodeAdvisor(ref("codex", "codex:retired")),
      label: "Unavailable · Codex · codex:retired",
    });
  });

  it("keeps a saved advisor that is no longer offered, marked unavailable", () => {
    const saved = encodeAdvisor(ref("codex", "codex:retired")) ?? "";
    const { advisor } = settingsFor({
      harnesses: ["codex"],
      values: { [CROSS_ADVISOR_KEY]: saved },
    });
    expect(advisor.options.at(-1)?.label).toBe("Unavailable · Codex · codex:retired");
  });

  it("does not add an unavailable row for a saved ref that is still offered", () => {
    const saved = encodeSubagents([ref("codex", "codex:gpt-a")]) ?? "";
    const { subagents } = settingsFor({
      harnesses: ["codex"],
      values: { [CROSS_SUBAGENTS_KEY]: saved },
    });
    expect(subagents.options.some((option) => option.label.startsWith("Unavailable"))).toBe(false);
  });
});

describe("delegationOptionSelected", () => {
  it("removes both legacy and explicit default aliases on one subagent toggle", () => {
    const implicit = ref("codex", CODEX_A.id);
    const explicit = { ...implicit, providerAccountId: "default" };
    const values = { crossSubagents: encodeSubagents([implicit, explicit])! };
    const { subagents } = settingsFor({
      harnesses: ["codex"],
      accountChoices: true,
      values,
      source: { ...source, accounts: { codex: [{ id: "default", label: "Default" }] } },
    });
    expect(
      subagents.options.filter((option) =>
        delegationOptionSelected(subagents, values, option.value),
      ),
    ).toHaveLength(1);
    expect(delegationNextValue(subagents, values, encodeAdvisor(explicit)!)).toBe("");
    expect(decodeSubagents(values.crossSubagents)).toHaveLength(2);
  });
  it("selects subagents by membership and Off when none are chosen", () => {
    const { subagents } = settingsFor({ harnesses: ["codex"] });
    const values = { [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref("codex", "codex:gpt-b")]) ?? "" };
    expect(delegationOptionSelected(subagents, values, "")).toBe(false);
    expect(delegationOptionSelected(subagents, values, subagents.options[2].value)).toBe(true);
    expect(delegationOptionSelected(subagents, {}, "")).toBe(true);
  });

  it("selects the advisor by equality", () => {
    const { advisor } = settingsFor({ harnesses: ["codex"] });
    const values = { [CROSS_ADVISOR_KEY]: encodeAdvisor(ref("codex", "codex:gpt-b")) ?? "" };
    expect(delegationOptionSelected(advisor, values, advisor.options[2].value)).toBe(true);
    expect(delegationOptionSelected(advisor, values, advisor.options[1].value)).toBe(false);
  });
});

describe("delegationNextValue", () => {
  it("adds and then removes one subagent in place", () => {
    const { subagents } = settingsFor({ harnesses: ["codex"] });
    const gptA = subagents.options[1].value;
    const gptB = subagents.options[2].value;

    const added = delegationNextValue(subagents, {}, gptA);
    const both = delegationNextValue(subagents, { [CROSS_SUBAGENTS_KEY]: added }, gptB);
    expect(JSON.parse(both)).toHaveLength(2);

    const removed = delegationNextValue(subagents, { [CROSS_SUBAGENTS_KEY]: both }, gptA);
    expect(JSON.parse(removed)).toEqual([JSON.parse(gptB)]);
  });

  it("clears every subagent when Off is picked", () => {
    const { subagents } = settingsFor({ harnesses: ["codex"] });
    expect(delegationNextValue(subagents, {}, "")).toBe("");
  });

  it("caps the subagent list instead of adding past the limit", () => {
    const models = Array.from({ length: DELEGATION_LIMITS.subagentModels + 1 }, (_, index) => ({
      id: `codex:m${index}`,
      harness: "codex" as const,
      name: `M${index}`,
    }));
    BY_HARNESS.codex = models;
    try {
      const { subagents } = settingsFor({ harnesses: ["codex"] });
      const full =
        encodeSubagents(
          models.slice(0, DELEGATION_LIMITS.subagentModels).map((model) => ref("codex", model.id)),
        ) ?? "";
      const extra = subagents.options.at(-1)?.value ?? "";
      expect(delegationNextValue(subagents, { [CROSS_SUBAGENTS_KEY]: full }, extra)).toBe(full);
    } finally {
      BY_HARNESS.codex = [CODEX_A, CODEX_B];
    }
  });

  it("takes the picked value unchanged for the advisor", () => {
    const { advisor } = settingsFor({ harnesses: ["codex"] });
    const picked = advisor.options[1].value;
    expect(delegationNextValue(advisor, {}, picked)).toBe(picked);
    expect(delegationNextValue(advisor, {}, "")).toBe("");
  });
});

describe("crossDelegationSummary", () => {
  it("reads Off when nothing is chosen", () => {
    const { subagents, advisor } = settingsFor({ harnesses: ["codex"] });
    expect(crossDelegationSummary(subagents, {})).toBe("Off");
    expect(crossDelegationSummary(advisor, {})).toBe("Off");
  });

  it("names the one chosen model", () => {
    const { advisor } = settingsFor({ harnesses: ["codex"] });
    const values = { [CROSS_ADVISOR_KEY]: encodeAdvisor(ref("codex", "codex:gpt-b")) ?? "" };
    expect(crossDelegationSummary(advisor, values)).toBe("Codex · GPT B");
  });

  it("reads the first name and the remaining count for several subagents", () => {
    const { subagents } = settingsFor({ harnesses: ["codex"] });
    const values = {
      [CROSS_SUBAGENTS_KEY]:
        encodeSubagents([ref("codex", "codex:gpt-a"), ref("codex", "codex:gpt-b")]) ?? "",
    };
    expect(crossDelegationSummary(subagents, values)).toBe("Codex · GPT A +1");
  });
});

describe("delegationShortLabel", () => {
  it("drops the provider prefix that the option's icon already shows", () => {
    const { advisor } = settingsFor({ harnesses: ["codex"] });
    const option = advisor.options.find((item) => item.label === "Codex · GPT B")!;
    expect(delegationShortLabel(advisor, option.value, option.label)).toBe("GPT B");
  });

  it("keeps Off and labels that do not start with the provider", () => {
    const { advisor } = settingsFor({ harnesses: ["codex"] });
    expect(delegationShortLabel(advisor, "", "Off")).toBe("Off");
    const value = encodeAdvisor(ref("codex", "codex:gone")) ?? "";
    expect(delegationShortLabel(advisor, value, "Unavailable: Codex · gone")).toBe(
      "Unavailable: Codex · gone",
    );
  });
});

it("keeps distinct provider account identities in delegation choices", () => {
  const { subagents } = settingsFor({
    accountChoices: true,
    source: {
      ...source,
      accounts: {
        codex: [
          { id: "work", label: "Work" },
          { id: "personal", label: "Personal" },
        ],
        claude: [],
      },
    },
  });
  expect(subagents.options.map((option) => option.value)).toContain(
    encodeAdvisor({ harness: "codex", model: CODEX_A.id, providerAccountId: "work" }),
  );
  expect(subagents.options.map((option) => option.label)).toContain("Codex · GPT A · Work");
});

it("selects the same Claude model on two accounts as separate subagents", () => {
  const accounts = {
    claude: [
      { id: "work", label: "Work" },
      { id: "personal", label: "Personal" },
    ],
    codex: [],
  };
  const { subagents } = settingsFor({ accountChoices: true, source: { ...source, accounts } });
  const pick = (account: string) =>
    encodeAdvisor({ harness: "claude", model: CLAUDE_SONNET.id, providerAccountId: account })!;
  const one = delegationNextValue(subagents, {}, pick("work"));
  const both = delegationNextValue(subagents, { [CROSS_SUBAGENTS_KEY]: one }, pick("personal"));
  expect(decodeSubagents(both).map((item) => item.providerAccountId)).toEqual(["work", "personal"]);
});

it("shows legacy Claude selections in unified controls", () => {
  const { subagents, advisor } = settingsFor({
    values: { subagentModel: "sonnet-5", advisor: "opus" },
  });
  expect(
    delegationOptionSelected(subagents, {}, encodeAdvisor(ref("claude", CLAUDE_SONNET.id))!),
  ).toBe(true);
  expect(decodeURIComponent(advisor.value)).toContain('"model":"opus"');
  expect(delegationNextValue(subagents, {}, "")).toBe("");
});

it("labels expired authentication for the exact selected account", () => {
  const { subagents } = settingsFor({
    accountChoices: true,
    signedOutAccounts: new Set(["codex:work"]),
    signedOutLabel: "Not signed in",
    source: {
      ...source,
      accounts: {
        codex: [
          { id: "work", label: "Work" },
          { id: "personal", label: "Personal" },
        ],
        claude: [],
      },
    },
  });
  expect(
    subagents.options.find((option) => option.label.includes("GPT A · Work"))?.label,
  ).toContain("Not signed in");
  expect(
    subagents.options.find((option) => option.label.includes("GPT A · Personal"))?.label,
  ).not.toContain("Not signed in");
});

it("retains a persisted Claude alias alongside another provider and its account", () => {
  const alias = { harness: "claude" as const, model: "haiku", providerAccountId: "work" };
  const values = { [CROSS_SUBAGENTS_KEY]: encodeSubagents([alias, ref("codex", CODEX_A.id)])! };
  const { subagents } = settingsFor({
    accountChoices: true,
    values,
    source: { ...source, accounts: { claude: [{ id: "work", label: "Work" }], codex: [] } },
  });
  const option = subagents.options.find((item) => item.value === encodeAdvisor(alias));
  expect(option?.label).toContain("Haiku");
  expect(option?.label).toContain("Work");
  expect(option?.label).not.toContain("Unavailable");
  expect(delegationOptionSelected(subagents, values, option!.value)).toBe(true);
});

import { describe, expect, it } from "vitest";
import { hostProvidersFrom, limitedProviders } from "./hostProviders";

const ALL = ["claude", "codex", "cursor", "grok"] as const;

describe("hostProvidersFrom", () => {
  it("lists every provider the Host catalog names, including failed and pending ones", () => {
    const state = hostProvidersFrom({
      isPending: false,
      data: {
        models: { codex: [] },
        errors: { cursor: "CLI not found" },
        pending: ["grok"],
      },
    });
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect([...state.providers].sort()).toEqual(["codex", "cursor", "grok"]);
  });

  it("reports loading while the catalog is unread and failed once the read gave up", () => {
    expect(hostProvidersFrom({ isPending: true, data: undefined })).toEqual({ status: "loading" });
    expect(hostProvidersFrom({ isPending: false, data: undefined })).toEqual({ status: "failed" });
  });
});

describe("limitedProviders", () => {
  const host = hostProvidersFrom({
    isPending: false,
    data: { models: { codex: [] }, errors: {}, pending: [] },
  });

  it("shows the Host's providers, not this computer's installed CLIs", () => {
    expect(limitedProviders(ALL, host, () => false)).toEqual(["codex"]);
  });

  it("keeps a provider with a saved cap or keep-free share even when the Host does not list it", () => {
    expect(limitedProviders(ALL, host, (provider) => provider === "grok")).toEqual([
      "codex",
      "grok",
    ]);
  });

  it("while loading or failed, shows only providers with saved values", () => {
    const saved = (provider: string) => provider === "claude";
    expect(limitedProviders(ALL, { status: "loading" }, saved)).toEqual(["claude"]);
    expect(limitedProviders(ALL, { status: "failed" }, saved)).toEqual(["claude"]);
    expect(limitedProviders(ALL, undefined, saved)).toEqual(["claude"]);
  });
});

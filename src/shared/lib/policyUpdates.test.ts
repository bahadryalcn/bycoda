import { expect, it, vi } from "vitest";
import {
  bundledPolicyUpdate,
  parsePolicyUpdate,
  policyDocumentUrl,
  policyUpdateFeed,
  readPolicyUpdate,
} from "./policyUpdates";

it("bundles a dated revision and only links to known public documents", () => {
  expect(bundledPolicyUpdate?.revision).toBeGreaterThan(0);
  expect(policyDocumentUrl("privacy")).toMatch(/\/docs\/guides\/privacy-policy\.md$/);
  expect(parsePolicyUpdate({ ...bundledPolicyUpdate, revision: 0 })).toBeUndefined();
  expect(parsePolicyUpdate({ ...bundledPolicyUpdate, publishedOn: "2026-02-31" })).toBeUndefined();
  expect(parsePolicyUpdate({ ...bundledPolicyUpdate, documents: ["__proto__"] })).toBeUndefined();
  expect(
    parsePolicyUpdate({ ...bundledPolicyUpdate, documents: ["terms", "terms"] }),
  ).toBeUndefined();
});

it("loads the public feed without account data and honors cancellation", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(bundledPolicyUpdate)));
  vi.stubGlobal("fetch", fetch);
  try {
    const lifetime = new AbortController();
    await expect(readPolicyUpdate(lifetime.signal)).resolves.toEqual(bundledPolicyUpdate);
    expect(fetch).toHaveBeenCalledWith(policyUpdateFeed, {
      credentials: "omit",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    lifetime.abort();
    await expect(readPolicyUpdate(lifetime.signal)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

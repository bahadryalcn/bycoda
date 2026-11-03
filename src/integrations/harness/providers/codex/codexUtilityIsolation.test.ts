import { expect, it, vi } from "vitest";
import {
  codexUtilityConfig,
  assertCodexUtilityIsolation,
  CODEX_UTILITY_DISABLED_FEATURES,
  CODEX_UTILITY_CONFIG,
  codexUtilitySpawnArgs,
} from "./codexUtilityIsolation";
import type { JsonRpcWriterView } from "../turnWriter";
const writer = (request: ReturnType<typeof vi.fn>) => ({ request }) as unknown as JsonRpcWriterView;
const disabled = {
  runtimeStatus: "disabled",
  tools: {},
  resources: [],
  resourceTemplates: [],
};
const isolatedConfig = {
  web_search: "disabled",
  features: Object.fromEntries(CODEX_UTILITY_DISABLED_FEATURES.map((name) => [name, false])),
};
it("disables command execution itself rather than mistaking unified-exec opt-out or read-only sandbox for a tool denial", () => {
  const args = codexUtilitySpawnArgs();
  expect(args).toEqual(
    expect.arrayContaining([
      "features.shell_tool=false",
      "features.view_image=false",
      "features.multi_agent=false",
      "features.code_mode_host=false",
      'web_search="disabled"',
    ]),
  );
});
it("disables every inherited literal server name without mutating owner configuration or guessing empty-map replacement", async () => {
  const servers = {
      "name.with.dots": { enabled: true },
      'name"quoted': { enabled: false },
    },
    config = { ...isolatedConfig, mcp_servers: servers },
    request = vi.fn(async () => ({ config }));
  expect(await codexUtilityConfig(writer(request), "/captured")).toEqual({
    ...CODEX_UTILITY_CONFIG,
    mcp_servers: {
      "name.with.dots": { enabled: false },
      'name"quoted': { enabled: false },
    },
  });
  expect(servers["name.with.dots"].enabled).toBe(true);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "config/read",
    { cwd: "/captured", includeLayers: false },
    45000,
  );
});
it.each(CODEX_UTILITY_DISABLED_FEATURES)(
  "fails closed if required builtin gate %s is missing or enabled",
  async (feature) => {
    for (const value of [undefined, true])
      await expect(
        codexUtilityConfig(
          writer(
            vi.fn(async () => ({
              config: {
                ...isolatedConfig,
                features: { ...isolatedConfig.features, [feature]: value },
              },
            })),
          ),
          "/captured",
        ),
      ).rejects.toThrow("isolation");
  },
);
it("does not accept cached/live/unknown web search as disabled", async () => {
  for (const web_search of [undefined, "cached", "live"])
    await expect(
      codexUtilityConfig(
        writer(vi.fn(async () => ({ config: { ...isolatedConfig, web_search } }))),
        "/captured",
      ),
    ).rejects.toThrow("isolation");
});
it.each([
  {},
  { config: null },
  { config: { mcp_servers: [] } },
  {
    config: {
      mcp_servers: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [i, {}])),
    },
  },
])("fails closed when the effective config cannot be bounded %#", async (response) => {
  await expect(
    codexUtilityConfig(writer(vi.fn(async () => response)), "/captured"),
  ).rejects.toThrow("isolation");
});
it("checks all pages against the original thread before certifying isolation", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      data: [{ ...disabled, name: "first" }],
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      data: [{ ...disabled, name: "second" }],
      nextCursor: null,
    });
  await assertCodexUtilityIsolation(writer(request), "original-thread");
  expect(request).toHaveBeenNthCalledWith(
    2,
    "mcpServerStatus/list",
    { threadId: "original-thread", limit: 100, cursor: "next" },
    45000,
  );
});
it.each([
  {},
  { data: {} },
  { data: [{ ...disabled, runtimeStatus: undefined }] },
  { data: [{ ...disabled, runtimeStatus: "starting" }] },
  { data: [{ ...disabled, tools: { write: {} } }] },
  { data: [{ ...disabled, resources: [{}] }] },
  { data: [{ ...disabled, resourceTemplates: [{}] }] },
])(
  "never mistakes unknown/enabled/cached tools or malformed evidence for disabled %#",
  async (response) => {
    await expect(
      assertCodexUtilityIsolation(writer(vi.fn(async () => response)), "original-thread"),
    ).rejects.toThrow("isolation");
  },
);
it("bounds repeated or unending inventory cursors instead of accepting a partial empty page", async () => {
  const repeated = vi.fn(async () => ({ data: [], nextCursor: "same" }));
  await expect(assertCodexUtilityIsolation(writer(repeated), "thread")).rejects.toThrow(
    "isolation",
  );
  expect(repeated).toHaveBeenCalledTimes(2);
});

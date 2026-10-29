import { expect, it } from "vitest";
import { ModelsListResultSchema } from "./models";
import { exportWireSchema, getHostRpcMethod, parseHostRpcParams } from "./index";

it("preserves the60s catalog budget and portable closed model/settings/account shape", () => {
  expect(getHostRpcMethod("models.list")).toMatchObject({
    kind: "query",
    responseTimeoutMs: 60000,
    requiredCapability: "transport.ws.models.v1",
  });
  expect(exportWireSchema(ModelsListResultSchema)).toBeTruthy();
  const catalog = {
    models: {
      codex: [
        {
          id: "x",
          name: "Türkçe 😀",
          settings: [
            {
              id: "reasoning",
              label: "Ayar",
              kind: "toggle",
              value: "yes",
              options: [{ value: "yes", label: "Evet" }],
            },
          ],
          contextWindow: 1.5,
        },
      ],
    },
    errors: {},
    accounts: { codex: [{ id: "default", label: "Host default" }] },
  };
  expect(ModelsListResultSchema.parse(catalog)).toEqual(catalog);
  expect(
    ModelsListResultSchema.safeParse({
      ...catalog,
      models: { codex: [{ ...catalog.models.codex[0], contextWindow: Infinity }] },
    }).success,
  ).toBe(false);
  expect(
    ModelsListResultSchema.safeParse({
      ...catalog,
      accounts: { codex: [{ id: "secret", label: "x", token: "forged" }] },
    }).success,
  ).toBe(false);
  expect(() => parseHostRpcParams("models.list", { progressive: "true" })).toThrow();
});

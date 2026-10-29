import { expect, it, vi } from "vitest";
import { createModelsService } from "./service";
import type { HostDomainContext } from "../context";

function fixture() {
  let allowed = true;
  const context: HostDomainContext = { authorized: async () => allowed };
  const catalog = {
    models: {
      codex: [
        {
          id: "codex:özgün",
          name: "Özgün 😀",
          nativeId: "upstream",
          aliasTarget: "moving-target",
          provider: { id: "vendor", name: "Sağlayıcı" },
          settings: [
            {
              id: "custom",
              label: "Ayar",
              kind: "select",
              value: "yüksek",
              options: [{ value: "yüksek", label: "Yüksek" }],
              description: "Açıklama",
            },
          ],
          contextWindow: 128000,
        },
      ],
    },
    errors: { pi: "Yetki gerekli" },
    pending: ["pi"],
  };
  const ports = {
    providers: ["codex"],
    read: vi.fn(async () => catalog),
    accounts: vi.fn(async () => ({
      codex: [
        { id: "default", label: "Host default" },
        { id: "account-test", label: "Account1" },
      ],
      claude: [{ id: "account-hidden", label: "Hidden" }],
    })),
  };
  return {
    context,
    catalog,
    ports,
    service: createModelsService(ports),
    revoke: () => {
      allowed = false;
    },
  };
}
it("preserves full discovery/custom settings and decorates only configured owner account metadata", async () => {
  const f = fixture();
  const result = await f.service.list(
    { projectId: "project", progressive: true, refresh: true },
    f.context,
  );
  expect(result).toEqual({
    ...f.catalog,
    accounts: { codex: await f.ports.accounts().then((value) => value.codex) },
  });
  expect(f.ports.read).toHaveBeenCalledExactlyOnceWith("project", true, true);
});
it("retains legacy non-string project and literal-true flags without weakening canonical params", async () => {
  const f = fixture(),
    raw = { projectId: 123, progressive: "true", refresh: true, unused: true };
  await f.service.list(raw, f.context, { legacy: true });
  expect(f.ports.read).toHaveBeenCalledExactlyOnceWith(123, false, true);
  await expect(f.service.list(raw, f.context)).rejects.toThrow();
});
it("rejects a non-owner before inventory and rechecks revocation after catalog IO", async () => {
  const f = fixture();
  await expect(f.service.list({}, { authorized: async () => false })).rejects.toThrow("revoked");
  expect(f.ports.accounts).not.toHaveBeenCalled();
  f.ports.read.mockImplementation(async () => {
    f.revoke();
    return f.catalog;
  });
  await expect(f.service.list({}, f.context)).rejects.toThrow("revoked");
});
it("rechecks grant after account IO before launching provider discovery", async () => {
  const f = fixture();
  f.ports.accounts.mockImplementation(async () => {
    f.revoke();
    return {};
  });
  await expect(f.service.list({}, f.context)).rejects.toThrow("revoked");
  expect(f.ports.read).not.toHaveBeenCalled();
});

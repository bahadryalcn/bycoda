import { afterEach, expect, it, vi } from "vitest";
import { accountWebUrl, deleteAccountUrl, exportDataUrl, securityUrl } from "./accountPortal";

afterEach(() => vi.unstubAllEnvs());

it("has no links when the portal is not configured", () => {
  vi.stubEnv("VITE_BYCODA_ACCOUNT_PORTAL_URL", "");
  expect([accountWebUrl(), securityUrl(), deleteAccountUrl(), exportDataUrl()]).toEqual([
    null,
    null,
    null,
    null,
  ]);
});

it("builds the portal pages from the configured origin", () => {
  vi.stubEnv("VITE_BYCODA_ACCOUNT_PORTAL_URL", "https://portal.example.test/ignored/");
  expect(securityUrl()).toBe("https://portal.example.test/security");
  expect(deleteAccountUrl()).toBe("https://portal.example.test/delete");
  expect(exportDataUrl()).toBe("https://portal.example.test/export");
  expect(accountWebUrl()).toBe("https://portal.example.test/");
});

it("rejects insecure or malformed portal origins", () => {
  for (const bad of ["http://portal.example.test", "javascript:alert(1)", "not a url"]) {
    vi.stubEnv("VITE_BYCODA_ACCOUNT_PORTAL_URL", bad);
    expect(securityUrl(), bad).toBeNull();
  }
  vi.stubEnv("VITE_BYCODA_ACCOUNT_PORTAL_URL", "http://127.0.0.1:5000");
  expect(securityUrl()).toBe("http://127.0.0.1:5000/security");
});

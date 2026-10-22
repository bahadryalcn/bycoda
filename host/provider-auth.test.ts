import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ exec: vi.fn(), launch: vi.fn(), profile: vi.fn() }));
vi.mock("../src/shared/lib/processExecution.node", () => ({ execFileAsync: mock.exec }));
vi.mock("./process", () => ({ providerLaunch: mock.launch }));
vi.mock("./provider-accounts", () => ({ providerAccountEnvironment: mock.profile }));
import { parseProviderAuthStatus, providerAuthStatus } from "./provider-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mock.launch.mockImplementation(async (command, args) => ({ command, args }));
  mock.profile.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("provider authentication discovery", () => {
  it("runs the selected account's status without inherited credentials or a login side effect", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key");
    mock.profile.mockResolvedValue({
      set: { CLAUDE_CONFIG_DIR: "D:/profiles/work" },
      remove: ["ANTHROPIC_API_KEY"],
    });
    mock.exec.mockResolvedValue({ stdout: '{"loggedIn":true}', stderr: "" });
    expect(await providerAuthStatus("claude", "C:/fixture/claude.exe", "terminal-work")).toBe(
      "signedIn",
    );
    expect(mock.profile).toHaveBeenCalledWith({ provider: "claude", id: "terminal-work" });
    expect(mock.launch).toHaveBeenCalledWith("C:/fixture/claude.exe", ["auth", "status", "--json"]);
    const options = mock.exec.mock.calls[0][2];
    expect(options.env.CLAUDE_CONFIG_DIR).toBe("D:/profiles/work");
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.windowsHide).toBe(true);
    expect(options.timeout).toBe(10_000);
  });
  it("classifies a nonzero Codex sign-out but keeps a timeout unknown", async () => {
    mock.exec.mockRejectedValueOnce({ code: 1, stderr: "Not logged in" });
    expect(await providerAuthStatus("codex", "C:/fixture/codex.exe")).toBe("signedOut");
    mock.exec.mockRejectedValueOnce({ killed: true, code: "ETIMEDOUT", stderr: "Not logged in" });
    expect(await providerAuthStatus("codex", "C:/fixture/codex.exe")).toBe("unknown");
    expect(await providerAuthStatus("pi", "C:/fixture/pi.exe")).toBe("unknown");
    expect(mock.exec).toHaveBeenCalledTimes(2);
  });
  it("reads explicit Claude login status rather than assuming cached identity is signed in", () => {
    expect(parseProviderAuthStatus("claude", true, '{"loggedIn":true}', "")).toBe("signedIn");
    expect(parseProviderAuthStatus("claude", false, '{"loggedIn":false}', "")).toBe("signedOut");
    expect(parseProviderAuthStatus("claude", true, '{"email":"cached@example.test"}', "")).toBe(
      "unknown",
    );
    expect(parseProviderAuthStatus("claude", false, '{"loggedIn":true}', "")).toBe("unknown");
  });
  it("handles Codex status on stderr and never returns credential details", () => {
    expect(parseProviderAuthStatus("codex", true, "", "Logged in using ChatGPT\n")).toBe(
      "signedIn",
    );
    expect(
      parseProviderAuthStatus("codex", true, "", "Logged in using an API key - synthetic-secret"),
    ).toBe("signedIn");
    expect(parseProviderAuthStatus("codex", false, "", "Not logged in\n")).toBe("signedOut");
  });
  it("does not convert unsupported versions, operational errors or other providers into sign-outs", () => {
    for (const output of [
      "",
      "unknown command",
      "Network unavailable",
      "Authentication required to run status",
    ]) {
      expect(parseProviderAuthStatus("codex", false, output, "")).toBe("unknown");
      expect(parseProviderAuthStatus("claude", false, output, "")).toBe("unknown");
    }
    expect(parseProviderAuthStatus("pi", true, "Logged in using ChatGPT", "")).toBe("unknown");
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  newProviderAccount,
  providerAccountLabel,
  providerAccountExists,
  providerAccounts,
  removeProviderAccount,
  renameProviderAccount,
  saveProviderAccount,
  saveTerminalProviderAccount,
  defaultProviderAccountId,
  PROVIDER_ACCOUNT_COLORS,
  providerAccountColor,
  sessionProviderAccountId,
  setDefaultProviderAccount,
  setProviderAccountColor,
} from "./providerAccounts";

beforeEach(() => {
  localStorage.clear();
});

describe("provider accounts", () => {
  it("reuses terminal profiles without duplicates or changing the current default", () => {
    saveProviderAccount({
      id: "account-old",
      provider: "claude",
      label: "Existing",
    });
    setDefaultProviderAccount("claude", "account-old");
    const work = {
      id: "terminal-work",
      provider: "claude" as const,
      label: "Work",
    };
    saveTerminalProviderAccount(work);
    saveTerminalProviderAccount(work);
    expect(providerAccounts("claude").filter((account) => account.id === work.id)).toHaveLength(1);
    expect(defaultProviderAccountId("claude")).toBe("account-old");
    expect(sessionProviderAccountId("claude", { providerAccountId: "account-old" })).toBe(
      "account-old",
    );
  });

  it("can restore a removed terminal default without changing other accounts", () => {
    removeProviderAccount("codex", "default");
    saveTerminalProviderAccount({
      id: "default",
      provider: "codex",
      label: "Terminal account",
    });
    expect(providerAccounts("codex")).toEqual([
      {
        id: "default",
        provider: "codex",
        label: "Terminal account",
        isDefault: true,
      },
    ]);
    expect(providerAccounts("claude")).toHaveLength(1);
  });
  it("always exposes the provider-owned default account", () => {
    expect(providerAccounts("claude")).toEqual([
      {
        id: DEFAULT_PROVIDER_ACCOUNT_ID,
        provider: "claude",
        label: "Default account",
        isDefault: true,
      },
    ]);
  });

  it("stores named profiles separately per provider", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const work = newProviderAccount("claude", "  Work   account  ");
    saveProviderAccount(work);

    expect(providerAccounts("claude").map((account) => account.label)).toEqual([
      "Default account",
      "Work account",
    ]);
    expect(providerAccounts("codex")).toHaveLength(1);
    expect(providerAccountLabel("claude", work.id)).toBe("Work account");
  });

  it("falls back to the default account for malformed stored profiles", () => {
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({ claude: { id: "not-an-array" } }),
    );

    expect(providerAccounts("claude").map((account) => account.id)).toEqual([
      DEFAULT_PROVIDER_ACCOUNT_ID,
    ]);
  });

  it("falls back when the stored root is not a record", () => {
    for (const malformed of ["null", "[]", "42"]) {
      localStorage.setItem("bycoda.providerAccounts.v1", malformed);
      expect(providerAccounts("claude").map((account) => account.id)).toEqual([
        DEFAULT_PROVIDER_ACCOUNT_ID,
      ]);
    }

    expect(defaultProviderAccountId("claude")).toBe(DEFAULT_PROVIDER_ACCOUNT_ID);
  });

  it("replaces malformed provider storage when saving an account", () => {
    localStorage.setItem("bycoda.providerAccounts.v1", JSON.stringify({ codex: "not-an-array" }));

    expect(() =>
      saveProviderAccount({
        id: "account-work",
        provider: "codex",
        label: "Work",
      }),
    ).not.toThrow();
    expect(providerAccounts("codex").map((account) => account.label)).toEqual([
      "Default account",
      "Work",
    ]);
  });

  it("discards malformed account entries when saving an account", () => {
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({
        codex: [
          null,
          42,
          { id: "account-missing-label", provider: "codex" },
          { id: "account-keep", provider: "codex", label: "Keep" },
        ],
      }),
    );

    expect(() =>
      saveProviderAccount({
        id: "account-work",
        provider: "codex",
        label: "Work",
      }),
    ).not.toThrow();
    expect(providerAccounts("codex").map((account) => account.label)).toEqual([
      "Default account",
      "Keep",
      "Work",
    ]);
  });

  it("resolves a session to its own pin, else the provider default", () => {
    saveProviderAccount({
      id: "account-work",
      provider: "codex",
      label: "Work",
    });
    expect(sessionProviderAccountId("codex", {})).toBe(DEFAULT_PROVIDER_ACCOUNT_ID);
    expect(sessionProviderAccountId("codex", { providerAccountId: "account-work" })).toBe(
      "account-work",
    );
    setDefaultProviderAccount("codex", "account-work");
    expect(sessionProviderAccountId("codex", {})).toBe("account-work");
    // An existing conversation keeps its pin when the default moves.
    expect(sessionProviderAccountId("codex", { providerAccountId: "default" })).toBe("default");
    // A thread from before account ids belongs to the legacy profile.
    expect(sessionProviderAccountId("codex", { providerSessionId: "thread-1" })).toBe(
      DEFAULT_PROVIDER_ACCOUNT_ID,
    );
  });

  it("renames a named account without changing its identity or order", () => {
    saveProviderAccount({
      id: "account-work",
      provider: "codex",
      label: "Wrk",
    });
    saveProviderAccount({
      id: "account-personal",
      provider: "codex",
      label: "Personal",
    });

    expect(renameProviderAccount("codex", "account-work", "  Work   account  ")).toEqual({
      id: "account-work",
      provider: "codex",
      label: "Work account",
    });
    expect(providerAccounts("codex").map((account) => account.id)).toEqual([
      DEFAULT_PROVIDER_ACCOUNT_ID,
      "account-work",
      "account-personal",
    ]);
  });

  it("removes named account metadata", () => {
    const work = {
      id: "account-work",
      provider: "claude" as const,
      label: "Work",
    };
    saveProviderAccount(work);

    expect(removeProviderAccount("claude", work.id)).toBe(true);
    expect(providerAccountExists("claude", work.id)).toBe(false);
    expect(defaultProviderAccountId("claude")).toBe(DEFAULT_PROVIDER_ACCOUNT_ID);
  });

  it("removes the CLI profile without recreating it from legacy storage", () => {
    expect(renameProviderAccount("codex", "default", "  Personal  ")).toEqual({
      id: DEFAULT_PROVIDER_ACCOUNT_ID,
      provider: "codex",
      label: "Personal",
      isDefault: true,
    });
    expect(removeProviderAccount("codex", "default")).toBe(true);
    expect(providerAccounts("codex")).toEqual([]);
    expect(providerAccountExists("codex", undefined)).toBe(false);
    saveProviderAccount({ id: "account-new", provider: "codex", label: "New" });
    expect(providerAccounts("codex")).toEqual([
      { id: "account-new", provider: "codex", label: "New", isDefault: true },
    ]);
    expect(defaultProviderAccountId("codex")).toBe("account-new");
  });

  it("uses the assigned default for sessions without a choice", () => {
    saveProviderAccount({
      id: "account-work",
      provider: "codex",
      label: "Work",
    });
    setDefaultProviderAccount("codex", "account-work");
    expect(defaultProviderAccountId("codex")).toBe("account-work");
    expect(
      providerAccounts("codex")
        .filter((entry) => entry.isDefault)
        .map((entry) => entry.id),
    ).toEqual(["account-work"]);
    removeProviderAccount("codex", "account-work");
    expect(defaultProviderAccountId("codex")).toBe("default");
  });

  it("reports persistence failures instead of announcing success", () => {
    const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    try {
      expect(() => setDefaultProviderAccount("claude", "default")).toThrow("Storage full");
      expect(providerAccounts("claude")).toHaveLength(1);
    } finally {
      storage.mockRestore();
    }
  });

  it("preserves a custom default name when named profiles change", () => {
    renameProviderAccount("claude", "default", "Primary");
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    removeProviderAccount("claude", "account-work");

    expect(providerAccounts("claude")[0]?.label).toBe("Primary");
  });

  it("persists an account colour and keeps it across renames and saves", () => {
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    expect(setProviderAccountColor("claude", "account-work", "teal")).toBe(true);
    expect(providerAccounts("claude").find((entry) => entry.id === "account-work")?.color).toBe(
      "teal",
    );
    renameProviderAccount("claude", "account-work", "Work 2");
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work 3",
    });
    const work = providerAccounts("claude").find((entry) => entry.id === "account-work");
    expect(work).toMatchObject({ label: "Work 3", color: "teal" });
    setProviderAccountColor("claude", "account-work", undefined);
    expect(
      providerAccounts("claude").find((entry) => entry.id === "account-work")?.color,
    ).toBeUndefined();
  });

  it("colours the implicit default account without breaking default logic", () => {
    saveProviderAccount({
      id: "account-work",
      provider: "codex",
      label: "Work",
    });
    localStorage.removeItem("bycoda.providerAccounts.v2");
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({
        codex: [
          { id: "default", provider: "codex", label: "Personal" },
          { id: "account-work", provider: "codex", label: "Work" },
        ],
      }),
    );

    expect(setProviderAccountColor("codex", "default", "pink")).toBe(true);
    expect(providerAccounts("codex")).toEqual([
      {
        id: "default",
        provider: "codex",
        label: "Personal",
        isDefault: true,
        color: "pink",
      },
      { id: "account-work", provider: "codex", label: "Work" },
    ]);
    expect(defaultProviderAccountId("codex")).toBe("default");
    expect(sessionProviderAccountId("codex", {})).toBe("default");
    // Still switchable and removable afterwards.
    setDefaultProviderAccount("codex", "account-work");
    expect(defaultProviderAccountId("codex")).toBe("account-work");
    expect(providerAccounts("codex")[0]?.color).toBe("pink");
  });

  it("rejects unknown accounts and colours", () => {
    expect(setProviderAccountColor("claude", "account-missing", "blue")).toBe(false);
    expect(setProviderAccountColor("claude", "default", "chartreuse" as never)).toBe(false);
    localStorage.setItem(
      "bycoda.providerAccounts.v2",
      JSON.stringify({
        claude: [
          {
            id: "default",
            provider: "claude",
            label: "A",
            isDefault: true,
            color: "nope",
          },
        ],
      }),
    );
    expect(providerAccounts("claude")[0]?.color).toBeUndefined();
  });

  it("derives a stable fallback colour per account id", () => {
    const first = providerAccountColor({ id: "account-a", provider: "claude" });
    expect(providerAccountColor({ id: "account-a", provider: "claude" })).toBe(first);
    expect(PROVIDER_ACCOUNT_COLORS).toContain(first);
    expect(providerAccountColor({ id: "default", provider: "claude" })).toBe(
      providerAccountColor({ id: "default", provider: "claude" }),
    );
    const ids = Array.from({ length: 40 }, (_, index) => `account-${index}`);
    const used = new Set(ids.map((id) => providerAccountColor({ id, provider: "codex" }).id));
    expect(used.size).toBeGreaterThan(3);
    expect(
      providerAccountColor({
        id: "account-a",
        provider: "claude",
        color: "slate",
      }).id,
    ).toBe("slate");
  });
});

it("reports storage quota failure without announcing a successful account rename", () => {
  const account = newProviderAccount("claude", "Work");
  saveProviderAccount(account);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Quota full", "QuotaExceededError");
  });
  try {
    expect(() => renameProviderAccount("claude", account.id, "Personal")).toThrow("Quota full");
    expect(providerAccountLabel("claude", account.id)).toBe("Work");
    expect(warn).toHaveBeenCalled();
  } finally {
    write.mockRestore();
    warn.mockRestore();
  }
});

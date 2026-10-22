import { describe, expect, it, vi } from "vitest";
import { generateSessionTitle } from "./titleGeneration";

describe("ortak oturum başlığı üretimi", () => {
  it("kaynak mesajdaki iş referansını ve hesap seçimini korur", async () => {
    const run = vi
      .fn()
      .mockResolvedValue('{"title":"Fix links","workItem":{"kind":"pr","number":42}}');
    expect(
      await generateSessionTitle(
        { sessionId: "s", cwd: "/p", message: "Fix PR #42", providerAccountId: "account" },
        run,
      ),
    ).toEqual({ title: "Fix links", workItem: { kind: "pr", number: 42 } });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/p", timeoutMs: 45000, providerAccountId: "account" }),
    );
  });
  it("taşıma hatasında null döner", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    expect(
      await generateSessionTitle({ sessionId: "s", cwd: "/p", message: "Fix links" }, async () => {
        throw new Error("transport");
      }),
    ).toBeNull();
    vi.restoreAllMocks();
  });
});

import { describe, expect, it, vi } from "vitest";
import { xOAuth } from "./x";

const identityWith = (value: Record<string, unknown>) => {
  const request = vi.fn(async () => ({ value, headers: new Headers() }));
  const run = () =>
    xOAuth.identity(
      {
        http: { request } as never,
        config: undefined as never,
        fetcher: fetch,
        now: Date.now,
      } as never,
      { credential: { accessToken: "token" } as never, token: {}, scopes: [] } as never,
    );
  return { request, run };
};

describe("X OAuth identity", () => {
  it("uses the numeric user ID and username of the verified user", async () => {
    const { request, run } = identityWith({ data: { id: "123", username: "verified" } });
    const result = await run();
    expect(request).toHaveBeenCalledWith("https://api.x.com/2/users/me", "token");
    expect(result.candidates[0]).toMatchObject({ id: "123", name: "verified" });
  });

  it("refuses a profile without a numeric user ID instead of storing an empty identity", async () => {
    const { run } = identityWith({ data: { username: "nobody" } });
    await expect(run()).rejects.toThrow("could not be verified");
  });
});

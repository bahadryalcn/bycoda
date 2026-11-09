import { describe, expect, it } from "vitest";
import { INITIAL_ACCOUNT_STATE, accountReducer, type AccountState } from "./accountState";
import { ACCOUNT_CONTEXT } from "./testFixtures";

const run = (events: Parameters<typeof accountReducer>[1][], from = INITIAL_ACCOUNT_STATE) =>
  events.reduce<AccountState>(accountReducer, from);

const verified = {
  type: "verified",
  context: ACCOUNT_CONTEXT,
  deviceId: "dev_1",
  now: 10,
} as const;

describe("account state machine", () => {
  it("goes signed out, signing in, signed in", () => {
    const state = run([{ type: "no-session" }, { type: "sign-in-requested" }, verified]);
    expect(state).toMatchObject({
      phase: "signed-in",
      deviceId: "dev_1",
      verifiedAt: 10,
      stale: false,
    });
  });

  it("starts from the cache as stale until the service confirms", () => {
    const cached = run([
      { type: "cached", context: ACCOUNT_CONTEXT, deviceId: null, verifiedAt: 5 },
    ]);
    expect(cached).toMatchObject({ phase: "signed-in", stale: true, verifiedAt: 5 });
    expect(accountReducer(cached, verified)).toMatchObject({ stale: false, verifiedAt: 10 });
  });

  it("a refresh failure signs out with a notice, and the next sign-in starts clean", () => {
    const signedIn = run([{ type: "no-session" }, { type: "sign-in-requested" }, verified]);
    const ended = accountReducer(signedIn, { type: "session-ended", reason: "session-ended" });
    expect(ended).toEqual({ phase: "signed-out", notice: "session-ended", message: null });
    expect(accountReducer(ended, { type: "sign-in-requested" })).toEqual({ phase: "signing-in" });
  });

  it("a revoked device is told apart from an expired session", () => {
    const signedIn = run([{ type: "no-session" }, { type: "sign-in-requested" }, verified]);
    expect(
      accountReducer(signedIn, { type: "session-ended", reason: "device-revoked" }),
    ).toMatchObject({ phase: "signed-out", notice: "device-revoked" });
  });

  it("offline keeps the signed-in view and marks it stale", () => {
    const signedIn = run([{ type: "no-session" }, { type: "sign-in-requested" }, verified]);
    expect(accountReducer(signedIn, { type: "offline" })).toMatchObject({ stale: true });
    const signedOut = run([{ type: "no-session" }]);
    expect(accountReducer(signedOut, { type: "offline" })).toBe(signedOut);
  });

  it("cancel, decline and failure return to signed out with the right notice", () => {
    const signing = run([{ type: "no-session" }, { type: "sign-in-requested" }]);
    expect(accountReducer(signing, { type: "sign-in-cancelled" })).toMatchObject({ notice: null });
    expect(accountReducer(signing, { type: "sign-in-declined" })).toMatchObject({
      notice: "declined",
    });
    expect(accountReducer(signing, { type: "sign-in-failed", message: "x" })).toMatchObject({
      notice: "sign-in-failed",
      message: "x",
    });
  });

  it("a late verification cannot sign a signed-out user in", () => {
    const signedOut = run([{ type: "no-session" }]);
    expect(accountReducer(signedOut, verified)).toBe(signedOut);
  });

  it("sign-in is only offered from signed out", () => {
    const signedIn = run([{ type: "no-session" }, { type: "sign-in-requested" }, verified]);
    expect(accountReducer(signedIn, { type: "sign-in-requested" })).toBe(signedIn);
    expect(accountReducer({ phase: "unavailable" }, { type: "sign-in-requested" })).toEqual({
      phase: "unavailable",
    });
  });
});

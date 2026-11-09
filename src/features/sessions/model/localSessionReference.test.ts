import { describe, expect, it } from "vitest";
import {
  buildLocalSessionLink,
  buildSessionAppLink,
  localSessionLinkFields,
  parseLocalSessionLink,
  type LocalSessionLocator,
} from "./localSessionReference";

describe("local session references", () => {
  it("copies HTTPS references and retains exact legacy app handoff identity", () => {
    const reference = {
      locator: {
        kind: "native" as const,
        sourceStoreId: "store",
        sourceProfileId: "profile",
        sessionId: "session",
      },
      turnId: "turn",
    };
    expect(buildLocalSessionLink(reference)).toBe(
      "https://link.bycoda.codes/session/v1/native/store/profile/session?turn=turn",
    );
    expect(buildSessionAppLink(reference)).toBe(
      "bycoda://session/v1/native/store/profile/session?turn=turn",
    );
    expect(parseLocalSessionLink(buildSessionAppLink(reference))).toEqual(reference);
    expect(parseLocalSessionLink(buildLocalSessionLink(reference))).toEqual(reference);
  });
  it("encodes prose punctuation without changing an opaque session identity", () => {
    const locator: LocalSessionLocator = {
      kind: "host",
      environmentId: "env",
      sessionId: "opaque.~",
    };
    const link = buildLocalSessionLink(locator);
    expect(link).toContain("opaque%2E%7E");
    expect(parseLocalSessionLink(link)?.locator).toEqual(locator);
  });
  it("never generates an encoded Unicode reference beyond the parser's total bound", () => {
    expect(() =>
      buildLocalSessionLink({
        kind: "native",
        sourceStoreId: "界".repeat(256),
        sourceProfileId: "界".repeat(256),
        sessionId: "界".repeat(256),
      }),
    ).toThrow("too long");
  });
  const owners: LocalSessionLocator[] = [
    { kind: "host", environmentId: "environment-a", sessionId: "same-session" },
    {
      kind: "native",
      sourceStoreId: "store-a",
      sourceProfileId: "profile-a",
      sessionId: "same-session",
    },
  ];
  it.each(owners)("round trips persisted $kind identity with an exact turn", (locator) => {
    const reference = { locator, turnId: "turn ü/#?()" };
    expect(parseLocalSessionLink(buildLocalSessionLink(reference))).toEqual(reference);
  });
  it("does not derive identity from mutable titles, or conflate origins", () => {
    const locator = owners[0];
    expect(localSessionLinkFields(locator, "Old").link).toBe(
      localSessionLinkFields(locator, "Renamed").link,
    );
    expect(buildLocalSessionLink(locator)).not.toBe(
      buildLocalSessionLink({ ...locator, environmentId: "environment-b" }),
    );
    expect(buildLocalSessionLink(owners[1])).not.toBe(
      buildLocalSessionLink({
        ...owners[1],
        sourceProfileId: "profile-b",
      } as LocalSessionLocator),
    );
  });
  it("escapes hostile labels without changing the destination", () => {
    const result = localSessionLinkFields(owners[0], "[title](javascript:bad)\n<b> *_`\\");
    expect(result.markdownReference).toBe(
      "[\\[title\\]\\(javascript:bad\\) \\<b\\> \\*\\_\\`\\\\](" + result.link + ")",
    );
    expect(parseLocalSessionLink(result.link)?.locator).toEqual(owners[0]);
  });
  it.each([
    "https://session/v1/host/env/id",
    "http://link.bycoda.codes/session/v1/host/env/id",
    "https://link.bycoda.codes.evil.test/session/v1/host/env/id",
    "https://link.bycoda.codes/session/v1/host/env/id?token=secret",
    "https://link.bycoda.codes:443/session/v1/host/env/id",
    "bycoda://session/v2/host/env/id",
    "bycoda://other/v1/host/env/id",
    "bycoda://session/v1/host/env/id/extra",
    "bycoda://session/v1/native/store/id",
    "bycoda://session/v1/host//id",
    "bycoda://session/v1/host/env/%",
    "bycoda://session/v1/host/env/%00",
    "bycoda://session/v1/host/env/..",
    "bycoda://session/v1/host/env/id?turn=",
    "bycoda://session/v1/host/env/id?token=secret",
    "bycoda://session/v1/host/env/id?turn=x&turn=y",
    "bycoda://session/v1/host/env/id#turn",
    "bycoda://session/v1/host/env/id ",
    "bycoda://session/v1/host/env/" + "x".repeat(257),
  ])("rejects malformed or unsupported targets %s", (href) =>
    expect(parseLocalSessionLink(href)).toBeNull(),
  );
  it("rejects invalid builder IDs instead of emitting unusable links", () => {
    expect(() =>
      buildLocalSessionLink({
        kind: "host",
        environmentId: "",
        sessionId: "id",
      }),
    ).toThrow();
    expect(() =>
      buildLocalSessionLink({
        kind: "host",
        environmentId: "env",
        sessionId: "\ud800",
      }),
    ).toThrow();
  });
});

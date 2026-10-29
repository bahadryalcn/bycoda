import { describe, expect, it } from "vitest";
import { deferredExternalDraftToApply, externalDraftAction } from "./composerExternalDraft";

describe("externalDraftAction", () => {
  it("never applies an empty external draft", () => {
    expect(externalDraftAction({ external: undefined, domValue: "x", composing: false })).toBe(
      "ignore",
    );
    expect(externalDraftAction({ external: "", domValue: "x", composing: false })).toBe("ignore");
  });

  it("treats the same text as an echo, including exact whitespace", () => {
    expect(externalDraftAction({ external: "a b ", domValue: "a b ", composing: false })).toBe(
      "echo",
    );
    expect(externalDraftAction({ external: "a b", domValue: "a b ", composing: false })).toBe(
      "replace",
    );
    expect(externalDraftAction({ external: "a", domValue: "a", composing: true })).toBe("echo");
  });

  it("replaces a different draft, such as a nonempty draft injected into an empty input", () => {
    expect(externalDraftAction({ external: "/plan ", domValue: "", composing: false })).toBe(
      "replace",
    );
  });

  it("defers a different draft during an IME composition", () => {
    expect(externalDraftAction({ external: "你", domValue: "你好", composing: true })).toBe("defer");
  });
});

describe("deferredExternalDraftToApply", () => {
  const deferred = { text: "/plan ", revision: 4 };

  it("applies when nothing was edited and the input still differs", () => {
    expect(deferredExternalDraftToApply({ deferred, revision: 4, domValue: "" })).toBe("/plan ");
  });

  it("drops the draft when the user edited since", () => {
    expect(deferredExternalDraftToApply({ deferred, revision: 5, domValue: "ni" })).toBeNull();
  });

  it("drops the draft when it is already shown or nothing was deferred", () => {
    expect(deferredExternalDraftToApply({ deferred, revision: 4, domValue: "/plan " })).toBeNull();
    expect(deferredExternalDraftToApply({ deferred: null, revision: 4, domValue: "" })).toBeNull();
  });
});

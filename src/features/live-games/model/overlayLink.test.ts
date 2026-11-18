import { describe, expect, it } from "vitest";
import { overlayLink } from "./overlayLink";

describe("overlayLink", () => {
  it("keeps the token and applies only selected scene options", () => {
    const result = overlayLink("http://127.0.0.1:3776/live-games/token?mute", {
      aspect: "16:9",
      clean: true,
    });
    expect(result).toBe("http://127.0.0.1:3776/live-games/token?aspect=16%3A9&clean=");
  });
  it.each(["", "https://elsewhere.test/live/token", "http://login@127.0.0.1/live/token"])(
    "rejects non-local and malformed URLs",
    (input) => expect(overlayLink(input, {})).toBeUndefined(),
  );
});

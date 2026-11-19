import { expect, it } from "vitest";
import { unconfirmedError, unconfirmedMessage } from "./unconfirmedOutcome";

// #309: one phrasing for an outcome the Host may or may not have applied.
it("words an unknown outcome as 'could not be confirmed' with an optional next step", () => {
  expect(unconfirmedMessage("Summary refresh")).toBe("Summary refresh could not be confirmed.");
  expect(unconfirmedMessage("Note deletion", "Review the Room before retrying.")).toBe(
    "Note deletion could not be confirmed. Review the Room before retrying.",
  );
  expect(unconfirmedError("The previous answer").message).toBe(
    "The previous answer could not be confirmed.",
  );
});

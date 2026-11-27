import { afterEach, beforeEach, expect, it } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import {
  BTW_ERROR_CODES,
  BtwThreadError,
  btwErrorCodeOf,
  isBtwErrorCode,
  presentBtwThreadError,
} from "./btwError";
import { serializeBtwSnapshot } from "./btw";

beforeEach(async () => {
  await setLanguagePreference("en");
});
afterEach(async () => {
  await setLanguagePreference("en");
});

it("presents every stored code as a sentence in the current language", async () => {
  const english = BTW_ERROR_CODES.map((errorCode) =>
    presentBtwThreadError({ errorCode, error: "stale english text" }, "Codex"),
  );
  expect(new Set(english).size).toBe(BTW_ERROR_CODES.length);
  expect(english.some((sentence) => sentence.includes("stale english text"))).toBe(false);
  expect(english).toContain("Codex returned an empty side answer.");
  await setLanguagePreference("tr");
  const turkish = BTW_ERROR_CODES.map((errorCode) =>
    presentBtwThreadError({ errorCode, error: "stale english text" }, "Codex"),
  );
  turkish.forEach((sentence, index) => expect(sentence).not.toBe(english[index]));
});

it("shows a provider failure as a translated sentence plus redacted detail", () => {
  const text = presentBtwThreadError(
    { error: "request failed token=abc123secretvalue at https://api.example.com/v1" },
    "Claude",
  );
  expect(text.startsWith("Claude could not answer this side question. request failed")).toBe(true);
  expect(text).not.toContain("abc123secretvalue");
  expect(text).not.toContain("https://");
  expect(presentBtwThreadError({}, "Claude")).toBe("Claude could not answer this side question.");
});

it("treats a thread saved before codes existed like any other provider failure", () => {
  expect(presentBtwThreadError({ error: "Old saved sentence." }, "Claude")).toBe(
    "Claude could not answer this side question. Old saved sentence.",
  );
});

it("types the unavailable-turn refusal and only accepts known codes", () => {
  let thrown: unknown;
  try {
    serializeBtwSnapshot([], "missing");
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(BtwThreadError);
  expect(btwErrorCodeOf(thrown)).toBe("turnUnavailable");
  expect((thrown as Error).message).toBe("The completed turn is no longer available.");
  expect(btwErrorCodeOf(new Error("x"))).toBeUndefined();
  expect(isBtwErrorCode("interrupted")).toBe(true);
  expect(isBtwErrorCode("anything else")).toBe(false);
});

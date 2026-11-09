import { expect, it } from "vitest";
import * as json from "@bycoda/core/json-text";
import * as legacyJson from "../../../src/shared/lib/jsonText";
import * as concurrency from "@bycoda/core/concurrent";
import * as legacyConcurrency from "../../../src/shared/lib/concurrent";
import * as titles from "@bycoda/core/session-title";
import * as legacyTitles from "../../../src/features/sessions/model/sessionTitle";

it("desktop/provider/Host compatibility paths use the same canonical functions", () => {
  expect(legacyJson.parseJsonObject).toBe(json.parseJsonObject);
  expect(legacyConcurrency.forEachConcurrent).toBe(concurrency.forEachConcurrent);
  expect(legacyTitles.parseGeneratedSessionTitle).toBe(titles.parseGeneratedSessionTitle);
  expect(
    legacyTitles.parseGeneratedSessionTitle(
      '{"title":"Fix recovery","workItem":{"kind":"pr","number":42}}',
      "PR #42",
    ),
  ).toEqual({
    title: "Fix recovery",
    workItem: { kind: "pr", number: 42 },
  });
});

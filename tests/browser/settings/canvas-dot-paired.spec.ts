import { test } from "@playwright/test";
import { expectPairedProof } from "../crews/paired-proof-test";

for (const dark of [false, true]) {
  test(`paired dot grid ${dark ? "dark" : "light"} rest ripple fade`, async ({
    page,
  }, testInfo) => {
    await expectPairedProof(page, testInfo, { kind: "dots", dark });
  });
}

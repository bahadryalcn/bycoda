import assert from "node:assert/strict";
import test from "node:test";
import { turkishLocaleWarnings } from "./turkish-locale-warnings.mjs";

test("Turkish warnings flag harmony, sign-in terminology and informal imperatives", () => {
  assert.deepEqual(turkishLocaleWarnings("{p12}\u2019dan devam edin."), ["placeholder-suffix"]);
  assert.deepEqual(turkishLocaleWarnings("Hesaba giri\u015f yap\u0131n."), ["sign-in-terminology"]);
  assert.deepEqual(turkishLocaleWarnings("Sen bu dosyay\u0131 kaydet."), ["informal-imperative"]);
  assert.deepEqual(turkishLocaleWarnings("Dosyay\u0131 a\u00e7."), ["informal-imperative"]);
  for (const value of [
    "Oturum a\u00e7\u0131n.",
    "Kaydet",
    "Bu siluet.",
    "Bir dosya se\u00e7in.",
    "{p0} i\u00e7in devam edin.",
  ])
    assert.deepEqual(turkishLocaleWarnings(value), [], value);
});

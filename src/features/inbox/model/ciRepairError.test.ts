import { afterEach, beforeEach, expect, it } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { CiRepairStartError, presentCiRepairError } from "./ciRepairError";

beforeEach(async () => {
  await setLanguagePreference("en");
});
afterEach(async () => {
  await setLanguagePreference("en");
});

it("presents each refusal as a translated sentence, not the stored English message", async () => {
  const busy = new CiRepairStartError("chatBusy", "raw english text");
  expect(presentCiRepairError(busy)).toBe(
    "This chat is busy. Choose another chat or start a new one.",
  );
  expect(presentCiRepairError(new CiRepairStartError("projectRequired", "raw"))).toBe(
    "Choose a local project for this PR first.",
  );
  expect(presentCiRepairError(new CiRepairStartError("chatMismatch", "raw"))).toBe(
    "Choose a chat from this project.",
  );
  expect(presentCiRepairError(new CiRepairStartError("accountChanged", "raw"))).toBe(
    "Account changed; reload checks before repairing.",
  );
  await setLanguagePreference("tr");
  expect(presentCiRepairError(busy)).toBe(
    "Bu sohbet meşgul. Başka bir sohbet seçin ya da yeni bir sohbet başlatın.",
  );
});

it("keeps another failure's cause as redacted detail under a translated summary", async () => {
  const text = presentCiRepairError(new Error("job log failed token=abc123secretvalue"));
  expect(text.startsWith("Could not start the CI repair. job log failed")).toBe(true);
  expect(text).not.toContain("abc123secretvalue");
  expect(presentCiRepairError(undefined)).toBe("Could not start the CI repair.");
  await setLanguagePreference("tr");
  expect(presentCiRepairError(new Error("boom"))).toBe("CI onarımı başlatılamadı. boom");
});

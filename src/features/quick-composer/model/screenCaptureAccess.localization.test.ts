import { expect, it } from "vitest";
import { getLanguagePreference, setLanguagePreference } from "../../../shared/i18n";
import { AttachmentFailureError } from "../../sessions/model/attachmentFailure";
import { captureNotice } from "./screenCaptureAccess";

it("translates typed failures and keeps screen recording recovery tied to the code", async () => {
  const previousLanguage = getLanguagePreference();
  try {
    await setLanguagePreference("tr");
    expect(captureNotice(new AttachmentFailureError("image-too-large", "Internal detail"))).toEqual(
      {
        message: "Bu görsel eklemek için çok büyük.",
      },
    );
    const notice = captureNotice("screen-recording-permission-required");
    expect(notice.message).toContain("Ekran Kaydı erişimi gerekir");
    expect(notice.recovery).toBe("screen-recording");
    expect(captureNotice(new Error(notice.message))).toEqual({ message: notice.message });
  } finally {
    await setLanguagePreference(previousLanguage);
  }
});

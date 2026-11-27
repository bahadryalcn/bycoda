import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLanguagePreference, setLanguagePreference } from "../../../../../shared/i18n";
import { YouTubeFacts, YouTubeResult } from "./YouTubeResult";

const previousLanguage = getLanguagePreference();
afterEach(async () => {
  await setLanguagePreference(previousLanguage);
});

describe("YouTube result localization", () => {
  it("uses translated operation labels and review statuses", async () => {
    await setLanguagePreference("es");

    const markup = renderToStaticMarkup(
      createElement(YouTubeResult, {
        busy: false,
        result: {
          items: [
            {
              id: "review-test-id",
              action: "youtube.video.update",
              status: "awaiting_approval",
            },
          ],
        },
      }),
    );

    expect(markup).toContain("Acción");
    expect(markup).toContain("Editar el vídeo");
    expect(markup).toContain("Pendiente de tu aprobación.");
    expect(markup).toContain("review-test-id");
    expect(markup).not.toContain("youtube.video.update");
    expect(markup).not.toContain("awaiting_approval");
  });

  it("localizes metrics and labels while preserving user content", async () => {
    await setLanguagePreference("ja");

    const markup = renderToStaticMarkup(
      createElement(YouTubeFacts, {
        data: {
          title: "My original title",
          estimatedAdRevenue: 18,
          monetizedPlaybacks: 1024,
          editedText: "My original post",
          status: "scheduled",
        },
      }),
    );

    expect(markup).toContain("My original title");
    expect(markup).toContain("My original post");
    expect(markup).toContain("推定広告収益");
    expect(markup).toContain("収益化対象の再生回数");
    expect(markup).toContain("投稿本文");
    expect(markup).not.toContain("scheduled");
  });
});

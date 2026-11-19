import { describe, expect, it } from "vitest";
import {
  ADD_NOTE_LABELS,
  COMMENT_SUBMIT_LABELS,
  FACEBOOK_MESSAGE_SEND_LABELS,
  FACEBOOK_POST_LABELS,
  INVITATION_SEND_LABELS,
  NEXT_LABELS,
  NEXT_OR_DONE_LABELS,
  POST_LABELS,
  SEND_LABELS,
  SHARE_LABELS,
  ariaLabelSelectors,
} from "./ui-labels";

describe("browser recipe button labels", () => {
  it("names the same button in every app locale", () => {
    expect(SEND_LABELS).toEqual(
      expect.arrayContaining(["Send", "Gönder", "Senden", "Envoyer", "Enviar", "发送", "送信"]),
    );
    expect(POST_LABELS).toEqual(
      expect.arrayContaining(["Post", "Yayınla", "Posten", "Publier", "Publicar", "发布", "投稿する"]),
    );
    expect(SHARE_LABELS).toEqual(
      expect.arrayContaining(["Share", "Paylaş", "Teilen", "Partager", "Compartir", "分享", "シェア"]),
    );
    expect(NEXT_LABELS).toEqual(
      expect.arrayContaining(["Next", "İleri", "Weiter", "Suivant", "Siguiente", "Avançar", "下一步", "次へ"]),
    );
    expect(NEXT_OR_DONE_LABELS).toEqual(expect.arrayContaining([...NEXT_LABELS, "Done", "Bitti", "Fertig"]));
    expect(ADD_NOTE_LABELS).toEqual(expect.arrayContaining(["Add a note", "Not ekle", "Notiz hinzufügen"]));
    expect(INVITATION_SEND_LABELS).toEqual(
      expect.arrayContaining([...SEND_LABELS, "Send invitation", "Davet gönder", "Einladung senden"]),
    );
  });

  it("keeps the previous English and Turkish labels", () => {
    expect(COMMENT_SUBMIT_LABELS).toEqual(expect.arrayContaining(["Post", "Paylaş", "Gönder"]));
    expect(FACEBOOK_POST_LABELS).toEqual(
      expect.arrayContaining(["Post", "Paylaş", "Gönderi paylaş", "Gönder"]),
    );
    expect(FACEBOOK_MESSAGE_SEND_LABELS).toEqual(
      expect.arrayContaining(["Send", "Gönder", "Press Enter to send", "Göndermek için Enter tuşuna bas"]),
    );
  });

  it("does not let one action's label name another action's button", () => {
    const overlap = (a: readonly string[], b: readonly string[]) => a.filter((label) => b.includes(label));
    expect(overlap(SEND_LABELS, SHARE_LABELS)).toEqual([]);
    expect(overlap(POST_LABELS, SHARE_LABELS)).toEqual([]);
    expect(overlap(NEXT_LABELS, SEND_LABELS)).toEqual([]);
    // A post page's own "Share" control must not become a comment submit in English.
    expect(COMMENT_SUBMIT_LABELS).not.toContain("Share");
    expect(COMMENT_SUBMIT_LABELS).not.toContain("Teilen");
    // Only exact labels: no "send without a note" style variant is accepted as an invitation send.
    expect(INVITATION_SEND_LABELS).not.toContain("Send without a note");
  });

  it("builds exact aria-label selector alternatives", () => {
    const selector = ariaLabelSelectors("#main footer button", ["Send", "Envoyer l'invitation"]);
    expect(selector).toBe(
      '#main footer button[aria-label="Send"], #main footer button[aria-label="Envoyer l\'invitation"]',
    );
    expect(ariaLabelSelectors("button", SEND_LABELS).split(", ")).toHaveLength(SEND_LABELS.length);
  });
});

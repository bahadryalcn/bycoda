import type { Locale } from "../../../src/shared/i18n/languages";

/**
 * Visible button labels the browser recipes match exactly (trimmed, whole string) for the account's
 * platform UI language. The managed browser does not force a UI language, so every app locale is listed.
 * Matching stays exact and a recipe still refuses unless exactly one control matches; a label list only
 * names the same intended button, it never widens which destination or action a recipe may take.
 */
export type LocalizedLabels = Readonly<Record<Locale, readonly string[]>>;

const flat = (labels: LocalizedLabels): readonly string[] => [
  ...new Set(Object.values(labels).flat()),
];

const merge = (...parts: LocalizedLabels[]): LocalizedLabels => {
  const locales = Object.keys(parts[0]) as Locale[];
  return Object.fromEntries(
    locales.map((locale) => [locale, parts.flatMap((part) => part[locale])]),
  ) as unknown as LocalizedLabels;
};

const send: LocalizedLabels = {
  en: ["Send"],
  tr: ["Gönder"],
  de: ["Senden"],
  fr: ["Envoyer"],
  es: ["Enviar"],
  pt: ["Enviar"],
  "zh-CN": ["发送"],
  ja: ["送信"],
};

const post: LocalizedLabels = {
  en: ["Post"],
  tr: ["Yayınla"],
  de: ["Posten"],
  fr: ["Publier"],
  es: ["Publicar"],
  pt: ["Publicar"],
  "zh-CN": ["发布"],
  ja: ["投稿する", "投稿"],
};

const share: LocalizedLabels = {
  en: ["Share"],
  tr: ["Paylaş"],
  de: ["Teilen"],
  fr: ["Partager"],
  es: ["Compartir"],
  pt: ["Compartilhar", "Partilhar"],
  "zh-CN": ["分享"],
  ja: ["シェア"],
};

const next: LocalizedLabels = {
  en: ["Next"],
  tr: ["İleri"],
  de: ["Weiter"],
  fr: ["Suivant"],
  es: ["Siguiente"],
  pt: ["Avançar", "Seguinte"],
  "zh-CN": ["下一步"],
  ja: ["次へ"],
};

const done: LocalizedLabels = {
  en: ["Done"],
  tr: ["Bitti"],
  de: ["Fertig"],
  fr: ["Terminé"],
  es: ["Listo"],
  pt: ["Concluído"],
  "zh-CN": ["完成"],
  ja: ["完了"],
};

const addNote: LocalizedLabels = {
  en: ["Add a note"],
  tr: ["Not ekle"],
  de: ["Notiz hinzufügen"],
  fr: ["Ajouter une note"],
  es: ["Añadir una nota"],
  pt: ["Adicionar nota"],
  "zh-CN": ["添加备注"],
  ja: ["メモを追加"],
};

const sendInvitation: LocalizedLabels = {
  en: ["Send invitation"],
  tr: ["Davet gönder"],
  de: ["Einladung senden"],
  fr: ["Envoyer l'invitation"],
  es: ["Enviar invitación"],
  pt: ["Enviar convite"],
  "zh-CN": ["发送邀请"],
  ja: ["招待を送信"],
};

const noLabels = (extra: readonly string[] = []): LocalizedLabels => ({
  en: [],
  tr: extra,
  de: [],
  fr: [],
  es: [],
  pt: [],
  "zh-CN": [],
  ja: [],
});

export const SEND_LABELS = flat(send);
export const POST_LABELS = flat(post);
export const SHARE_LABELS = flat(share);
export const NEXT_LABELS = flat(next);
export const NEXT_OR_DONE_LABELS = flat(merge(next, done));
export const ADD_NOTE_LABELS = flat(addNote);
export const INVITATION_SEND_LABELS = flat(merge(sendInvitation, send));
/** Instagram's comment box submits as "Post"; Turkish accounts have also seen "Paylaş" and "Gönder". */
export const COMMENT_SUBMIT_LABELS = flat(merge(post, noLabels(["Paylaş", "Gönder"])));
/** Facebook's composer submits as "Post"; Turkish accounts have also seen "Paylaş", "Gönderi paylaş" and "Gönder". */
export const FACEBOOK_POST_LABELS = flat(
  merge(post, noLabels(["Paylaş", "Gönderi paylaş", "Gönder"])),
);
/** Facebook's message box: the send control, or its Enter-to-send hint in English and Turkish. */
export const FACEBOOK_MESSAGE_SEND_LABELS: readonly string[] = [
  ...SEND_LABELS,
  "Press Enter to send",
  "Göndermek için Enter tuşuna bas",
];

/** Comma-joined `<prefix>[aria-label="…"]` selector alternatives over a label list. */
export const ariaLabelSelectors = (prefix: string, labels: readonly string[]) =>
  labels.map((label) => `${prefix}[aria-label=${JSON.stringify(label)}]`).join(", ");

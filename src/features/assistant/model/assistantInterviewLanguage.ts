import { LANGUAGES, type Locale } from "../../../shared/i18n/languages";

/** Interview-only copy per app language: name aliases and the first question. Tags come from the shared list. */
const INTERVIEW_COPY: Record<Locale, { aliases: readonly string[]; question: string }> = {
  tr: {
    aliases: ["tr", "turkish", "türkçe"],
    question: "Asistanınızın ne yapmasını veya neyi değiştirmesini istersiniz?",
  },
  en: {
    aliases: ["en", "english"],
    question: "What would you like your assistant to do or change?",
  },
  de: {
    aliases: ["de", "german", "deutsch"],
    question: "Was soll Ihr Assistent tun oder ändern?",
  },
  fr: {
    aliases: ["fr", "french", "français"],
    question: "Que souhaitez-vous que votre assistant fasse ou change ?",
  },
  es: {
    aliases: ["es", "spanish", "español"],
    question: "¿Qué le gustaría que hiciera o cambiara su asistente?",
  },
  pt: {
    aliases: ["pt", "portuguese", "português"],
    question: "O que gostaria que o seu assistente fizesse ou mudasse?",
  },
  "zh-CN": { aliases: ["zh", "chinese", "中文"], question: "您希望助手做什么或改变什么？" },
  ja: {
    aliases: ["ja", "japanese", "日本語"],
    question: "アシスタントに何をしてほしいですか、または何を変えてほしいですか？",
  },
};

const languages = LANGUAGES.map(({ value, tag }) => ({ tag, ...INTERVIEW_COPY[value] }));

function matchLanguage(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/_/g, "-") ?? "";
  return languages.find(
    (item) =>
      item.tag.toLowerCase() === normalized ||
      item.aliases.some((alias) => alias === normalized || alias === normalized.split("-")[0]),
  );
}

export function resolveInterviewLanguage(
  profileLanguage: string | undefined,
  appLocale: string,
): string {
  return (matchLanguage(profileLanguage) ?? matchLanguage(appLocale) ?? languages[1]).tag;
}

export function interviewFirstQuestion(language: string): string {
  return (matchLanguage(language) ?? languages[1]).question;
}

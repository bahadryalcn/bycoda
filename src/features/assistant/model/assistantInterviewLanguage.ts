/** Interview content uses its own language, without changing the app or assistant profile. */
const languages = [
  {
    value: "tr-TR",
    aliases: ["tr", "turkish", "türkçe"],
    question: "Asistanınızın ne yapmasını veya neyi değiştirmesini istersiniz?",
  },
  {
    value: "en-US",
    aliases: ["en", "english"],
    question: "What would you like your assistant to do or change?",
  },
  {
    value: "de-DE",
    aliases: ["de", "german", "deutsch"],
    question: "Was soll Ihr Assistent tun oder ändern?",
  },
  {
    value: "fr-FR",
    aliases: ["fr", "french", "français"],
    question: "Que souhaitez-vous que votre assistant fasse ou change ?",
  },
  {
    value: "es-ES",
    aliases: ["es", "spanish", "español"],
    question: "¿Qué le gustaría que hiciera o cambiara su asistente?",
  },
  {
    value: "pt-PT",
    aliases: ["pt", "portuguese", "português"],
    question: "O que gostaria que o seu assistente fizesse ou mudasse?",
  },
  { value: "zh-CN", aliases: ["zh", "chinese", "中文"], question: "您希望助手做什么或改变什么？" },
  {
    value: "ja-JP",
    aliases: ["ja", "japanese", "日本語"],
    question: "アシスタントに何をしてほしいですか、または何を変えてほしいですか？",
  },
] as const;

function matchLanguage(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/_/g, "-") ?? "";
  return languages.find(
    (item) =>
      item.value.toLowerCase() === normalized ||
      item.aliases.some((alias) => alias === normalized || alias === normalized.split("-")[0]),
  );
}

export function resolveInterviewLanguage(
  profileLanguage: string | undefined,
  appLocale: string,
): string {
  return (matchLanguage(profileLanguage) ?? matchLanguage(appLocale) ?? languages[1]).value;
}

export function interviewFirstQuestion(language: string): string {
  return (matchLanguage(language) ?? languages[1]).question;
}

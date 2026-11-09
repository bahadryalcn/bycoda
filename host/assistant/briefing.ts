type BriefingCounts = {
  waiting: number;
  done: number;
  updates: number;
  hour: number;
  addressAs?: string;
};
const languageKey = (language: string | undefined | null) =>
  language?.toLowerCase().split("-")[0] ?? "en";

type BriefingPhrases = {
  hello: (morning: boolean, name: string) => string;
  waiting: (count: number) => string;
  done: (count: number) => string;
  updates: (count: number) => string;
  /** Separator between sentences; CJK text has none. */
  join: string;
};
const briefingPhrases: Record<string, BriefingPhrases> = {
  tr: {
    hello: (morning, name) =>
      `${morning ? "Günaydın" : "Tekrar hoş geldin"}${name ? `, ${name}` : ""}.`,
    waiting: (n) => `${n} iş ilgini bekliyor.`,
    done: (n) => `Sen yokken ${n} iş tamamlandı.`,
    updates: (n) => `Geçmiş'te ${n} güncelleme var.`,
    join: " ",
  },
  en: {
    hello: (morning, name) =>
      `${morning ? "Good morning" : "Welcome back"}${name ? `, ${name}` : ""}.`,
    waiting: (n) => `${n} jobs need your attention.`,
    done: (n) => `${n} jobs finished while you were away.`,
    updates: (n) => `${n} updates are in History.`,
    join: " ",
  },
  de: {
    hello: (morning, name) =>
      `${morning ? "Guten Morgen" : "Willkommen zurück"}${name ? `, ${name}` : ""}.`,
    waiting: (n) => `${n} Aufgaben brauchen deine Aufmerksamkeit.`,
    done: (n) => `Während deiner Abwesenheit wurden ${n} Aufgaben abgeschlossen.`,
    updates: (n) => `Im Verlauf gibt es ${n} Aktualisierungen.`,
    join: " ",
  },
  fr: {
    hello: (morning, name) => `${morning ? "Bonjour" : "Bon retour"}${name ? `, ${name}` : ""}.`,
    waiting: (n) => `${n} tâches demandent ton attention.`,
    done: (n) => `${n} tâches ont été terminées pendant ton absence.`,
    updates: (n) => `L’historique contient ${n} mises à jour.`,
    join: " ",
  },
  es: {
    hello: (morning, name) =>
      `${morning ? "Buenos días" : "Bienvenido de nuevo"}${name ? `, ${name}` : ""}.`,
    waiting: (n) => `${n} tareas necesitan tu atención.`,
    done: (n) => `Se terminaron ${n} tareas durante tu ausencia.`,
    updates: (n) => `Hay ${n} novedades en el historial.`,
    join: " ",
  },
  pt: {
    hello: (morning, name) =>
      `${morning ? "Bom dia" : "Bem-vindo de volta"}${name ? `, ${name}` : ""}.`,
    waiting: (n) => `${n} tarefas precisam da tua atenção.`,
    done: (n) => `Foram concluídas ${n} tarefas durante a tua ausência.`,
    updates: (n) => `Há ${n} atualizações no histórico.`,
    join: " ",
  },
  zh: {
    hello: (morning, name) => `${morning ? "早上好" : "欢迎回来"}${name ? `，${name}` : ""}。`,
    waiting: (n) => `有 ${n} 项任务需要你处理。`,
    done: (n) => `你离开期间完成了 ${n} 项任务。`,
    updates: (n) => `历史记录中有 ${n} 条更新。`,
    join: "",
  },
  ja: {
    hello: (morning, name) =>
      `${morning ? "おはようございます" : "おかえりなさい"}${name ? `、${name}` : ""}。`,
    waiting: (n) => `確認が必要な仕事は ${n} 件です。`,
    done: (n) => `不在中に ${n} 件の仕事が完了しました。`,
    updates: (n) => `履歴には ${n} 件の更新があります。`,
    join: "",
  },
};

/**
 * Finite summaries use the owner's actual language without an extra model call.
 * Sentences for zero counts are omitted.
 */
export function assistantBriefingText(
  language: string | undefined | null,
  counts: BriefingCounts,
): string {
  const { waiting, done, updates, hour } = counts;
  const phrases = briefingPhrases[languageKey(language)] ?? briefingPhrases.en;
  const name = counts.addressAs?.trim().slice(0, 100) ?? "";
  const sentences = [
    waiting > 0 ? phrases.waiting(waiting) : "",
    done > 0 ? phrases.done(done) : "",
    updates > 0 ? phrases.updates(updates) : "",
  ].filter(Boolean);
  return [phrases.hello(hour < 12, name), ...sentences].join(phrases.join);
}
export function assistantUpdateFallback(language: string | undefined | null): string {
  const messages: Record<string, string> = {
    tr: "Bir güncelleme var. Ayrıntılar için ilgili işe bakabilirsin.",
    en: "An update is available. Open the linked job for its details.",
    de: "Es gibt eine Aktualisierung. Öffne die verknüpfte Aufgabe für Details.",
    fr: "Une mise à jour est disponible. Ouvre la tâche liée pour les détails.",
    es: "Hay una actualización. Abre la tarea vinculada para ver los detalles.",
    pt: "Há uma atualização. Abre a tarefa associada para ver os detalhes.",
    zh: "有新的更新。请打开关联任务查看详情。",
    ja: "更新があります。詳細は関連する仕事を開いて確認してください。",
  };
  return messages[languageKey(language)] ?? messages.en;
}

export type AssistantBriefingSections = {
  decisions?: string[];
  approvals?: string[];
  waiting?: string[];
  done?: string[];
  running?: string[];
  notes?: string[];
  notesUnavailable?: boolean;
  approvalsIncomplete?: boolean;
};
/** Bounded factual text. Source text stays quoted data; no model or execution port. */
export function assistantDetailedBriefingText(
  language: string | undefined | null,
  counts: BriefingCounts,
  sections: AssistantBriefingSections,
): string {
  const labels: Record<string, string[]> = {
    en: [
      "Your decisions",
      "Approvals",
      "Needs attention",
      "Completed",
      "In progress",
      "Today and yesterday's notes",
      "Some note details are unavailable.",
      "Some approval sources could not be verified.",
    ],
    tr: [
      "Kararların",
      "Onaylar",
      "İlgi bekleyenler",
      "Tamamlananlar",
      "Devam edenler",
      "Bugünün ve dünün notları",
      "Bazı not ayrıntıları kullanılamıyor.",
      "Bazı onay kaynakları doğrulanamadı.",
    ],
    de: [
      "Deine Entscheidungen",
      "Genehmigungen",
      "Benötigt Aufmerksamkeit",
      "Abgeschlossen",
      "In Arbeit",
      "Notizen von heute und gestern",
      "Einige Notizdetails sind nicht verfügbar.",
      "Einige Genehmigungsquellen konnten nicht bestätigt werden.",
    ],
    fr: [
      "Tes décisions",
      "Autorisations",
      "À examiner",
      "Terminé",
      "En cours",
      "Notes d’aujourd’hui et d’hier",
      "Certains détails des notes sont indisponibles.",
      "Certaines sources d’autorisation n’ont pas pu être vérifiées.",
    ],
    es: [
      "Tus decisiones",
      "Aprobaciones",
      "Requiere atención",
      "Completado",
      "En curso",
      "Notas de hoy y ayer",
      "Algunos detalles de las notas no están disponibles.",
      "No se pudieron verificar algunas solicitudes de aprobación.",
    ],
    pt: [
      "Tuas decisões",
      "Aprovações",
      "Precisa de atenção",
      "Concluído",
      "Em andamento",
      "Notas de hoje e ontem",
      "Alguns detalhes das notas estão indisponíveis.",
      "Algumas origens de aprovação não puderam ser verificadas.",
    ],
    zh: [
      "需要你决定",
      "待批准",
      "需要关注",
      "已完成",
      "进行中",
      "今天和昨天的笔记",
      "部分笔记详情不可用。",
      "部分批准请求的来源无法验证。",
    ],
    ja: [
      "あなたの判断",
      "承認待ち",
      "確認が必要",
      "完了",
      "進行中",
      "今日と昨日のメモ",
      "一部のメモの詳細を利用できません。",
      "一部の承認元を確認できませんでした。",
    ],
  };
  const words = labels[languageKey(language)] ?? labels.en,
    keys = ["decisions", "approvals", "waiting", "done", "running", "notes"] as const,
    lines = [assistantBriefingText(language, counts)];
  for (const [index, key] of keys.entries()) {
    const values = sections[key] ?? [];
    if (values.length)
      lines.push(
        `${words[index]}:`,
        ...values
          .slice(0, 4)
          .map((value) => `• ${value.replace(/\s+/g, " ").trim().slice(0, 280)}`),
      );
  }
  if (sections.notesUnavailable) lines.push(words[6]);
  if (sections.approvalsIncomplete) lines.push(words[7]);
  return lines.join("\n").slice(0, 6000);
}

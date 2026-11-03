type BriefingCounts = {
  waiting: number;
  done: number;
  updates: number;
  hour: number;
  addressAs?: string;
};
const languageKey = (language: string | undefined | null) =>
  language?.toLowerCase().split("-")[0] ?? "en";

/** Finite summaries use the owner's actual language without an extra model call. */
export function assistantBriefingText(
  language: string | undefined | null,
  counts: BriefingCounts,
): string {
  const { waiting, done, updates, hour } = counts;
  const greeting = hour < 12;
  const name = counts.addressAs?.trim().slice(0, 100) ?? "";
  const address = name ? `, ${name}` : "";
  const templates: Record<string, string> = {
    tr: `${greeting ? "Günaydın" : "Tekrar hoş geldin"}${address}. ${waiting} iş ilgini bekliyor. Sen yokken ${done} iş tamamlandı. Geçmiş'te ${updates} güncelleme var.`,
    en: `${greeting ? "Good morning" : "Welcome back"}${address}. ${waiting} jobs need your attention. ${done} jobs finished while you were away. ${updates} updates are in History.`,
    de: `${greeting ? "Guten Morgen" : "Willkommen zurück"}${address}. ${waiting} Aufgaben brauchen deine Aufmerksamkeit. Während deiner Abwesenheit wurden ${done} Aufgaben abgeschlossen. Im Verlauf gibt es ${updates} Aktualisierungen.`,
    fr: `${greeting ? "Bonjour" : "Bon retour"}${address}. ${waiting} tâches demandent ton attention. ${done} tâches ont été terminées pendant ton absence. L’historique contient ${updates} mises à jour.`,
    es: `${greeting ? "Buenos días" : "Bienvenido de nuevo"}${address}. ${waiting} tareas necesitan tu atención. Se terminaron ${done} tareas durante tu ausencia. Hay ${updates} novedades en el historial.`,
    pt: `${greeting ? "Bom dia" : "Bem-vindo de volta"}${address}. ${waiting} tarefas precisam da tua atenção. Foram concluídas ${done} tarefas durante a tua ausência. Há ${updates} atualizações no histórico.`,
    zh: `${greeting ? "早上好" : "欢迎回来"}${name ? `，${name}` : ""}。有 ${waiting} 项任务需要你处理。你离开期间完成了 ${done} 项任务。历史记录中有 ${updates} 条更新。`,
    ja: `${greeting ? "おはようございます" : "おかえりなさい"}${name ? `、${name}` : ""}。確認が必要な仕事は ${waiting} 件です。不在中に ${done} 件の仕事が完了しました。履歴には ${updates} 件の更新があります。`,
  };
  return templates[languageKey(language)] ?? templates.en;
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

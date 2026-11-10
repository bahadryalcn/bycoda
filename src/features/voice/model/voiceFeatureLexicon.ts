/** Search vocabulary only; these words never grant permission or select a target.
 * Labels mirror the top-level UI translations in the eight supported locales.
 */
const features: Record<string, string[]> = {
  crews: [
    "crew",
    "crews",
    "ekip",
    "ekipler",
    "takım",
    "kurü",
    "kru",
    "equipo",
    "equipos",
    "équipe",
    "équipes",
    "equipe",
    "equipes",
    "クルー",
    "小队",
  ],
  tasks: [
    "tasks",
    "task",
    "görev",
    "görevler",
    "aufgaben",
    "tareas",
    "tâches",
    "tarefas",
    "タスク",
    "任务",
  ],
  notes: ["notes", "note", "notlar", "not", "notizen", "notas", "remarques", "注意事項", "注释"],
  projects: [
    "projects",
    "project",
    "proje",
    "projeler",
    "projekte",
    "proyectos",
    "projets",
    "projetos",
    "プロジェクト",
    "项目",
  ],
  inbox: [
    "inbox",
    "gelen kutusu",
    "posteingang",
    "bandeja de entrada",
    "boîte de réception",
    "caixa de entrada",
    "受信箱",
    "收件箱",
  ],
  archive: [
    "archive",
    "arşiv",
    "arşivle",
    "archiv",
    "archivo",
    "archives",
    "arquivo",
    "アーカイブ",
    "存档",
  ],
  settings: [
    "settings",
    "ayarlar",
    "ayar",
    "einstellungen",
    "configuración",
    "paramètres",
    "configurações",
    "設定",
    "设置",
  ],
  servers: [
    "servers",
    "server",
    "sunucu",
    "sunucular",
    "ssh",
    "remote machine",
    "uzak makine",
    "servidores",
    "serveurs",
    "サーバー",
    "服务器",
  ],
  devservers: [
    "dev server",
    "dev servers",
    "development server",
    "local server",
    "localhost",
    "local host",
    "dev sunucu",
    "dev sunucusu",
    "geliştirme sunucusu",
    "lokal sunucu",
    "yerel sunucu",
    "lokal host",
    "ayağa kaldır",
  ],
  search: ["search", "ara", "suchen", "buscar", "recherche", "pesquisa", "検索", "搜索"],
  sessions: [
    "sessions",
    "session",
    "oturum",
    "oturumlar",
    "sohbet",
    "conversation",
    "konuşma",
    "sitzungen",
    "sesiones",
    "セッション",
    "sessões",
    "会话",
  ],
  automations: [
    "automations",
    "automation",
    "otomasyon",
    "otomasyonlar",
    "zamanlanmış işler",
    "automatisierungen",
    "automatizaciones",
    "automatismes",
    "自動化",
    "automações",
    "自动化",
  ],
  social: ["social", "sosyal", "social media", "sosyal medya"],
  logs: [
    "logs",
    "log",
    "loglar",
    "günlük",
    "kayıtlar",
    "diagnostics",
    "tanılama",
    "protokolle",
    "registros",
    "journaux",
    "ログ",
    "日志",
  ],
  goals: ["goals", "hedef", "hedefler", "ziele", "metas", "objectifs", "目標", "目标"],
  skills: [
    "skills",
    "skill",
    "yetenek",
    "yetenekler",
    "fähigkeiten",
    "habilidades",
    "compétences",
    "スキル",
    "技能",
  ],
  providers: [
    "providers",
    "provider",
    "sağlayıcı",
    "sağlayıcılar",
    "anbieter",
    "proveedores",
    "fournisseurs",
    "プロバイダー",
    "provedores",
    "供应商",
  ],
  terminals: [
    "terminals",
    "terminal",
    "terminaller",
    "terminales",
    "terminaux",
    "borne",
    "ターミナル",
    "端子",
    "terminais",
    "终端",
  ],
  usage: ["usage", "kullanım", "verwendung", "uso", "utilisation", "使用法", "用途"],
  devices: [
    "devices",
    "device",
    "cihaz",
    "cihazlar",
    "geräte",
    "dispositivos",
    "appareils",
    "デバイス",
    "设备",
  ],
  browser: [
    "browser",
    "web page",
    "website",
    "site",
    "tarayıcı",
    "web sayfası",
    "navegador",
    "navigateur",
    "ブラウザー",
    "浏览器",
  ],
  files: [
    "files",
    "file",
    "dosya",
    "dosyalar",
    "dateien",
    "archivos",
    "fichiers",
    "ファイル",
    "arquivos",
    "文件",
  ],
  models: ["models", "model", "modeller", "modelle", "modelos", "modèles", "モデル", "型号"],
  agents: ["agents", "agent", "ajan", "ajanlar", "agenten", "agentes", "エージェント", "代理商"],
  jobs: ["jobs", "job", "işler", "aufträge", "trabajos", "travaux", "仕事", "trabalhos", "工作"],
  assistant: [
    "assistant",
    "asistan",
    "assistent",
    "asistente",
    "アシスタント",
    "assistente",
    "助手",
  ],
  notifications: [
    "notifications",
    "bildirimler",
    "benachrichtigungen",
    "notificaciones",
    "通知",
    "notificações",
  ],
  git: [
    "git",
    "commit",
    "branch",
    "stash",
    "pull",
    "dal",
    "değişiklik",
    "değişiklikler",
    "değişikliklerini",
  ],
  sprints: ["sprint", "sprints"],
  pullRequests: [
    "pull request",
    "pull requests",
    "pr",
    "ci",
    "birleştirme isteği",
    "birleştirme istekleri",
  ],
  notebook: ["notebook", "personal note", "not defteri", "kişisel not"],
  desktop: [
    "desktop",
    "screen",
    "computer",
    "click",
    "window",
    "app",
    "masaüstü",
    "ekran",
    "bilgisayar",
    "tıkla",
    "pencere",
    "uygulama",
  ],
  preferences: [
    "preferences",
    "theme",
    "density",
    "language setting",
    "tema",
    "yoğunluk",
    "dil ayarı",
  ],
  mcp: ["mcp", "mcp sunucu", "mcp sunucuları", "mcp server", "mcp servers"],
  today: ["today", "bugün", "bugünkü", "heute", "hoy", "aujourd'hui", "hoje", "今日", "今天"],
};

const hintLabels: Record<string, string> = {
  tr: "ekipler, takımlar, görevler, projeler, oturumlar, otomasyonlar, notlar, gelen kutusu, yetenekler, cihazlar, tarayıcı",
  en: "crews, tasks, projects, sessions, automations, notes, inbox, skills, devices, browser",
  de: "Crews, Aufgaben, Projekte, Sitzungen, Automatisierungen, Notizen, Posteingang, Fähigkeiten, Geräte, Browser",
  es: "equipos, tareas, proyectos, sesiones, automatizaciones, notas, bandeja de entrada, habilidades, dispositivos, navegador",
  fr: "équipes, tâches, projets, sessions, automatismes, remarques, boîte de réception, compétences, appareils, navigateur",
  pt: "equipes, tarefas, projetos, sessões, automações, notas, caixa de entrada, habilidades, dispositivos, navegador",
  ja: "クルー, タスク, プロジェクト, セッション, 自動化, 注意事項, 受信箱, スキル, デバイス, ブラウザー",
  zh: "小队, 任务, 项目, 会话, 自动化, 注释, 收件箱, 技能, 设备, 浏览器",
};
const hintSuffix = "Crews, Tasks, Projects, Sessions, MCP.";
const hintWords = (text: string) =>
  text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const hintVocabulary = new Set(
  hintWords(["Bycoda", hintSuffix, ...Object.values(hintLabels)].join(" ")),
);

/** Public product vocabulary only: never include private names, drafts or history. */
export function voiceTranscriptionHint(language: string): string {
  const code = language.toLowerCase().split("-")[0];
  return `Bycoda. ${hintLabels[code] ?? hintLabels.en}. ${hintSuffix}`;
}

/** A hint word, or its singular as recognizers reshape it ("crew" for "crews", "ekip" for "ekipler"). */
const isHintWord = (word: string) =>
  hintVocabulary.has(word) ||
  (word.length >= 3 && [...hintVocabulary].some((hint) => hint.startsWith(word)));

/** Recognizers can return their vocabulary prompt for silence or noise. A turn
 * made only of four or more hint words is that echo, not something the owner said. */
export function isVoiceTranscriptionHintEcho(text: string): boolean {
  const words = hintWords(text);
  return words.length >= 4 && words.every(isHintWord);
}

export const VOICE_FEATURE_CONTEXT =
  "Interpret application feature names in the user's language and mixed-language speech. For example, Turkish ekipler/takımlar refer to Crews and görevler to Tasks. Discover the canonical capability; do not invent a feature or silently rewrite an ambiguous proper name. Ask one brief clarification when the feature or target remains ambiguous.";

const actions: Record<string, string[]> = {
  list: [
    "list",
    "liste",
    "listele",
    "göster",
    "aç",
    "open",
    "show",
    "lista",
    "リスト",
    "列表",
    "öffnen",
    "abrir",
    "ouvrir",
    "オープン",
    "打开",
  ],
  read: ["read", "oku", "okuma", "lesen", "lectura", "lecture", "読み取り", "leitura", "读取"],
  create: [
    "create",
    "oluştur",
    "yeni",
    "new",
    "erstellen",
    "crear",
    "créer",
    "作成",
    "criar",
    "创建",
  ],
  update: [
    "update",
    "güncelle",
    "düzenle",
    "edit",
    "bearbeiten",
    "editar",
    "modifier",
    "編集",
    "编辑",
    "actualización",
    "mise à jour",
    "アップデート",
    "atualização",
    "更新",
  ],
  delete: ["delete", "sil", "löschen", "eliminar", "supprimer", "削除", "excluir", "删除"],
  start: [
    "start",
    "başlat",
    "çalıştır",
    "run",
    "inicio",
    "démarrer",
    "スタート",
    "iniciar",
    "开始",
  ],
  stop: ["stop", "durdur", "stopp", "detener", "arrêter", "停止", "parar"],
  pause: ["pause", "duraklat", "pausa", "一時停止", "暂停"],
  resume: [
    "resume",
    "sürdür",
    "devam",
    "devam et",
    "fortsetzen",
    "reanudar",
    "reprendre",
    "再開",
    "retomar",
    "继续",
  ],
  cancel: ["cancel", "abort", "iptal", "iptal et", "vazgeç"],
  send: ["send", "post", "reply", "gönder", "yolla", "cevapla", "yanıtla"],
  approve: ["approve", "confirm", "accept", "onayla", "kabul et"],
  close: ["close", "kapat"],
  rename: ["rename", "yeniden adlandır", "adını değiştir"],
  refresh: ["refresh", "reload", "yenile"],
};

function normalize(value: string): string {
  return value.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "");
}

// Restrict stemming to known Turkish suffixes; do not fuzzy-match names such as Kree.
function matches(word: string, alias: string): boolean {
  if (word === alias) return true;
  if (alias.length < 3 || !word.startsWith(alias)) return false;
  return /^(?:ler|lar|leri|lari|lerim|larim|lerimiz|larimiz|im|imden|imiz|in|iniz|de|da|te|ta|den|dan|ten|tan|deki|daki|teki|taki|e|a|i|u|yi|ya|ye|yu|ni|su|sunu|nin|nun|nunki|lerindeki|lerdeki)$/.test(
    word.slice(alias.length),
  );
}

type Group = { canonical: string; words: string[] };
const groups = (source: Record<string, string[]>): Group[] =>
  Object.entries(source).map(([canonical, words]) => ({ canonical, words: words.map(normalize) }));
const featureGroups = groups(features);
const actionGroups = groups(actions);

/** Each query clause is conjunctive, while aliases within one clause are alternatives. */
export function voiceSearchClauses(
  query: string,
): Array<{ text: string; feature?: string; action?: string }> {
  let remaining = normalize(query);
  const clauses: Array<{ text: string; feature?: string; action?: string }> = [];
  // Consume multiword labels first so their individual words do not become extra requirements.
  const phrases = [
    ...featureGroups.flatMap((group) =>
      group.words
        .filter((word) => word.includes(" "))
        .map((word) => ({ word, group, kind: "feature" as const })),
    ),
    ...actionGroups.flatMap((group) =>
      group.words
        .filter((word) => word.includes(" "))
        .map((word) => ({ word, group, kind: "action" as const })),
    ),
  ];
  for (const { word, group, kind } of phrases.sort((a, b) => b.word.length - a.word.length)) {
    if (remaining.includes(word)) {
      clauses.push({ text: word, [kind]: group.canonical });
      remaining = remaining.replace(word, " ");
    }
  }
  for (const word of remaining.match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    const feature = featureGroups.find((group) =>
      group.words.some((alias) => matches(word, alias)),
    );
    const action = actionGroups.find((group) => group.words.some((alias) => matches(word, alias)));
    clauses.push({
      text: word,
      ...(feature ? { feature: feature.canonical } : {}),
      ...(action ? { action: action.canonical } : {}),
    });
  }
  return clauses;
}

export function normalizeVoiceSearch(value: string): string {
  return normalize(value);
}

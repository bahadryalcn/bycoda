// The self-contained page the browser tab shows after an MCP loopback sign-in: inline CSS
// and SVG only, no scripts and no external requests. Mirrors the desktop page in
// `src-tauri/src/oauth_loopback_page.rs`; text is English or Turkish by `Accept-Language`.

export type OAuthPageKind = "success" | "failure" | "cancelled" | "invalid";
type Lang = "en" | "tr";

const TEXTS: Record<Lang, Record<OAuthPageKind, [string, string]>> = {
  en: {
    success: ["You're signed in", "You can close this tab and go back to bycoda."],
    failure: ["Sign-in didn't complete", "Go back to bycoda to try again."],
    cancelled: [
      "Sign-in cancelled",
      "Nothing was changed. Go back to bycoda whenever you want to try again.",
    ],
    invalid: ["This link isn't valid", "Start sign-in again from bycoda."],
  },
  tr: {
    success: ["Oturum açıldı", "Bu sekmeyi kapatıp bycoda'ya dönebilirsin."],
    failure: ["Oturum açma tamamlanamadı", "Tekrar denemek için bycoda'ya dön."],
    cancelled: [
      "Oturum açma iptal edildi",
      "Hiçbir şey değişmedi. Tekrar denemek istediğinde bycoda'ya dön.",
    ],
    invalid: ["Bu bağlantı geçerli değil", "Oturum açmayı bycoda'dan yeniden başlat."],
  },
};

const STYLE =
  ":root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--ink:#0f1115;--muted:#5c6370;--line:#e2e4e9;--ok:#15803d;--bad:#b91c1c;--warn:#92400e}" +
  "@media(prefers-color-scheme:dark){:root{--bg:#08090b;--card:#121317;--ink:#f3f4f6;--muted:#a3acb8;--line:#23262d;--ok:#4ade80;--bad:#f87171;--warn:#fbbf24}}" +
  "*{box-sizing:border-box}" +
  "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font:15px/1.5 'Mona Sans',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}" +
  "main{width:100%;max-width:420px;padding:36px 32px 32px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.06)}" +
  ".brand{margin:0 0 28px;font-size:18px;font-weight:700;letter-spacing:-.02em}" +
  ".icon{width:48px;height:48px;margin:0 auto 16px;display:block}" +
  "h1{margin:0 0 8px;font-size:20px;font-weight:650;letter-spacing:-.01em}" +
  "p{margin:0;color:var(--muted)}" +
  ".ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}";

const SVG = (tone: string, paths: string) =>
  `<svg class="icon ${tone}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS: Record<OAuthPageKind, string> = {
  success: SVG("ok", '<circle cx="24" cy="24" r="20"/><path d="M15 25l6 6 12-13"/>'),
  failure: SVG("bad", '<path d="M24 5L2.5 42h43z"/><path d="M24 19v10M24 35v.5"/>'),
  cancelled: SVG("warn", '<circle cx="24" cy="24" r="20"/><path d="M17 24h14"/>'),
  invalid: SVG("bad", '<path d="M24 5L2.5 42h43z"/><path d="M24 19v10M24 35v.5"/>'),
};

/** Turkish when the browser's most preferred language is Turkish; otherwise English. */
function langOf(acceptLanguage: string | undefined): Lang {
  const first = (acceptLanguage ?? "").split(",")[0]!.trim().toLowerCase();
  return first === "tr" || first.startsWith("tr-") || first.startsWith("tr;") ? "tr" : "en";
}

/** Full HTML document; every string is a fixed literal, so nothing needs escaping. */
export function oauthPage(kind: OAuthPageKind, acceptLanguage: string | undefined): string {
  const lang = langOf(acceptLanguage);
  const [title, hint] = TEXTS[lang][kind];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>bycoda</title><style>${STYLE}</style></head><body><main><div class="brand">bycoda</div>${ICONS[kind]}<h1>${title}</h1><p>${hint}</p></main></body></html>`;
}

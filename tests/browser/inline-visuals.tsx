import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { InlineVisual } from "../../src/features/sessions/ui/InlineVisual";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
localStorage.setItem("bycoda.language", "en");
mockWindows("inline-visual-fixture");
const controls = { fail: params.has("error"), calls: [] as string[] };
Object.assign(window, { inlineVisualFixture: controls });
mockIPC(
  async (command, args) => {
    if (command === "create_html_preview") {
      controls.calls.push(command);
      if (controls.fail) throw new Error("Preview unavailable. Reload to try again.");
      const response = await fetch("/__inline-preview", {
        method: "POST",
        body: String((args as { content: string }).content),
      });
      if (!response.ok) throw new Error("Fixture preview transport failed.");
      return response.text();
    }
    if (command === "close_html_preview") {
      controls.calls.push(command);
      await fetch(`/__inline-preview/${(args as { token: string }).token}`, { method: "DELETE" });
    }
    return null;
  },
  { shouldMockEvents: true },
);
const internals = (
  window as unknown as {
    __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol?: string) => string };
  }
).__TAURI_INTERNALS__;
internals.convertFileSrc = (token, protocol) => {
  if (protocol !== "html-preview") throw new Error("Fixture has no file authority.");
  return `${location.origin}/__inline-preview/${encodeURIComponent(token)}`;
};
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
await languageReady;

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><style>
:root{--bg:light-dark(#fafaf9,#181818);--text:light-dark(#242422,#e9e9e6);--muted:light-dark(#73736b,#a5a59a);--line:light-dark(#dfdfd8,#383833);--accent:light-dark(#376855,#a9d4ba)}*{box-sizing:border-box}body{margin:0;padding:26px 28px;background:var(--bg);color:var(--text);font:14px/1.55 system-ui}header{display:flex;justify-content:space-between;gap:12px;align-items:start}small{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}h1{font-size:22px;letter-spacing:-.04em;line-height:1.2;margin:7px 0 9px}p{margin:0;color:var(--muted)}.flow{display:grid;grid-template-columns:1fr 28px 1fr 28px 1fr;align-items:center;margin:27px 0 21px}.step{border-top:2px solid var(--line);padding-top:12px}.step b{display:block;font-size:14px;margin-bottom:3px}.step span{font-size:12px;color:var(--muted)}.arrow{text-align:center;color:var(--muted)}footer{border-top:1px solid var(--line);padding-top:15px;display:flex;gap:16px;justify-content:space-between;align-items:center}button{font:inherit;white-space:nowrap;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--text);padding:7px 11px;cursor:pointer}button:hover{border-color:var(--accent)}#count{color:var(--accent);font-weight:600}footer p{font-size:12px}@media(max-width:460px){body{padding:20px}.flow{grid-template-columns:1fr;gap:12px;margin:21px 0}.arrow{display:none}.step{padding-top:8px}footer{align-items:start;flex-direction:column;gap:12px}}
</style><header><div><small>Working with references</small><h1>Keep context attached.</h1><p>A selection becomes a reference you can continue from.</p></div></header><div class="flow"><div class="step"><b>01 · Select</b><span>Choose a useful part of the answer.</span></div><div class="arrow">→</div><div class="step"><b>02 · Comment</b><span>Add what you want to change.</span></div><div class="arrow">→</div><div class="step"><b>03 · Continue</b><span>Send both with the next message.</span></div></div><footer><p>Try the interaction. <span id="count">0 references</span></p><button onclick="const n=Number(this.dataset.n||0)+1;this.dataset.n=n;document.getElementById('count').textContent=n+' reference'+(n===1?'':'s')">Add a reference ↗</button></footer></html>`;

createRoot(document.getElementById("root")!).render(
  <main className="min-h-dvh bg-(--ui-surface) text-content" data-session-drop="fixture-session">
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-6 py-6 sm:px-10">
      <header className="mb-9 flex items-center justify-between gap-3 text-ui-caption text-(--ui-text-muted)">
        <span>
          bycoda <span className="mx-2">/</span> Chat experience
        </span>
        <span>Local fixture</span>
      </header>
      <div className="mb-7 ml-auto max-w-xl rounded-xl bg-(--ui-surface-raised) px-4 py-3 text-ui-body">
        Show me how selected text and comments stay together in the next message.
      </div>
      <article className="min-w-0 flex-1">
        <p className="mb-3 text-ui-caption text-(--ui-text-muted)">bycoda</p>
        <p className="mb-4 text-ui-body leading-relaxed">
          The reference keeps the original selection and your comment together. Here’s the flow:
        </p>
        <InlineVisual
          snapshot={{ version: 1, title: "From selection to reference", html, height: 340 }}
        />
        <p className="mt-4 max-w-2xl text-ui-body leading-relaxed">
          You can edit the comment before sending. Opening the reference brings you back to the
          original answer.
        </p>
      </article>
      <label className="mt-8 block rounded-xl border border-(--ui-pane-border) bg-(--ui-surface) p-3">
        <span className="sr-only">Message</span>
        <textarea
          aria-label="Message"
          defaultValue="Keep my existing draft."
          className="min-h-16 w-full resize-none bg-transparent text-ui-body outline-none"
        />
        <span className="text-ui-caption text-(--ui-text-muted)">
          GPT-6.1-Sol <span className="mx-2">·</span> monocode
        </span>
      </label>
    </div>
  </main>,
);

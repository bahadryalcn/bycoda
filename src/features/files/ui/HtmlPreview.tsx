import { t, useLocale } from "../../../shared/i18n/technical";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/** A separate protocol and opaque sandbox keep generated scripts out of the app. */
export function HtmlPreview({
  path,
  source,
  active,
}: {
  path: string;
  source: string;
  active: boolean;
}) {
  useLocale();
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let token: string | undefined;
    setState({});
    void invoke<string>("create_html_preview", { path, content: source })
      .then((id) => {
        token = id;
        if (cancelled) {
          void invoke("close_html_preview", { token: id });
          return;
        }
        setState({ url: convertFileSrc(`${id}/index.html`, "html-preview") });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ error: String(error) });
      });
    return () => {
      cancelled = true;
      if (token) void invoke("close_html_preview", { token });
    };
  }, [path, source, active, reload]);

  if (!active) return null;
  if (state.error)
    return (
      <div role="alert" className="p-6 text-[12px] text-red-400">
        {state.error}
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-9 shrink-0 items-center border-b border-stroke bg-surface px-3">
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="text-[12px] text-content/70 hover:text-content"
        >
          {t("Reload preview")}
        </button>
      </div>
      {state.url ? (
        <iframe
          title={t("HTML live preview")}
          src={state.url}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0"
        />
      ) : (
        <p className="p-6 text-[12px] text-gray-500">{t("Opening preview…")}</p>
      )}
    </div>
  );
}

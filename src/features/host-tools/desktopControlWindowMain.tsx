import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DesktopControlStrip } from "./DesktopControlStrip";
import { bootSecondaryWindowAppearance } from "../settings/model/secondaryWindowAppearance";
import { languageReady, t, useLocale } from "../../shared/i18n";
import { installNativeContextMenuGuard } from "../../shared/lib/nativeContextMenu";
import "../../styles/index.css";
import { InlineError } from "../../shared/ui/InlineError";
installNativeContextMenuGuard();
bootSecondaryWindowAppearance();
function IndicatorWindow() {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const height = root.current?.getBoundingClientRect().height;
      if (height) void invoke("desktop_control_indicator_fit", { height }).catch(() => undefined);
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="@container p-1">
      <DesktopControlStrip
        floating
        onDismiss={() => {
          void invoke("desktop_control_indicator_dismiss").catch(() =>
            setNotice(t("Computer control status is unavailable. Stop remains available.")),
          );
        }}
      />
      {notice && <InlineError>{notice}</InlineError>}
    </div>
  );
}
void languageReady
  .catch(() => undefined)
  .then(() =>
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <IndicatorWindow />
      </React.StrictMode>,
    ),
  );

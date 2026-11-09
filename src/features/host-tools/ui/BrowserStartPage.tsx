import { useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Globe, X } from "../../../shared/ui/icons";
import { forgetBrowserUrl, readBrowserRecents } from "../model/browserRecents";

/** Shown while no frame exists: what to do next, plus recently opened addresses. */
export function BrowserStartPage({
  description,
  disabled,
  onOpen,
}: {
  description: string;
  disabled: boolean;
  onOpen: (url: string) => void;
}) {
  const [recents, setRecents] = useState(readBrowserRecents);
  return (
    <div className="host-browser-start">
      <div className="host-browser-start-body">
        <Globe className="host-browser-start-icon" aria-hidden />
        <p className="host-browser-start-text">{description}</p>
        {recents.length ? (
          <section className="host-browser-recents" aria-label={t("Recent")}>
            <h4 className="host-browser-recents-title">{t("Recent")}</h4>
            <ul>
              {recents.map((url) => (
                <li key={url}>
                  <Button
                    variant="item"
                    disabled={disabled}
                    startIcon={<Globe className="icon-sm" aria-hidden />}
                    aria-label={t("Open {p0}", { p0: url })}
                    onClick={() => onOpen(url)}
                  >
                    <span className="host-browser-recent-url">{url}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    label={t("Remove {p0}", { p0: url })}
                    onClick={() => setRecents(forgetBrowserUrl(url))}
                  >
                    <X className="icon-sm" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

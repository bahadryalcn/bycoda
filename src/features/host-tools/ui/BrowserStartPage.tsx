import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Globe, X } from "../../../shared/ui/icons";
import { forgetBrowserUrl, readBrowserRecents } from "../model/browserRecents";

/** Shown while no frame exists: what to do next, plus recently opened addresses. */
export function BrowserStartPage({
  disabled,
  onOpen,
}: {
  /** Kept for callers; the empty state is the address bar alone. */
  description?: string;
  disabled: boolean;
  onOpen: (url: string) => void;
}) {
  const [recents, setRecents] = useState(readBrowserRecents);
  return (
    <div {...surfaceAttributes({ variant: "canvas" }, "host-browser-start")}>
      <div className="host-browser-start-body">
        {recents.length ? (
          <section className="host-browser-recents" aria-label={t("Recent")}>
            <ul {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" })}>
              {recents.map((url) => (
                <li key={url} {...surfaceAttributes({ separator: "pane-block" })}>
                  <Button
                    variant="item"
                    disabled={disabled}
                    startIcon={<Globe className="icon-sm" aria-hidden />}
                    aria-label={t("Open {p0}", { p0: url })}
                    onClick={() => onOpen(url)}
                  >
                    <Text
                      as="span"
                      size="inherit"
                      tone="inherit"
                      leading="inherit"
                      truncate
                      className="host-browser-recent-url"
                    >
                      {url}
                    </Text>
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

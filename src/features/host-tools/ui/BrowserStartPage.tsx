import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
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
    <div {...surfaceAttributes({ variant: "canvas-surface" }, "host-browser-start")}>
      <div className="host-browser-start-body">
        <Globe className="host-browser-start-icon" tone="secondary" aria-hidden />
        <Text
          size="body"
          tone="secondary"
          leading="inherit"
          as="p"
          className="host-browser-start-text"
        >
          {description}
        </Text>
        {recents.length ? (
          <section className="host-browser-recents" aria-label={t("Recent")}>
            <SectionLabel as="h4" className="host-browser-recents-title">
              {t("Recent")}
            </SectionLabel>
            <ul {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" })}>
              {recents.map((url) => (
                <li key={url}>
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

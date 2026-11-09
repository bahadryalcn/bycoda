import { t, useLocale } from "../../../../../shared/i18n";
import { terminalFontFamily } from "../../../model/appearancePreferences";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import "./TypographySamples.css";

/**
 * One live preview of the interface, code and terminal fonts together. The interface and code
 * samples read the applied font variables; the terminal sample follows the terminal settings.
 */
export function TypographyPreview({
  appearance: a,
  sampleSize,
}: {
  appearance: AppearanceSettings;
  sampleSize: number;
}) {
  useLocale();
  const p = a.preferences;
  const family = terminalFontFamily(p);
  return (
    <aside className="typography-preview" aria-label={t("Typography preview")}>
      <section className="typography-preview-block">
        <h4 className="typography-preview-label">{t("Interface")}</h4>
        <div className="font-specimen" style={{ fontSize: sampleSize }}>
          <p className="font-specimen-headline">{t("Agents are working, you think.")}</p>
          <p className="font-specimen-body">
            The quick brown fox jumps over the lazy dog · ğüşıöç İ · 0123456789 · Il1 O0
          </p>
        </div>
      </section>
      <section className="typography-preview-block">
        <h4 className="typography-preview-label">{t("Code")}</h4>
        <pre className="code-sample" aria-label={t("Code font preview")}>
          <code>
            <span className="code-sample-line code-sample-comment">{"// bycoda · TypeScript"}</span>
            <span className="code-sample-line">
              <span className="code-sample-keyword">const</span>
              {" message = "}
              <span className="code-sample-string">{'"Hello, bycoda"'}</span>
              {";"}
            </span>
            <span className="code-sample-line">
              <span className="code-sample-keyword">if</span>
              {" (a !== b && x >= 0) "}
              <span className="code-sample-callable">run</span>
              {"(() => ok);"}
            </span>
            <span className="code-sample-line" data-diff="del">
              {"- return message;"}
            </span>
            <span className="code-sample-line" data-diff="add">
              {"+ return `${message}!`;"}
            </span>
          </code>
        </pre>
      </section>
      <section className="typography-preview-block">
        <h4 className="typography-preview-label">{t("Terminal")}</h4>
        <pre
          className="terminal-sample"
          aria-label={t("Terminal font preview")}
          style={{
            fontFamily: family ? `${JSON.stringify(family)}, monospace` : "var(--font-mono)",
            fontSize: p.terminalSize,
            fontWeight: p.terminalWeight,
            lineHeight: p.terminalLineHeight,
          }}
        >
          <code>
            {'bycoda $ echo "Hello, bycoda"\nHello, bycoda · 0123456789\nAa Bb Cc → [] {} () => !='}
          </code>
        </pre>
      </section>
    </aside>
  );
}

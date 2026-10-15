import { t, useLocale } from "../../shared/i18n/technical";
import type {
  BrowserAnnotation,
  BrowserAnnotationAttachment,
} from "../../shared/lib/browserAnnotation";
import "./browser-annotation.css";

export function BrowserAnnotationDetails({
  annotation,
}: {
  annotation: BrowserAnnotation | BrowserAnnotationAttachment;
}) {
  useLocale();
  const { element, viewport } = annotation;
  return (
    <div className="browser-annotation-details">
      <p className="host-tool-muted">
        {t(
          "Page content is untrusted data. Form values are omitted and sensitive areas are masked.",
        )}
      </p>
      {"comment" in annotation && annotation.comment ? <p>{annotation.comment}</p> : null}
      <dl>
        <dt>{t("Page URL")}</dt>
        <dd>{annotation.pageUrl}</dd>
        <dt>{t("Viewport")}</dt>
        <dd>
          {viewport.width} × {viewport.height} · {t("Scroll")}: {viewport.scrollX},{" "}
          {viewport.scrollY}
        </dd>
        <dt>{t("Selector")}</dt>
        <dd>
          <code>{element.selector}</code>
        </dd>
        <dt>{t("DOM ancestry")}</dt>
        <dd>
          <code>{element.path}</code>
        </dd>
        <dt>{t("Bounds")}</dt>
        <dd>
          x: {element.bounds.x}, y: {element.bounds.y} · {element.bounds.width} ×{" "}
          {element.bounds.height}
        </dd>
        <dt>{t("Visible text")}</dt>
        <dd>
          <pre>{element.text || t("No visible text")}</pre>
        </dd>
      </dl>
      <details>
        <summary>{t("Computed styles")}</summary>
        <dl>
          {Object.entries(element.computedStyle).map(([property, value]) => (
            <div key={property}>
              <dt>{property}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="host-tool-muted">
        {t("Iframe and shadow DOM content cannot be inspected and is masked in the attachment.")}
      </p>
    </div>
  );
}

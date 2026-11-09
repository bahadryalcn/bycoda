import { t, useLocale } from "../../shared/i18n/technical";
import type {
  BrowserAnnotation,
  BrowserAnnotationAttachment,
} from "../../shared/lib/browserAnnotation";
import { DescriptionItem, DescriptionList } from "../../shared/ui/DescriptionList";
import { Disclosure } from "../../shared/ui/Disclosure";
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
      <DescriptionList size="sm">
        <DescriptionItem term={t("Page URL")}>{annotation.pageUrl}</DescriptionItem>
        <DescriptionItem term={t("Viewport")}>
          {viewport.width} × {viewport.height} · {t("Scroll")}: {viewport.scrollX},{" "}
          {viewport.scrollY}
        </DescriptionItem>
        <DescriptionItem term={t("Selector")}>
          <code>{element.selector}</code>
        </DescriptionItem>
        {element.role ? <DescriptionItem term={t("Role")}>{element.role}</DescriptionItem> : null}
        {element.layout ? (
          <DescriptionItem term={t("Layout")}>
            <code>{element.layout.display}</code>
          </DescriptionItem>
        ) : null}
        {element.interaction ? (
          <>
            <DescriptionItem term={t("Disabled")}>
              {t(element.interaction.disabled ? "Yes" : "No")}
            </DescriptionItem>
            <DescriptionItem term={t("Keyboard focusable")}>
              {t(element.interaction.focusable ? "Yes" : "No")}
            </DescriptionItem>
          </>
        ) : null}
        <DescriptionItem term={t("DOM ancestry")}>
          <code>{element.path}</code>
        </DescriptionItem>
        <DescriptionItem term={t("Bounds")}>
          x: {element.bounds.x}, y: {element.bounds.y} · {element.bounds.width} ×{" "}
          {element.bounds.height}
        </DescriptionItem>
        <DescriptionItem term={t("Visible text")}>
          <pre>{element.text || t("No visible text")}</pre>
        </DescriptionItem>
      </DescriptionList>
      {element.boxModelLimitation ? (
        <p className="host-tool-muted">{t(element.boxModelLimitation)}</p>
      ) : null}
      {element.layout?.limitation ? (
        <p className="host-tool-muted">{t(element.layout.limitation)}</p>
      ) : null}
      <Disclosure summary={t("Computed styles")} size="sm">
        <DescriptionList size="sm">
          {Object.entries(element.computedStyle).map(([property, value]) => (
            <DescriptionItem key={property} term={property}>
              {value}
            </DescriptionItem>
          ))}
        </DescriptionList>
      </Disclosure>
      <p className="host-tool-muted">
        {t("Iframe and shadow DOM content cannot be inspected and is masked in the attachment.")}
      </p>
    </div>
  );
}

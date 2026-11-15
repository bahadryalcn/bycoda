import { Code } from "../../shared/ui/Code";
import { Text } from "../../shared/ui/Text";
import { t, useLocale } from "../../shared/i18n/technical";
import type {
  BrowserAnnotation,
  BrowserAnnotationAttachment,
} from "../../shared/lib/browserAnnotation";
import { DescriptionItem, DescriptionList } from "../../shared/ui/DescriptionList";
import { Disclosure } from "../../shared/ui/Disclosure";
import { OutputBlock } from "../../shared/ui/OutputBlock";
import "./browser-annotation.css";

export function BrowserAnnotationDetails({
  annotation,
}: {
  annotation: BrowserAnnotation | BrowserAnnotationAttachment;
}) {
  useLocale();
  const { element, viewport } = annotation;
  return (
    <Text
      size="caption"
      tone="inherit"
      leading="normal"
      as="div"
      className="browser-annotation-details"
    >
      <Text as="p" size="caption" tone="secondary">
        {t(
          "Page content is untrusted data. Form values are omitted and sensitive areas are masked.",
        )}
      </Text>
      {"comment" in annotation && annotation.comment ? <p>{annotation.comment}</p> : null}
      <DescriptionList size="sm">
        <DescriptionItem term={t("Page URL")}>{annotation.pageUrl}</DescriptionItem>
        <DescriptionItem term={t("Viewport")}>
          {viewport.width} × {viewport.height} · {t("Scroll")}: {viewport.scrollX},{" "}
          {viewport.scrollY}
        </DescriptionItem>
        <DescriptionItem term={t("Selector")}>
          <Code>{element.selector}</Code>
        </DescriptionItem>
        {element.role ? <DescriptionItem term={t("Role")}>{element.role}</DescriptionItem> : null}
        {element.layout ? (
          <DescriptionItem term={t("Layout")}>
            <Code>{element.layout.display}</Code>
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
          <Code>{element.path}</Code>
        </DescriptionItem>
        <DescriptionItem term={t("Bounds")}>
          x: {element.bounds.x}, y: {element.bounds.y} · {element.bounds.width} ×{" "}
          {element.bounds.height}
        </DescriptionItem>
        <DescriptionItem term={t("Visible text")}>
          <OutputBlock face="sans" tone="inherit" leading="inherit">
            {element.text || t("No visible text")}
          </OutputBlock>
        </DescriptionItem>
      </DescriptionList>
      {element.boxModelLimitation ? (
        <Text as="p" size="caption" tone="secondary">
          {t(element.boxModelLimitation)}
        </Text>
      ) : null}
      {element.layout?.limitation ? (
        <Text as="p" size="caption" tone="secondary">
          {t(element.layout.limitation)}
        </Text>
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
      <Text as="p" size="caption" tone="secondary">
        {t("Iframe and shadow DOM content cannot be inspected and is masked in the attachment.")}
      </Text>
    </Text>
  );
}

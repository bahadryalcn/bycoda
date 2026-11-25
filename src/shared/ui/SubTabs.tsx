import { TabStrip, type TabStripProps } from "./Tabs";
import styles from "./SubTabs.module.css";

export type SubTabsProps<T extends string = string> = Omit<
  TabStripProps<T>,
  "variant" | "size" | "fill" | "responsive" | "orientation"
> & {
  /** Wrap the tabs onto further lines instead of scrolling or truncating; for many sections with long labels. */
  wrap?: boolean;
};

/**
 * Secondary navigation: a lighter tab strip (text only, underline on the selected tab) for
 * switching sections inside a screen that already sits under a main tab strip. Same roving
 * keys and ARIA as TabStrip, so panels or a shared region (`controls`) link the same way.
 * @group navigation
 * @use THE secondary navigation: sections of one screen below the main Tabs (Audience: People, Capture rules, Outreach).
 * @avoid Top-level navigation: Tabs or TabStrip. Choosing a value or filtering the same content: SegmentedControl. A second strip beside a main one in the same row: flatten into the main strip.
 *
 * @example
 * <SubTabs
 *   label={t("Audience sections")}
 *   value={section}
 *   onValueChange={setSection}
 *   items={[
 *     { value: "people", label: t("People") },
 *     { value: "rules", label: t("Capture rules") },
 *   ]}
 * />
 */
export function SubTabs<T extends string = string>({ className, wrap, ...props }: SubTabsProps<T>) {
  return (
    <TabStrip
      {...props}
      className={[styles.list, wrap && styles.wrap, className].filter(Boolean).join(" ")}
    />
  );
}

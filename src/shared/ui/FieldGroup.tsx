import { useId } from "react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import styles from "./FieldGroup.module.css";

export type FieldGroupProps = Omit<ComponentPropsWithRef<"fieldset">, "children"> & {
  /**
   * The group name. Same type role as a field label, in sentence case. Omit it only when
   * `aria-label` or `aria-labelledby` already names the group, or for `variant="bare"`.
   */
  legend?: ReactNode;
  /** Keep the legend for assistive tech only; the group then needs its own visible context. */
  hideLegend?: boolean;
  /** One short muted line under the group. */
  description?: ReactNode;
  /**
   * - `plain`: legend above the controls, no frame.
   * - `card`: the controls sit in the shared card frame (`--ui-card-*`), legend above it.
   * - `bare`: no box of its own (`display: contents`): only groups its children so one
   *   `disabled` or `inert` covers them without changing the layout.
   */
  variant?: "plain" | "card" | "bare";
  /** `stack` (default) puts each control on its own row; `row` wraps short choices in a line. */
  layout?: "stack" | "row";
  /** Space between the controls: `md` 12px (default) or `sm` 8px. */
  gap?: "sm" | "md";
  children: ReactNode;
};

/**
 * A named group of related controls: the one `fieldset` + `legend` composition. The legend uses
 * the field label role, so a group title and a field label always match. `disabled` disables
 * every control inside (native fieldset behaviour). `description` is linked for assistive tech.
 * @group fields
 * @replaces fieldset legend
 * @use Several controls that answer one question: accounts to post to, a schedule, a set of checks.
 * @avoid One control: Field / TextField. Exclusive choices: RadioGroup (it owns its legend). A page section with a heading: Heading or SectionLabel plus Surface.
 * @example
 * <FieldGroup legend={t("Accounts")} layout="row">
 *   {accounts.map((account) => (
 *     <Checkbox key={account.id} label={account.name} checked={...} onChange={...} />
 *   ))}
 * </FieldGroup>
 */
export function FieldGroup({
  legend,
  hideLegend = false,
  description,
  variant = "plain",
  layout = "stack",
  gap = "md",
  className,
  children,
  ...props
}: FieldGroupProps) {
  const descriptionId = useId();
  return (
    <fieldset
      {...props}
      aria-describedby={
        [props["aria-describedby"], description ? descriptionId : undefined]
          .filter(Boolean)
          .join(" ") || undefined
      }
      data-variant={variant}
      data-layout={layout}
      data-gap={gap}
      className={["bycoda-arc", styles.group, className].filter(Boolean).join(" ")}
    >
      {legend != null ? (
        <legend className={hideLegend ? "sr-only" : styles.legend}>{legend}</legend>
      ) : null}
      {variant === "bare" ? children : <div className={styles.body}>{children}</div>}
      {description ? (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      ) : null}
    </fieldset>
  );
}

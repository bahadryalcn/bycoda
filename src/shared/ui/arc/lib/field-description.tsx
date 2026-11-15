"use client";

import type { ReactNode } from "react";
import { InfoPopover } from "../../InfoPopover";
import { FieldMessage } from "./field-message";
import styles from "./field-description.module.css";

/**
 * Description of a field or group. By default it sits behind the info (i) affordance beside the label and stays in the
 * DOM as visually hidden text so `aria-describedby` keeps working; `visible` renders the subline (scope, dependency or
 * consequence only).
 */
export function FieldDescription({
  id,
  text,
  visible = false,
  className,
}: {
  id?: string;
  text?: string;
  visible?: boolean;
  className?: string;
}) {
  if (!text || visible) return <FieldMessage id={id} text={text} className={className} />;
  return (
    <span id={id} className="sr-only">
      {text}
    </span>
  );
}

/** Info (i) affordance for a description that is not shown as a subline; null when there is nothing to reveal. */
export function FieldInfo({
  description,
  visible = false,
}: {
  description?: ReactNode;
  visible?: boolean;
}) {
  if (!description || visible) return null;
  return <InfoPopover className={styles.info}>{description}</InfoPopover>;
}

/** The label line: the label plus the info affordance when the description is not visible. Without one it is the label alone. */
export function FieldLabelRow({
  description,
  visible = false,
  children,
}: {
  description?: ReactNode;
  visible?: boolean;
  children: ReactNode;
}) {
  if (!description || visible) return <>{children}</>;
  return (
    <div className={styles.row}>
      {children}
      <FieldInfo description={description} />
    </div>
  );
}

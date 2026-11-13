import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./task-ops.css";

/** A thin frame whose rows are split by hairlines (the settings group look). */
export function SettingFrame({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
>) {
  return (
    <div
      {...props}
      {...surfaceAttributes(
        { frame: "card", radius: "card", dividers: "card" },
        ["task-ops-frame", className].filter(Boolean).join(" "),
      )}
    >
      {children}
    </div>
  );
}

/** One settings row: readable title and description, with controls alongside or below. */
export function SettingRow({
  title,
  description,
  children,
  as: Element = "div",
  ...props
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  as?: "div" | "form";
} & Omit<ComponentPropsWithoutRef<"div">, "title" | "children">) {
  const Tag = Element as "div";
  return (
    <Tag {...props} className={["task-ops-setting", props.className].filter(Boolean).join(" ")}>
      <div className="task-ops-setting-text">
        <Text
          as="span"
          size="body"
          weight="medium"
          tone="primary"
          leading="inherit"
          wrap="anywhere"
        >
          {title}
        </Text>
        {description ? (
          <Text size="caption" tone="secondary" leading="inherit" className="task-ops-caption">
            {description}
          </Text>
        ) : null}
      </div>
      {children ? <div className="task-ops-setting-control">{children}</div> : null}
    </Tag>
  );
}

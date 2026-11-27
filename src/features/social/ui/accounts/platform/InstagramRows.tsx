import type { ReactNode } from "react";
import { Divider } from "../../../../../shared/ui/Divider";
import { Text } from "../../../../../shared/ui/Text";
import "./instagram.css";

/** A readable list of Instagram items: a title, a quiet line of facts, optional row actions. */
export function InstagramRows({ children }: { children: ReactNode }) {
  return <ul className="instagram-rows">{children}</ul>;
}

export function InstagramRow({
  title,
  meta,
  body,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  /** Row actions. */
  children?: ReactNode;
}) {
  return (
    <li className="instagram-row">
      <Text weight="medium" className="instagram-row-text">
        {title}
      </Text>
      {meta ? (
        <Text size="caption" tone="secondary">
          {meta}
        </Text>
      ) : null}
      {body ? <Text className="instagram-row-text">{body}</Text> : null}
      {children ? <div className="instagram-actions">{children}</div> : null}
      <Divider decorative />
    </li>
  );
}

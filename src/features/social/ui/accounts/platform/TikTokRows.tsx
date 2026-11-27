import type { ReactNode } from "react";
import { Divider } from "../../../../../shared/ui/Divider";
import { Text } from "../../../../../shared/ui/Text";
import "./tiktok.css";

/** A readable list of TikTok items: one title, a quiet line of facts, optional row actions. */
export function TikTokRows({ children }: { children: ReactNode }) {
  return <ul className="tiktok-rows">{children}</ul>;
}

export function TikTokRow({
  title,
  meta,
  badge,
  body,
  children,
}: {
  title: ReactNode;
  /** Quiet facts under the title (date, counts). */
  meta?: ReactNode;
  /** A status beside the title. */
  badge?: ReactNode;
  body?: ReactNode;
  /** Row actions. */
  children?: ReactNode;
}) {
  return (
    <li className="tiktok-row">
      <div className="tiktok-row-head">
        <Text as="span" weight="medium" className="tiktok-row-text">
          {title}
        </Text>
        {badge}
      </div>
      {meta ? (
        <Text size="caption" tone="secondary">
          {meta}
        </Text>
      ) : null}
      {body ? <Text className="tiktok-row-text">{body}</Text> : null}
      {children ? <div className="tiktok-actions">{children}</div> : null}
      <Divider decorative />
    </li>
  );
}

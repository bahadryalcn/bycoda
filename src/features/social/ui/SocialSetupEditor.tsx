import type { ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Composer } from "./socialShared";
import "./social-programs.css";

/** First-time setup uses the workspace; existing collections keep their editor modal. */
export function SocialSetupEditor({
  inline,
  title,
  editing,
  description,
  children,
}: {
  inline: boolean;
  title: string;
  editing: number;
  description?: string;
  children: ReactNode;
}) {
  if (!inline)
    return (
      <Composer title={title} editing={editing} description={description}>
        {children}
      </Composer>
    );
  return (
    <section className="social-program-inline" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <p>{description ?? t("Generate, review and schedule posts from one brief.")}</p>
      </header>
      {children}
    </section>
  );
}

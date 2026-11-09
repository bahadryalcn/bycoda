import type { ReactNode } from "react";
/** A topic: a labelled landmark that keeps search targets; its groups carry the visible titles. */
export function AppearanceSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`appearance-topic-${id}`}
      tabIndex={-1}
      className="appearance-section"
      aria-label={title}
    >
      <div className="appearance-section-body settings-topics">{children}</div>
    </section>
  );
}

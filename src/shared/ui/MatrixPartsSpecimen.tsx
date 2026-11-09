import type { ReactNode } from "react";

export function MatrixGroup({
  name,
  testId,
  children,
  className = "flex min-w-0 flex-wrap items-center gap-2",
}: {
  name: string;
  testId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={name}
      data-testid={testId}
      className="grid min-w-0 grid-cols-1 gap-1.5"
    >
      <h3 className="text-[length:var(--ui-font-secondary)] text-[var(--ui-text-secondary)]">
        {name}
      </h3>
      <div className={className}>{children}</div>
    </div>
  );
}

export function MatrixSection({
  name,
  testId,
  children,
}: {
  name: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={name} data-testid={testId} className="grid min-w-0 grid-cols-1 gap-4">
      <h2 className="text-lg font-medium">{name}</h2>
      {children}
    </section>
  );
}

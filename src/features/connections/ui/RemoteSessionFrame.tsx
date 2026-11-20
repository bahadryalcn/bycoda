import type { ReactNode } from "react";

/** A delegated controller contributes only its notices and request controls. */
export function RemoteSessionFrame({
  compact,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        compact ? "relative flex min-w-0 flex-col" : "relative flex h-full min-h-0 flex-col"
      }
    >
      {children}
    </div>
  );
}

export function RemoteSessionContent({
  compact,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return <div className={compact ? "min-w-0" : "min-h-0 flex-1"}>{children}</div>;
}

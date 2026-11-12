import type { ReactNode } from "react";
import { FailureState } from "../../../shared/ui/FailureState";
import { EmptyState } from "../../../shared/ui/EmptyState";

/** Centered notice shared by the document viewers: unsupported, failed, empty. */
export function DocumentMessage({
  title,
  error,
  children,
}: {
  title: string;
  error?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="grid h-full min-w-0 place-items-center overflow-auto p-4">
      {error ? (
        <FailureState
          context="list"
          title={title}
          description={children ?? ""}
          className="w-full min-w-0 max-w-xl"
        />
      ) : (
        <EmptyState title={title} description={children ?? ""} />
      )}
    </div>
  );
}

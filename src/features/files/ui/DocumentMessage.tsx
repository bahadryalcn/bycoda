import type { ReactNode } from "react";
import { Alert } from "../../../shared/ui/Alert";
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
    <div className="grid h-full place-items-center p-6">
      {error ? (
        <Alert tone="danger" title={title}>
          {children}
        </Alert>
      ) : (
        <EmptyState title={title} description={children ?? ""} />
      )}
    </div>
  );
}

import type { ReactNode } from "react";
import { AlertCircle } from "../../../shared/ui/icons";

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
      <div className="flex max-w-md flex-col items-center text-center text-[12px] leading-5 text-content/50">
        {error ? <AlertCircle className="mb-3 size-5 text-red-400" /> : null}
        <p className="text-[13px] text-content">{title}</p>
        {children}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import "./common.css";

/** One muted helper line for ids, raw payloads and other technical detail. */
export function TechnicalDetails({ children }: { children: ReactNode }) {
  return <div className="social-technical-details">{children}</div>;
}

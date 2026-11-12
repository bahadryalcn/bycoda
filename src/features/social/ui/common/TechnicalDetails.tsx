import { Text } from "../../../../shared/ui/Text";
import type { ReactNode } from "react";
import "./common.css";

/** One muted helper line for ids, raw payloads and other technical detail. */
export function TechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <Text
      as="div"
      size="caption"
      tone="muted"
      leading="inherit"
      className="social-technical-details"
    >
      {children}
    </Text>
  );
}

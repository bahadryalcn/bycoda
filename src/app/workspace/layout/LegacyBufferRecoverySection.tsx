import type { ReactNode } from "react";
import { legacyBufferReportKey } from "../../../features/files/data/legacyBufferRecovery";
import { useLegacyBufferRecovery } from "../files/useLegacyBufferRecovery";
import { BufferReportRecoveryView } from "./BufferReportRecoveryView";

export type LegacyBufferRecoverySectionProps = {
  canInspect(): boolean;
  getPrivacySnapshot(): unknown;
  onShowCopies?(paths: readonly string[]): void;
  sourceControl?: ReactNode;
};
export function LegacyBufferRecoverySection({
  canInspect,
  getPrivacySnapshot,
  onShowCopies,
  sourceControl,
}: LegacyBufferRecoverySectionProps) {
  const recovery = useLegacyBufferRecovery({ enabled: true, canInspect, getPrivacySnapshot });
  return (
    <BufferReportRecoveryView
      recovery={recovery}
      reportKey={legacyBufferReportKey}
      onShowCopies={onShowCopies}
      sourceControl={sourceControl}
    />
  );
}

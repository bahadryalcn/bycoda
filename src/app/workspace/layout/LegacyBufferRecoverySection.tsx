import { legacyBufferReportKey } from "../../../features/files/data/legacyBufferRecovery";
import { useLegacyBufferRecovery } from "../files/useLegacyBufferRecovery";
import { BufferReportRecoveryView } from "./BufferReportRecoveryView";

export type LegacyBufferRecoverySectionProps = {
  canInspect(): boolean;
  getPrivacySnapshot(): unknown;
  onShowCopies?(paths: readonly string[]): void;
};
export function LegacyBufferRecoverySection({
  canInspect,
  getPrivacySnapshot,
  onShowCopies,
}: LegacyBufferRecoverySectionProps) {
  const recovery = useLegacyBufferRecovery({ enabled: true, canInspect, getPrivacySnapshot });
  return (
    <BufferReportRecoveryView
      recovery={recovery}
      reportKey={legacyBufferReportKey}
      onShowCopies={onShowCopies}
    />
  );
}

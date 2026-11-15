import { useT } from "../../../shared/i18n";
import { hostBufferReportKey } from "../../../features/files/data/hostBufferRecovery";
import { useHostBufferRecovery } from "../files/useHostBufferRecovery";
import { BufferReportRecoveryView } from "./BufferReportRecoveryView";
import type { LegacyBufferRecoverySectionProps } from "./LegacyBufferRecoverySection";

export function HostBufferRecoverySection({
  canInspect,
  getPrivacySnapshot,
  onShowCopies,
  sourceControl,
}: LegacyBufferRecoverySectionProps) {
  const t = useT();
  const recovery = useHostBufferRecovery({ enabled: true, canInspect, getPrivacySnapshot });
  const viewRecovery = {
    ...recovery,
    partial:
      recovery.unavailable || recovery.incomplete || recovery.duplicatesPossible
        ? t("This Host result may be incomplete. Inspect available reports or refresh to retry.")
        : null,
  };
  return (
    <>
      <BufferReportRecoveryView
        recovery={viewRecovery}
        reportKey={hostBufferReportKey}
        scopeKey="host"
        onShowCopies={onShowCopies}
        sourceControl={sourceControl}
      />
    </>
  );
}

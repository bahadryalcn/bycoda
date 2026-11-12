import { Text } from "../../../shared/ui/Text";
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
      {recovery.visible && recovery.available ? (
        <div className="px-3 pt-3">
          <Text as="p" size="caption" tone="secondary">
            {t("Reports retained by this desktop profile's Host.")}
          </Text>
        </div>
      ) : null}
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

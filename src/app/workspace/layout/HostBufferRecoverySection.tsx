import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
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
  return (
    <>
      {recovery.visible && recovery.available ? (
        <div className="px-3 pt-3">
          <p className="text-ui-caption text-(--ui-text-secondary)">
            {t("Reports retained by this desktop profile's Host.")}
          </p>
          {recovery.unavailable || recovery.incomplete ? (
            <Alert tone="warning" role="status">
              {t(
                "Some Host reports are unavailable. You can inspect the available reports or refresh to retry.",
              )}
            </Alert>
          ) : null}
        </div>
      ) : null}
      <BufferReportRecoveryView
        recovery={recovery}
        reportKey={hostBufferReportKey}
        onShowCopies={onShowCopies}
        sourceControl={sourceControl}
      />
    </>
  );
}

import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { HostBufferRecoverySection } from "./HostBufferRecoverySection";
import {
  LegacyBufferRecoverySection,
  type LegacyBufferRecoverySectionProps,
} from "./LegacyBufferRecoverySection";

export function BufferRecoveryReports(props: LegacyBufferRecoverySectionProps) {
  const t = useT();
  const [source, setSource] = useState("desktop");
  // The source lives in the report toolbar so the three recovery kinds share one layout.
  const sourceControl = (
    <SegmentedControl
      label={t("Report source")}
      value={source}
      onValueChange={setSource}
      options={[
        { value: "desktop", label: t("This computer") },
        { value: "host", label: t("Host reports") },
      ]}
    />
  );
  return (
    <div className="flex min-h-0 flex-col">
      {source === "host" ? (
        <HostBufferRecoverySection {...props} sourceControl={sourceControl} />
      ) : (
        <LegacyBufferRecoverySection {...props} sourceControl={sourceControl} />
      )}
    </div>
  );
}

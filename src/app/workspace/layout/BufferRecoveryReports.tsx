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
  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <SegmentedControl
          label={t("Report source")}
          value={source}
          onValueChange={setSource}
          options={[
            { value: "desktop", label: t("This computer") },
            { value: "host", label: t("Host reports") },
          ]}
        />
      </div>
      {source === "host" ? (
        <HostBufferRecoverySection {...props} />
      ) : (
        <LegacyBufferRecoverySection {...props} />
      )}
    </div>
  );
}

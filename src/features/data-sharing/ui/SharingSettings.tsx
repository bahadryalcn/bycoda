import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Select } from "../../../shared/ui/Select";
import { Row } from "../../../shared/ui/settings";
import {
  activitySharing,
  dataTransfers,
  sharingNotices,
  type SharingMode,
} from "../model/transfers";

export function SharingModeSelect({
  label,
  value,
  change,
  askLabel,
}: {
  label: string;
  value: SharingMode;
  change: (mode: SharingMode) => void;
  askLabel?: string;
}) {
  useLocale();
  return (
    <Select
      label={label}
      hideLabel
      value={value}
      onValueChange={(mode) => {
        if (mode === "off" || mode === "ask" || mode === "auto") change(mode);
      }}
      options={[
        { value: "off", label: t("Do not send") },
        { value: "ask", label: askLabel ?? t("Ask every time") },
        { value: "auto", label: t("Send every time") },
      ]}
    />
  );
}

export function ActivitySharingSetting() {
  useLocale();
  const mode = useSyncExternalStore(activitySharing.subscribe, activitySharing.load);
  const label = t("Share active time");
  return (
    <Row
      id="activity-sharing"
      label={label}
      description={t("Sync daily active minutes to your Bycoda account.")}
    >
      <SharingModeSelect
        label={label}
        value={mode}
        change={activitySharing.save}
        askLabel={t("Ask daily")}
      />
    </Row>
  );
}

export function SharingNoticeSetting() {
  useLocale();
  const show = useSyncExternalStore(sharingNotices.subscribe, sharingNotices.load);
  const label = t("Data sharing receipts");
  return (
    <Row
      id="data-sharing-receipts"
      label={label}
      description={t("Show what was sent and where.")}
      modified={!show}
      onReset={() => sharingNotices.save(true)}
    >
      <Select
        label={label}
        hideLabel
        value={show ? "show" : "hide"}
        options={[
          { value: "show", label: t("Show") },
          { value: "hide", label: t("Hide") },
        ]}
        onValueChange={(value) => {
          if (sharingNotices.save(value === "show") && value !== "show")
            dataTransfers.clearReceipts();
        }}
      />
    </Row>
  );
}

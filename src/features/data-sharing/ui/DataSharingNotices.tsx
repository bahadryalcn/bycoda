import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Code } from "../../../shared/ui/Code";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { FileScript } from "../../../shared/ui/icons";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Toast } from "../../../shared/ui/ToastRegion";
import {
  activitySharing,
  dataTransfers,
  sharingNotices,
  type SharingKind,
} from "../model/transfers";

function sharingTitle(kind: SharingKind) {
  switch (kind) {
    case "diagnostics":
      return t("Diagnostic report");
    case "activity":
      return t("Active time");
    case "statistics":
      return t("Anonymous usage statistics");
    case "tokens":
      return t("Anonymous token totals");
  }
}

function sharingPurpose(kind: SharingKind) {
  switch (kind) {
    case "diagnostics":
      return t(
        "We use error logs only to understand problems and improve Bycoda. You can inspect the report before sending it.",
      );
    case "activity":
      return t("Sync daily active minutes to your Bycoda account.");
    case "statistics":
      return t("These statistics help Bycoda understand how many installations use each version.");
    case "tokens":
      return t("These totals help Bycoda understand aggregate token usage and estimated costs.");
  }
}

export function DataSharingNotices() {
  useLocale();
  const format = useFormat();
  const pending = useSyncExternalStore(dataTransfers.subscribe, dataTransfers.pending);
  const receipts = useSyncExternalStore(dataTransfers.subscribe, dataTransfers.receipts);
  const showReceipts = useSyncExternalStore(sharingNotices.subscribe, sharingNotices.load);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Automatic review timers run only while the notice surface is mounted.
  useEffect(() => dataTransfers.present(), []);
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [failedSaveId, setFailedSaveId] = useState<number | null>(null);
  const openPending = pending && openedId === pending.id ? pending : null;
  const canAlwaysSend = openPending?.kind === "activity";
  const openReceipt = showReceipts ? receipts.find((item) => item.id === openedId) : undefined;
  const details = openPending ?? openReceipt;
  const close = () => {
    openPending?.inspect(false);
    setOpenedId(null);
    setFailedSaveId(null);
  };
  const open = (id: number) => {
    if (openPending && openPending.id !== id) openPending.inspect(false);
    if (pending?.id === id) pending.inspect(true);
    setOpenedId(id);
  };
  const latestReceipt = showReceipts ? receipts[receipts.length - 1] : undefined;
  return (
    <>
      {pending && (
        <Toast
          key={`pending-${pending.id}`}
          placement="bottom-start"
          tone="info"
          title={pending.automatic ? t("Automatic sharing is ready") : t("Approve data sharing")}
          message={sharingTitle(pending.kind)}
          durationMs={null}
          action={{
            label: t("Details"),
            onClick: () => open(pending.id),
          }}
          onDismiss={() => pending.decide(false)}
        />
      )}
      {latestReceipt && (
        <Toast
          key={`receipt-${latestReceipt.id}`}
          placement="bottom-start"
          tone="success"
          title={t("Data sent")}
          message={sharingTitle(latestReceipt.kind)}
          durationMs={null}
          action={{ label: t("Details"), onClick: () => open(latestReceipt.id) }}
          onDismiss={() => dataTransfers.dismiss(latestReceipt.id)}
        />
      )}
      {details && (
        <Modal
          key={`details-${details.id}`}
          title={sharingTitle(details.kind)}
          description={sharingPurpose(details.kind)}
          onClose={close}
          initialFocus="summary"
          size="md"
          fitViewport
          footer={
            openPending && (
              <ModalActions>
                <Button
                  variant="ghost"
                  onClick={() => {
                    openPending.decide(false);
                    close();
                  }}
                >
                  {t("Do not send")}
                </Button>
                <Button
                  variant={canAlwaysSend ? "secondary" : "primary"}
                  onClick={() => {
                    openPending.decide(true);
                    close();
                  }}
                >
                  {t("Send once")}
                </Button>
                {canAlwaysSend && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (!activitySharing.save("auto")) {
                        setFailedSaveId(openPending.id);
                        return;
                      }
                      openPending.decide(true);
                      close();
                    }}
                  >
                    {t("Always send")}
                  </Button>
                )}
              </ModalActions>
            )
          }
        >
          <div className="grid gap-4">
            {openPending && failedSaveId === openPending.id && (
              <InlineError>{t("Could not save changes")}</InlineError>
            )}
            {openPending?.automatic && (
              <Text as="p" size="caption" tone="secondary">
                {t("Automatic sending pauses while you review this report.")}
              </Text>
            )}
            <DescriptionList>
              <DescriptionItem term={t("Destination")}>
                <Code size="caption">{details.destination}</Code>
                {details.linkedToAccount && (
                  <Text as="p" size="caption" tone="secondary">
                    {t("Linked to your Bycoda account")}
                  </Text>
                )}
              </DescriptionItem>
              {openReceipt && (
                <DescriptionItem term={t("Sent")}>
                  {format.formatDate(openReceipt.sentAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </DescriptionItem>
              )}
            </DescriptionList>
            <div className="grid gap-2">
              {details.files.map((file) => (
                <Disclosure
                  key={file.name}
                  summary={
                    <span className="flex min-w-0 items-center gap-2">
                      <FileScript className="icon-sm shrink-0" aria-hidden />
                      <Code size="caption" className="min-w-0 wrap-anywhere">
                        {file.name}
                      </Code>
                    </span>
                  }
                  variant="card"
                  chevron="end"
                >
                  <OutputBlock frame="filled" scroll className="max-h-64" tabIndex={0}>
                    {file.text}
                  </OutputBlock>
                </Disclosure>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

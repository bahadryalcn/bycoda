import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Code } from "../../../shared/ui/Code";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
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
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const openPending = pending && openedId === pending.id ? pending : null;
  const isActivityReview = openPending?.kind === "activity";
  const openReceipt = showReceipts ? receipts.find((item) => item.id === openedId) : undefined;
  const details = openPending ?? openReceipt;
  const close = () => {
    openPending?.inspect(false);
    setMenuAnchor(null);
    setOpenedId(null);
    setFailedSaveId(null);
  };
  const open = (id: number) => {
    if (openPending && openPending.id !== id) openPending.inspect(false);
    if (pending?.id === id) pending.inspect(true);
    setMenuAnchor(null);
    setOpenedId(id);
  };
  const saveActivityMode = (mode: "auto" | "off") => {
    if (!openPending) return;
    if (!activitySharing.save(mode)) {
      setFailedSaveId(openPending.id);
      return;
    }
    openPending.decide(mode === "auto");
    close();
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
          onDismiss={() => pending.decide(false, "user")}
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
              <ModalActions
                start={
                  isActivityReview && (
                    <>
                      <Button
                        variant="ghost"
                        aria-haspopup="menu"
                        aria-expanded={menuAnchor !== null}
                        onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
                      >
                        {t("More options")}
                      </Button>
                      {menuAnchor && (
                        <DropdownMenu
                          anchor={menuAnchor}
                          label={t("More options")}
                          side="top"
                          align="start"
                          items={[
                            { kind: "item", id: "later", label: t("Ask later") },
                            { kind: "item", id: "never", label: t("Never send") },
                          ]}
                          onClose={() => setMenuAnchor(null)}
                          onPick={(id) => {
                            if (id === "never") saveActivityMode("off");
                            if (id === "later") {
                              openPending.decide(false, "user");
                              close();
                            }
                          }}
                        />
                      )}
                    </>
                  )
                }
              >
                {!isActivityReview && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      openPending.decide(false, "user");
                      close();
                    }}
                  >
                    {t("Do not send")}
                  </Button>
                )}
                <Button
                  variant={isActivityReview ? "secondary" : "primary"}
                  onClick={() => {
                    openPending.decide(true, "user");
                    close();
                  }}
                >
                  {t("Send once")}
                </Button>
                {openPending.allowToday && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (!openPending.allowToday?.()) {
                        setFailedSaveId(openPending.id);
                        return;
                      }
                      openPending.decide(true);
                      close();
                    }}
                  >
                    {t("Send for today")}
                  </Button>
                )}
                {isActivityReview && (
                  <Button variant="primary" onClick={() => saveActivityMode("auto")}>
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

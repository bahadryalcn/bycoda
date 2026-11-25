import { redactDiagnosticText } from "@bycoda/account-contracts";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getLocale, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError } from "../../../../shared/ui/InlineError";
import { JsonViewer } from "../../../../shared/ui/JsonViewer";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Text } from "../../../../shared/ui/Text";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { programGeneratesImage, type ProgramDetail } from "../../model/socialProgram";
import { formatScheduledDate, programConfigFromProgram } from "../../model/socialProgramForm";
import { socialQueryScope } from "../../model/socialQuery";

type Props = {
  id: string;
  client: SocialClient;
  accounts: SocialAccount[];
  available: boolean;
  onChange: () => void;
  onClose: () => void;
};

export function ContentProgramReview({
  id,
  client,
  accounts,
  available,
  onChange,
  onClose,
}: Props) {
  const cache = useQueryClient();
  const confirmation = useConfirm();
  const key = [...socialQueryScope(client), "program-review", id];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => client.request<ProgramDetail>("programs.status", { id }),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.occurrences.some(
        (occurrence) =>
          occurrence.programRevision === data.program.revision &&
          occurrence.targets.some(
            (target) => target.status === "generating" || target.status === "pending",
          ),
      )
        ? 2_000
        : false;
    },
  });
  const program = detail.data?.program;
  const preview = useQuery({
    queryKey: [...key, "schedule", program?.revision, program?.nextAt],
    enabled: !!program && !program.cancelled,
    queryFn: () =>
      client.request<{ dates: number[] }>("programs.preview-schedule", {
        id,
        config: {
          ...programConfigFromProgram(program!),
          schedule: {
            ...program!.schedule,
            startsAt: program!.nextAt ?? program!.schedule.startsAt,
          },
        },
      }),
  });
  const sample =
    detail.data?.firstSample ??
    detail.data?.occurrences.find((occurrence) => occurrence.programRevision === program?.revision);
  const nameOf = (accountId: string) =>
    accounts.find((account) => account.id === accountId)?.name ?? t("Removed account");
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState<{ title: string; detail?: string }>();
  const writing = useRef(false);
  const disabledReason = !available
    ? t("Could not reach this computer.")
    : busy
      ? t("Working…")
      : undefined;

  const change = (
    operation: string,
    input: Record<string, unknown>,
    errorTitle: string,
    confirm?: { title: string; message: string; confirmLabel: string },
  ) => {
    if (writing.current || !available) return;
    writing.current = true;
    setBusy(operation);
    setFailure(undefined);
    void (async () => {
      if (confirm && !(await confirmation.confirm(confirm))) return;
      if (operation === "activate" || operation === "pause") {
        await client.request(`programs.${operation}`, { id, ...input });
        onChange();
        onClose();
        return;
      }
      const next = await client.request<ProgramDetail>(`programs.${operation}`, { id, ...input });
      cache.setQueryData(key, next);
      onChange();
    })()
      .catch((cause: unknown) => {
        setFailure({
          title: errorTitle,
          detail: cause instanceof Error ? redactDiagnosticText(cause.message) : undefined,
        });
      })
      .finally(() => {
        writing.current = false;
        setBusy("");
      });
  };
  const ready =
    program?.approval.mode !== "semi" ||
    (!!sample?.targets.length &&
      sample.targets.every(
        (target) => target.variant && (target.status === "ready" || !!target.jobId),
      ));
  const activationReason =
    disabledReason ??
    (detail.isError || preview.isError
      ? t("Reload the program before activating it.")
      : !preview.data?.dates.length
        ? t("A schedule preview is required.")
        : !ready
          ? t("Approve the first sample for every account.")
          : undefined);
  const date = (at: number) => formatScheduledDate(getLocale(), program!.schedule.timeZone, at);
  const footer = (
    <ModalActions>
      <Button
        variant="ghost"
        onClick={onClose}
        disabled={!!busy}
        disabledReason={busy ? t("Working…") : undefined}
      >
        {t("Close")}
      </Button>
      {program && !program.cancelled ? (
        program.enabled ? (
          <Button
            variant="secondary"
            disabled={!!disabledReason}
            disabledReason={disabledReason}
            onClick={() => change("pause", {}, t("Could not pause the program."))}
          >
            {t("Pause")}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!!activationReason}
            disabledReason={activationReason}
            onClick={() =>
              change(
                "activate",
                { expectedRevision: program.revision, confirm: true },
                t("Could not activate the program."),
                {
                  title: t("Activate repeating program?"),
                  message: program.name,
                  confirmLabel: t("Activate program"),
                },
              )
            }
          >
            {t("Activate program")}
          </Button>
        )
      ) : null}
    </ModalActions>
  );

  return (
    <Modal
      title={program?.name ?? t("Repeating programs")}
      onClose={() => {
        if (!writing.current) onClose();
      }}
      footer={footer}
    >
      {detail.isPending ? <LoadingText>{t("Loading…")}</LoadingText> : null}
      {detail.error ? (
        <InlineError
          details={redactDiagnosticText(detail.error.message)}
          retry={{ onRetry: () => void detail.refetch().catch(() => undefined) }}
        >
          {t("Could not load the program.")}
        </InlineError>
      ) : null}
      {program ? (
        <>
          <DescriptionList size="sm">
            <DescriptionItem term={t("Status")}>
              {program.cancelled ? t("Cancelled") : program.enabled ? t("Active") : t("Paused")}
            </DescriptionItem>
            <DescriptionItem term={t("Target accounts")}>
              {program.accountIds.map(nameOf).join(", ")}
            </DescriptionItem>
            <DescriptionItem term={t("Total posts")}>
              {program.totalPosts ?? t("Unlimited")}
            </DescriptionItem>
          </DescriptionList>
          {preview.isLoading ? <LoadingText>{t("Loading…")}</LoadingText> : null}
          {preview.error ? (
            <InlineError
              details={redactDiagnosticText(preview.error.message)}
              retry={{ onRetry: () => void preview.refetch().catch(() => undefined) }}
            >
              {t("Could not load the schedule preview.")}
            </InlineError>
          ) : null}
          {preview.data?.dates.length ? (
            <Disclosure summary={t("Schedule preview")} defaultOpen>
              <Text as="ul" size="secondary">
                {preview.data.dates.map((at) => (
                  <li key={at}>{date(at)}</li>
                ))}
              </Text>
            </Disclosure>
          ) : null}
          {!program.enabled && !program.cancelled && program.approval.mode === "semi" ? (
            <>
              <SectionLabel as="h3">{t("First sample")}</SectionLabel>
              {sample ? (
                <Text as="p" size="secondary">
                  {date(sample.scheduledAt)}
                </Text>
              ) : null}
              {!sample || sample.targets.some((target) => target.status === "pending") ? (
                <Button
                  variant="secondary"
                  disabled={!!disabledReason}
                  disabledReason={disabledReason}
                  onClick={() => change("generate", {}, t("Could not prepare the sample."))}
                >
                  {t("Generate sample")}
                </Button>
              ) : null}
              {sample?.targets.map((target) => (
                <Disclosure key={target.accountId} summary={nameOf(target.accountId)}>
                  {target.variant ? (
                    <>
                      <Text as="p" className="content-preview-text">
                        {target.variant.text}
                      </Text>
                      <Disclosure summary={t("Details")}>
                        <JsonViewer data={target.variant} />
                      </Disclosure>
                    </>
                  ) : null}
                  {target.status === "generating" ? (
                    <LoadingText>{t("Working…")}</LoadingText>
                  ) : null}
                  {target.error ? (
                    <InlineError details={redactDiagnosticText(target.error)}>
                      {t("Could not prepare the sample.")}
                    </InlineError>
                  ) : null}
                  {(target.status === "failed" ||
                    (target.status === "review" && !target.variant)) &&
                  !target.jobId ? (
                    <Button
                      variant="secondary"
                      disabled={!!disabledReason}
                      disabledReason={disabledReason}
                      onClick={() =>
                        change(
                          "regenerate",
                          { occurrenceId: sample.id, accountId: target.accountId },
                          t("Could not prepare the sample."),
                        )
                      }
                    >
                      {t("Try again")}
                    </Button>
                  ) : null}
                  {target.variant && target.status === "review" && !target.jobId ? (
                    <Button
                      variant="secondary"
                      disabled={!!disabledReason}
                      disabledReason={disabledReason}
                      onClick={() =>
                        change(
                          "approve",
                          {
                            occurrenceId: sample.id,
                            accountId: target.accountId,
                            expectedRevision: sample.revision,
                            steps:
                              programGeneratesImage(program, target.accountId) &&
                              target.variant?.media.length === 0
                                ? program.approval.steps.filter(
                                    (step) => step === "text" || step === "schedule",
                                  )
                                : program.approval.steps,
                            confirm: true,
                          },
                          t("Could not approve the sample."),
                        )
                      }
                    >
                      {t("Approve sample")}
                    </Button>
                  ) : null}
                  {target.status === "ready" ? <Text size="secondary">{t("Approved")}</Text> : null}
                </Disclosure>
              ))}
            </>
          ) : null}
        </>
      ) : null}
      {failure ? <InlineError details={failure.detail}>{failure.title}</InlineError> : null}
      {confirmation.dialog}
    </Modal>
  );
}

import { useMemo, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { formatUsageCost } from "../../providers/public/providerUsage";
import type { useTodayData } from "../hooks/useTodayData";
import { dailyNoteApi, summaryProvider } from "../model/todayProvider";
import {
  buildSummaryPrompt,
  estimateSummaryCost,
  generateSummary,
  saveDailyNote,
} from "../model/todaySummary";

type SummaryState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; text: string; saved: boolean }
  | { status: "failed" };

/** Opt-in summary: preview the exact request, see the estimate, then Send and Save. */
export function SummaryPanel({
  data,
  pricing,
  activeMinutes,
  language,
}: {
  data: NonNullable<ReturnType<typeof useTodayData>["data"]>;
  pricing: ReturnType<typeof useTodayData>["pricing"];
  activeMinutes: number | null;
  language: string;
}) {
  const [open, setOpen] = useState(false);
  const [includeTitles, setIncludeTitles] = useState(false);
  const [state, setState] = useState<SummaryState>({ status: "idle" });
  const [saveFailed, setSaveFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const cwd = data.projects.find((project) => project.path)?.path ?? "";
  const provider = useMemo(() => summaryProvider(cwd), [cwd]);
  const prompt = useMemo(
    () => buildSummaryPrompt(data, { includeTitles, activeMinutes, language }),
    [data, includeTitles, activeMinutes, language],
  );
  const estimate = useMemo(
    () => estimateSummaryCost(prompt, provider && pricing ? pricing(provider.model) : null),
    [prompt, provider, pricing],
  );
  const send = async () => {
    if (!provider) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState({ status: "running" });
    try {
      const text = await generateSummary(prompt, provider.run, next.signal);
      if (!next.signal.aborted) setState({ status: "done", text, saved: false });
    } catch {
      if (!next.signal.aborted) setState({ status: "failed" });
    }
  };
  const save = async (text: string) => {
    setSaveFailed(false);
    try {
      await saveDailyNote(dailyNoteApi, text, new Date());
      setState({ status: "done", text, saved: true });
    } catch {
      setSaveFailed(true);
    }
  };
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={!provider}>
        {t("Summarize")}
      </Button>
    );
  return (
    <div className="grid gap-2">
      <SectionLabel>{t("Summary")}</SectionLabel>
      <p>
        {t(
          "Only the text below is sent to your own provider when you press Send. Nothing else leaves this computer.",
        )}
      </p>
      <Checkbox
        label={t("Include session titles")}
        checked={includeTitles}
        onChange={(event) => setIncludeTitles(event.target.checked)}
      />
      <TextareaField
        label={t("Request preview")}
        hideLabel
        readOnly
        value={prompt}
        minRows={6}
        maxRows={14}
        monospace
        fieldSize="sm"
      />
      <p>
        {estimate.cost == null
          ? t("Estimated cost: unknown for this model (about {p0} tokens in)", {
              p0: estimate.inputTokens,
            })
          : t("Estimated cost: about {p0} (about {p1} tokens in, {p2} out)", {
              p0: formatUsageCost(estimate.cost),
              p1: estimate.inputTokens,
              p2: estimate.outputTokens,
            })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => send().catch(() => undefined)}
          loading={state.status === "running"}
          disabled={!provider}
        >
          {t("Send")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            controller.current?.abort();
            setState({ status: "idle" });
            setOpen(false);
          }}
        >
          {t("Cancel")}
        </Button>
      </div>
      {state.status === "failed" && (
        <Alert tone="danger">{t("The summary could not be written. Nothing was saved.")}</Alert>
      )}
      {state.status === "done" && (
        <>
          <TextareaField
            label={t("Summary")}
            hideLabel
            readOnly
            value={state.text}
            minRows={3}
            maxRows={12}
            fieldSize="sm"
          />
          <Button
            size="sm"
            onClick={() => save(state.text).catch(() => undefined)}
            disabled={state.saved}
          >
            {state.saved ? t("Saved to today's note") : t("Save to daily note")}
          </Button>
          {saveFailed && <Alert tone="danger">{t("The note could not be saved.")}</Alert>}
        </>
      )}
    </div>
  );
}

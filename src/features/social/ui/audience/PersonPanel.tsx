import { LoadingText } from "../../../../shared/ui/LoadingText";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Meter } from "../../../../shared/ui/Meter";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Sheet } from "../../../../shared/ui/Sheet";
import { Timeline } from "../../../../shared/ui/Timeline";
import type { PersonStage, SocialPerson } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import type { PersonDetail } from "../../model/socialActions";
import { PlatformMark } from "../common/PlatformIcon";
import { SocialAvatar } from "../common/SocialAvatar";
import { EmptyHint } from "../common/EmptyHint";
import { LabeledSelect } from "./LabeledSelect";
import {
  ALL_STAGES,
  IYS_STATES,
  PIPELINE_STAGES,
  errorMessage,
  interactionLabel,
  iysLabel,
  sourceLabel,
  stageLabel,
  stageTone,
  type IysState,
} from "./audienceModel";
import {
  MergeSection,
  PersonDataSection,
  PersonDetailsFields,
  type PatchSaver,
} from "./PersonPanelSections";
import "./audience.css";

export type PersonPanelProps = {
  client: SocialClient;
  personId: string;
  onClose: () => void;
  /** Called with the saved person so the table row updates without a reload. */
  onChanged: (person: SocialPerson) => void;
  onDeleted: (personId: string) => void;
  onMerged: (person: SocialPerson, removedIds: string[]) => void;
};

function toStage(value: string): PersonStage | undefined {
  return ALL_STAGES.find((stage) => stage === value);
}

function toIys(value: string): IysState | undefined {
  return IYS_STATES.find((state) => state === value);
}

/** Person detail in a side sheet: stage line, accounts, consent, activity and data actions. */
export function PersonPanel({
  client,
  personId,
  onClose,
  onChanged,
  onDeleted,
  onMerged,
}: PersonPanelProps) {
  const [detail, setDetail] = useState<PersonDetail>();
  const [loadedId, setLoadedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [now] = useState(() => Date.now());

  const loading = loadedId !== personId;
  const [errorId, setErrorId] = useState(personId);
  if (errorId !== personId) {
    setErrorId(personId);
    setError(undefined);
  }

  useEffect(() => {
    let active = true;
    client.people
      .get(personId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoadedId(personId);
      });
    return () => {
      active = false;
    };
  }, [client, personId]);

  const save: PatchSaver = async (patch) => {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await client.people.update({ personId, patch });
      setDetail((current) => (current ? { ...current, person: updated } : current));
      onChanged(updated);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const person = detail?.person;
  return (
    <Sheet
      open
      onClose={onClose}
      title={person?.name ?? t("Person")}
      description={person ? sourceLabel(person.source) : undefined}
      size="380px"
    >
      {loading && !detail ? (
        <LoadingText delay={false} className="audience-muted">
          {t("Loading person…")}
        </LoadingText>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {person && detail ? (
        <div className="audience-panel-body">
          <header className="audience-person">
            <SocialAvatar name={person.name} size="lg" />
            <div className="audience-person-text">
              <Text
                size="body"
                tone="primary"
                leading="inherit"
                weight="medium"
                className="audience-person-name"
                truncate
              >
                {person.name}
              </Text>
              <Text size="inherit" tone="inherit" truncate className="audience-row">
                <Badge size="sm" tone={stageTone(person.stage)}>
                  {stageLabel(person.stage)}
                </Badge>
                {person.score ? (
                  <span className="audience-score">
                    <Meter
                      className="audience-score-bar"
                      label={t("Interest score")}
                      value={person.score.value}
                      tone="accent"
                    />
                    {formatNumber(person.score.value)}
                  </span>
                ) : null}
              </Text>
            </div>
          </header>

          {detail.suppressed ? (
            <InlineMessage tone="warning">
              {t("This person is on the do-not-contact list. Nothing is sent to them.")}
            </InlineMessage>
          ) : null}

          <section className="audience-panel-section" aria-labelledby="person-stage-heading">
            <SectionLabel labelId="person-stage-heading">{t("Status")}</SectionLabel>
            <Text as="ol" leading="inherit" className="audience-pipeline">
              {PIPELINE_STAGES.map((stage) => (
                <Text
                  as="li"
                  size="inherit"
                  tone={stage === person.stage ? "accent" : "secondary"}
                  leading="inherit"
                  key={stage}
                  data-current={stage === person.stage ? "true" : undefined}
                  {...surfaceAttributes({
                    radius: "control",
                    frame: stage === person.stage ? "accent" : "pane",
                    tone: stage === person.stage ? "accent" : undefined,
                  })}
                >
                  {stageLabel(stage)}
                </Text>
              ))}
            </Text>
            <LabeledSelect
              label={t("Change stage")}
              value={person.stage}
              disabled={busy}
              options={ALL_STAGES.map((stage) => ({ value: stage, label: stageLabel(stage) }))}
              onChange={(value) => {
                const stage = toStage(value);
                if (stage && stage !== person.stage) void save({ stage }).catch(() => undefined);
              }}
            />
          </section>

          <section
            {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "audience-panel-section")}
            aria-labelledby="person-accounts-heading"
          >
            <SectionLabel labelId="person-accounts-heading">{t("Accounts")}</SectionLabel>
            {person.handles.length ? (
              <ul className="audience-list">
                {person.handles.map((handle) => (
                  <li key={`${handle.accountId}:${handle.platformId}`} className="audience-row">
                    <PlatformMark platform={handle.platform} size="sm" tooltip />
                    <Text size="caption" tone="muted" leading="inherit" className="audience-muted">
                      {handle.username
                        ? `@${handle.username.replace(/^@/, "")}`
                        : handle.platformId}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint message={t("No linked accounts yet.")} />
            )}
            {person.emails.length ? (
              <ul className="audience-list">
                {person.emails.map((email) => (
                  <li key={email.address} className="audience-row">
                    <span>{email.address}</span>
                    <Text size="caption" tone="muted" leading="inherit" className="audience-muted">
                      {email.verified ? t("Verified") : t("Not verified")}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section
            {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "audience-panel-section")}
            aria-labelledby="person-details-heading"
          >
            <SectionLabel labelId="person-details-heading">{t("Details")}</SectionLabel>
            <PersonDetailsFields person={person} disabled={busy} save={save} />
          </section>

          <section
            {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "audience-panel-section")}
            aria-labelledby="person-consent-heading"
          >
            <SectionLabel labelId="person-consent-heading">
              {t("Commercial messages (Turkey)")}
            </SectionLabel>
            <Text as="p" size="caption" tone="muted" leading="inherit" className="audience-muted">
              {t(
                "Approval in the Turkish commercial message system (IYS) for messages to people in Turkey.",
              )}
            </Text>
            <LabeledSelect
              label={t("IYS status")}
              value={person.commercialConsent?.iys ?? "unknown"}
              disabled={busy}
              options={IYS_STATES.map((state) => ({ value: state, label: iysLabel(state) }))}
              onChange={(value) => {
                const iys = toIys(value);
                if (iys)
                  void save({ commercialConsent: { iys, checkedAt: Date.now() } }).catch(
                    () => undefined,
                  );
              }}
            />
          </section>

          <section
            {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "audience-panel-section")}
            aria-labelledby="person-activity-heading"
          >
            <SectionLabel labelId="person-activity-heading">{t("Activity")}</SectionLabel>
            {person.score ? (
              <Text as="p" size="caption" tone="muted" leading="inherit" className="audience-muted">
                {t("Interest score {p0}: {p1}", {
                  p0: formatNumber(person.score.value),
                  p1: person.score.reason,
                })}
              </Text>
            ) : null}
            {detail.enrollments.length ? (
              <Text as="p" size="caption" tone="muted" leading="inherit" className="audience-muted">
                {t("In {p0} sequence steps", { p0: detail.enrollments.length })}
              </Text>
            ) : null}
            {detail.interactions.length ? (
              <Timeline
                label={t("Activity")}
                now={now}
                maxHeight={320}
                events={detail.interactions.map((item) => ({
                  id: item.id,
                  at: item.at,
                  title:
                    item.direction === "outbound"
                      ? t("You: {p0}", { p0: interactionLabel(item.kind) })
                      : interactionLabel(item.kind),
                  meta: item.platform === "email" ? t("Email") : item.platform,
                  detail: item.text,
                }))}
              />
            ) : (
              <EmptyHint message={t("No activity recorded yet.")} />
            )}
          </section>

          <section
            {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "audience-panel-section")}
            aria-labelledby="person-merge-heading"
          >
            <SectionLabel labelId="person-merge-heading">{t("Same person?")}</SectionLabel>
            <MergeSection
              client={client}
              person={person}
              disabled={busy}
              onMerged={(merged, removed) => {
                setDetail((current) => (current ? { ...current, person: merged } : current));
                onMerged(merged, removed);
              }}
            />
          </section>

          <section
            {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "audience-panel-section")}
            aria-labelledby="person-data-heading"
          >
            <SectionLabel labelId="person-data-heading">{t("Their data")}</SectionLabel>
            <PersonDataSection
              client={client}
              person={person}
              disabled={busy}
              onDeleted={onDeleted}
            />
          </section>
        </div>
      ) : null}
    </Sheet>
  );
}

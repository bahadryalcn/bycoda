import { useContext, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Inbox as InboxIcon, Plus, RefreshCw } from "../../../shared/ui/icons";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialSnapshot } from "../model/social";
import {
  buildAttention,
  type AttentionSource,
  type AttentionTarget,
} from "../model/socialAttention";
import type { SocialClient } from "../model/socialClient";
import { SocialAssistant } from "./SocialAssistant";
import { SocialBusyContext, SocialPanelActiveContext } from "./socialContext";
import { Notice, time, type Run } from "./socialShared";
import { useSocialToday } from "./useSocialToday";
import "./social-today.css";

const sourceLabels = (): Record<AttentionSource, string> => ({
  campaigns: t("Content"),
  inbox: t("Inbox"),
  plans: t("Sharing plans"),
  history: t("Activity"),
  programs: t("Campaigns"),
});

/**
 * The daily landing view. Every row comes from a Host read made for this view; a read that is
 * loading or failed is named as such and is never presented as "nothing to do".
 */
export function SocialToday({
  client,
  snapshot,
  projects,
  projectFilter,
  machineLabel,
  run,
  onNavigate,
  onOpenProgram,
}: {
  client: SocialClient;
  /** Accounts-section snapshot: Host/sending state and the account list. */
  snapshot: SocialSnapshot;
  projects: HostProject[];
  projectFilter: string;
  machineLabel: string;
  run: Run;
  onNavigate: (tab: AttentionTarget | "Audience") => void;
  onOpenProgram: (id: string) => void;
}) {
  useLocale();
  const active = useContext(SocialPanelActiveContext);
  const locked = useContext(SocialBusyContext);
  const today = useSocialToday({
    client,
    projectId: projectFilter,
    active,
    programsSupported: !!snapshot.programsSupported,
    revision: snapshot,
  });
  // Read the clock once per mount (render stays pure for the React Compiler).
  const [now] = useState(Date.now);
  const result = buildAttention({ base: snapshot, sources: today.sources, now });
  const labels = sourceLabels();
  const loading = result.unavailable.filter((item) => item.state === "loading");
  const failed = result.unavailable.filter((item) => item.state === "error");
  const readAll = !result.unavailable.length;
  const contextProject =
    projectFilter || (projects.length === 1 ? projects[0].id : "");
  return (
    <div className="social-today">
      <SocialAssistant
        client={client}
        accounts={snapshot.accounts}
        projects={projects}
        profiles={today.profiles}
        machineLabel={machineLabel}
        projectId={contextProject}
        run={run}
        onOpenProgram={onOpenProgram}
        onOpenSettings={() => onNavigate("Settings")}
      />
      <div className="social-today-columns">
        <section aria-labelledby="social-today-attention">
          <h2 id="social-today-attention">{t("Needs attention")}</h2>
          {result.items.length ? (
            <ul className="social-today-list">
              {result.items.map((item) => (
                <li key={item.id} className="social-today-row" data-tone={item.tone}>
                  <div>
                    <strong>{item.title}</strong>
                    {item.detail ? <small>{item.detail}</small> : null}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={locked}
                    onClick={() => onNavigate(item.target)}
                  >
                    {item.action}
                  </Button>
                </li>
              ))}
            </ul>
          ) : loading.length && !failed.length ? (
            <Skeleton className="social-skeleton" aria-hidden="true" />
          ) : readAll ? (
            <p className="social-today-quiet" role="status">
              {t("Nothing needs your attention in the data read from {p0}.", { p0: machineLabel })}
            </p>
          ) : (
            <p className="social-today-quiet" role="status">
              {t("No problems in the data that could be read.")}
            </p>
          )}
          {result.failures.length ? (
            <>
              <p className="social-today-quiet">{t("Most common failure reasons (from loaded activity, no AI used)")}</p>
              <ul className="social-today-failures">
                {result.failures.map((failure) => (
                  <li key={failure.reason}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>
                        {failure.reason} ×{failure.count}
                      </span>
                      <BadgeList
                        label={t("Accounts")}
                        size="xs"
                        max={3}
                        items={failure.accounts.map((name, index) => ({
                          id: `${index}:${name}`,
                          label: name,
                        }))}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {failed.length ? (
            <div className="social-today-sources">
              <Notice kind="warning" title={t("Some data could not be read")}>
                <ul>
                  {failed.map((item) => (
                    <li key={item.source}>
                      {labels[item.source]}: {item.message}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  loading={today.fetching}
                  onClick={() => void today.refetch()}
                >
                  <RefreshCw aria-hidden="true" />
                  {t("Try again")}
                </Button>
              </Notice>
            </div>
          ) : null}
          {loading.length && result.items.length ? (
            <p className="social-today-quiet" role="status">
              {t("Still reading: {p0}", { p0: loading.map((item) => labels[item.source]).join(", ") })}
            </p>
          ) : null}
        </section>
        <section aria-labelledby="social-today-upcoming">
          <h2 id="social-today-upcoming">{t("Coming up")}</h2>
          {result.upcoming.length ? (
            <ul className="social-today-list">
              {result.upcoming.map((item) => (
                <li key={item.id} className="social-today-row">
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <span className="social-today-when">{time(item.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="social-today-quiet">
              {loading.length || failed.length
                ? t("Upcoming posts could not be fully read yet.")
                : t("No posts or plans are scheduled.")}
            </p>
          )}
        </section>
      </div>
      <p className="social-today-start">
        <Button variant="secondary" size="sm" type="button" disabled={locked} onClick={() => onNavigate("Campaigns")}>
          <Plus aria-hidden="true" />
          {t("Prepare content")}
        </Button>
        <Button variant="secondary" size="sm" type="button" disabled={locked} onClick={() => onNavigate("Inbox")}>
          <InboxIcon aria-hidden="true" />
          {t("Open Inbox")}
        </Button>
        {!snapshot.sendingEnabled ? (
          <Badge size="sm" tone="neutral">
            {t("Draft mode · sending off")}
          </Badge>
        ) : null}
      </p>
    </div>
  );
}

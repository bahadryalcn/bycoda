import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { SegmentedControl } from "../../../../../shared/ui/SegmentedControl";
import { SubTabs } from "../../../../../shared/ui/SubTabs";
import type { HostProject } from "../../../../connections/public/protocol";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { TikTokChanges, type TikTokChange } from "./TikTokChanges";
import { TikTokBusiness, type TikTokBusinessStatus } from "./TikTokBusiness";
import { TikTokDirectMessage } from "./TikTokDirectMessage";
import { TikTokReadouts } from "./TikTokReadouts";
import { TikTokPrivacy } from "./TikTokPrivacy";
import "./tiktok.css";
import { TikTokProfile } from "./TikTokProfile";

export type TikTokPanelProps = {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
};

export function TikTokAccountTools({
  client,
  account,
  projects,
  disabled,
  onChanged,
}: {
  client: SocialClient;
  account: SocialAccount;
  projects: HostProject[];
  disabled: boolean;
  onChanged(): void;
}) {
  const t = useT();
  const browser = account.connection === "browser";
  const [section, setSection] = useState("profile");
  const [changeDraft, setChangeDraft] = useState<TikTokChange>({
    kind: "follow",
  });
  const [businessStatus, setBusinessStatus] = useState<TikTokBusinessStatus>();
  const props = { client, accountId: account.id, disabled };
  // Eleven sections would wrap into two tab rows, so related ones share a tab and a view switch.
  // Every panel below stays mounted and only hides, so a draft survives switching sections.
  const groups = [
    {
      value: "account",
      label: t("Account"),
      views: [
        { value: "profile", label: t("Profile") },
        ...(browser
          ? [
              { value: "privacy", label: t("Privacy") },
              { value: "business", label: t("TikTok for Business") },
            ]
          : []),
      ],
    },
    {
      value: "insights",
      label: t("Analytics"),
      views: [
        { value: "analytics", label: t("Analytics") },
        ...(browser ? [{ value: "earnings", label: t("Earnings") }] : []),
      ],
    },
    ...(browser
      ? [
          {
            value: "conversations",
            label: t("Conversations"),
            views: [
              { value: "comments", label: t("Comments") },
              { value: "mentions", label: t("Mentions") },
              { value: "messages", label: t("Direct messages") },
            ],
          },
          {
            value: "audience",
            label: t("Audience"),
            views: [
              { value: "followers", label: t("Followers") },
              { value: "changes", label: t("TikTok changes") },
            ],
          },
          {
            value: "live",
            label: t("TikTok LIVE"),
            views: [{ value: "live", label: t("TikTok LIVE") }],
          },
        ]
      : []),
  ];
  const group =
    groups.find((item) => item.views.some((view) => view.value === section)) ?? groups[0]!;
  const selectChange = (change: TikTokChange) => {
    setChangeDraft(change);
    setSection("changes");
  };

  return (
    <Disclosure
      variant="row"
      summary={t("TikTok tools")}
      onOpenChange={(open) => {
        if (open && browser && !disabled && businessStatus === undefined)
          client
            .request<TikTokBusinessStatus>("tiktok.business.status", {
              accountId: account.id,
            })
            .then((status) => setBusinessStatus((current) => current ?? status))
            .catch(() => undefined);
      }}
    >
      <div className="tiktok-tools">
        <SubTabs
          wrap
          label={t("TikTok section")}
          value={group.value}
          onValueChange={(value) => {
            const next = groups.find((item) => item.value === value);
            if (next) setSection(next.views[0]!.value);
          }}
          items={groups.map(({ value, label }) => ({ value, label }))}
        />
        {group.views.length > 1 ? (
          <SegmentedControl
            label={t("TikTok view")}
            value={section}
            options={group.views}
            onValueChange={setSection}
          />
        ) : null}
        <div hidden={section !== "profile"}>
          <TikTokProfile
            {...props}
            browser={browser}
            accountName={account.name}
            onChanged={onChanged}
          />
        </div>
        {browser && (
          <>
            <div hidden={section !== "privacy"}>
              <TikTokPrivacy {...props} accountName={account.name} />
            </div>
            <div hidden={section !== "changes"}>
              <TikTokChanges
                active={section === "changes"}
                {...props}
                accountName={account.name}
                draft={changeDraft}
                onDraftChange={setChangeDraft}
                businessConnected={businessStatus?.connected === true}
              />
            </div>
            <div hidden={section !== "messages"}>
              <TikTokDirectMessage
                {...props}
                account={account}
                projects={projects}
                onChanged={onChanged}
              />
            </div>
            <div hidden={section !== "business"}>
              <TikTokBusiness {...props} status={businessStatus} onChanged={setBusinessStatus} />
            </div>
          </>
        )}
        {(
          [
            "analytics",
            ...(browser
              ? (["comments", "mentions", "messages", "followers", "earnings", "live"] as const)
              : []),
          ] as const
        ).map((view) => (
          <div key={view} hidden={section !== view}>
            <TikTokReadouts
              {...props}
              view={view}
              selectChange={selectChange}
              onChanged={onChanged}
              businessConnected={businessStatus?.connected === true}
            />
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

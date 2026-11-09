import { useMemo, type ComponentType } from "react";
import { socialClient } from "../../model/socialClient";
import { AccountsScreen } from "../accounts/AccountsScreen";
import { AudienceScreen } from "../audience/AudienceScreen";
import { CommandScreen } from "../command/CommandScreen";
import { ContentScreen } from "../content/ContentScreen";
import { InboxScreen } from "../inbox/InboxScreen";
import {
  SOCIAL_SCREEN_IDS,
  type SocialScreenId,
  type SocialScreenProps,
  type SocialShellState,
} from "./screens";

const SCREENS: Record<SocialScreenId, ComponentType<SocialScreenProps>> = {
  command: CommandScreen,
  content: ContentScreen,
  audience: AudienceScreen,
  inbox: InboxScreen,
  accounts: AccountsScreen,
};

export type HostPanelsProps = {
  machineId: string;
  /** This Host is the one on screen. */
  active: boolean;
  screen: SocialScreenId;
  target?: unknown;
  visited: SocialScreenId[];
  projectId?: string;
  shellState: SocialShellState;
  onNavigate: SocialScreenProps["onNavigate"];
};

/**
 * Every section one Host has opened, kept mounted so drafts survive navigation and Host switches.
 * Only the current section of the active Host is visible; `active` tells it to pause timers.
 */
export function HostPanels({
  machineId,
  active,
  screen,
  target,
  visited,
  projectId,
  shellState,
  onNavigate,
}: HostPanelsProps) {
  const client = useMemo(() => socialClient(machineId), [machineId]);
  return (
    <div className="social-shell-host" hidden={!active}>
      {SOCIAL_SCREEN_IDS.filter((id) => visited.includes(id)).map((id) => {
        const Screen = SCREENS[id];
        const current = active && id === screen;
        return (
          <div key={id} className="social-shell-panel" hidden={!current}>
            <Screen
              client={client}
              machineId={machineId}
              projectId={projectId}
              shellState={shellState}
              active={current}
              target={id === screen ? target : undefined}
              onNavigate={onNavigate}
            />
          </div>
        );
      })}
    </div>
  );
}

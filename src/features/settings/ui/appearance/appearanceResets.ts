import {
  DEFAULT_SESSION_LIST_DISPLAY,
  updateSessionListDisplay,
} from "../../../sessions/public/sessionListDisplay";
import {
  DECORATIVE_MOTION_DEFAULT,
  FOLLOW_SYSTEM_MOTION_DEFAULT,
  saveDecorativeMotionEnabled,
  saveFollowSystemMotionEnabled,
} from "../../model/decorativeMotion";
import {
  CREW_GROWTH_ENABLED_DEFAULT,
  CREW_SCENE_ENABLED_DEFAULT,
  TAB_ANIMATIONS_ENABLED_DEFAULT,
  saveCrewGrowthEnabled,
  saveCrewSceneEnabled,
  saveCrewTheme,
  saveTabAnimationsEnabled,
} from "../../model/settings";

/**
 * Resets of Appearance settings that live in standalone stores. Each row's reset button and the
 * page-level "Restore defaults" call the same function, so they cannot drift apart.
 */
export function resetCrew() {
  saveCrewSceneEnabled(CREW_SCENE_ENABLED_DEFAULT);
  saveCrewGrowthEnabled(CREW_GROWTH_ENABLED_DEFAULT);
  saveCrewTheme("classic");
}

export function resetMotion() {
  saveTabAnimationsEnabled(TAB_ANIMATIONS_ENABLED_DEFAULT);
  saveDecorativeMotionEnabled(DECORATIVE_MOTION_DEFAULT);
  saveFollowSystemMotionEnabled(FOLLOW_SYSTEM_MOTION_DEFAULT);
}

/** Row density plus the model and branch lines it shows. */
export function resetSessionRows() {
  const { density, showModel, showBranch } = DEFAULT_SESSION_LIST_DISPLAY;
  updateSessionListDisplay({ density, showModel, showBranch });
}

export function resetGroupDelay() {
  updateSessionListDisplay({ groupDelayMs: DEFAULT_SESSION_LIST_DISPLAY.groupDelayMs });
}

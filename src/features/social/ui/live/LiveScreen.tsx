import { LiveStreamPanel } from "../../../live-stream";
import type { SocialScreenProps } from "../shell/screens";

/** Live streaming belongs to this computer, so the section ignores the selected Host and project. */
export function LiveScreen(_props: SocialScreenProps) {
  return <LiveStreamPanel />;
}

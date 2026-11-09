import { Badge } from "../../../../shared/ui/Badge";
import { channelName, PlatformIcon, type SocialChannel } from "./PlatformIcon";

/** Platform mark and name as one neutral chip, or "Email" for the email channel. */
export function PlatformBadge({ platform }: { platform: SocialChannel }) {
  return (
    <Badge size="sm" tone="neutral" icon={<PlatformIcon platform={platform} />}>
      {channelName(platform)}
    </Badge>
  );
}

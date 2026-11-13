import { MessageSquare } from "../../../../shared/ui/icons";
import type { OutreachChannel } from "../../model/outreach";
import { PlatformIcon } from "../common/PlatformIcon";

/** The mark of an outreach channel: its own glyph for email, WhatsApp and Telegram, a message glyph for the in-platform ones. */
export function ChannelIcon({ channel }: { channel: OutreachChannel }) {
  return channel === "email" || channel === "whatsapp" || channel === "telegram" ? (
    <PlatformIcon platform={channel} />
  ) : (
    <MessageSquare className="icon-sm" aria-hidden="true" />
  );
}

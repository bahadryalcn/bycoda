import type { AssistantAlwaysOn } from "../../../src/shared/model/assistantAlwaysOn";

/** Registered push phones, as the push store reports them; Assistant updates are one event flag. */
export type PushPhoneReader = () => Promise<readonly { events: { assistant: boolean } }[]>;

/** Counts phones that can receive stall and job notifications. A missing reader reads as none. */
export async function readAlwaysOn(read: PushPhoneReader | undefined): Promise<AssistantAlwaysOn> {
  const phones = (await read?.()) ?? [];
  return {
    pushPhones: phones.length,
    assistantPushPhones: phones.filter((phone) => phone.events.assistant).length,
  };
}

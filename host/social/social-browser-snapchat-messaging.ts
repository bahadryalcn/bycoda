import { denied, json } from "./social-browser-publishing-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import { snapchatProtectedScreen } from "./social-browser-snapchat-guard";
import { needsHumanError } from "./browser/challenge";

type FriendChat = { threadId: string; href: string; recipient: string };
export const snapChatLocation = String.raw`((location.origin==='https://web.snapchat.com'&&location.pathname==='/') || (location.origin==='https://www.snapchat.com'&&/^\/web\/?$/.test(location.pathname)))`;

export function snapchatConversation(
  owner: string,
  recipient: string,
  expectedThread?: string,
): string {
  return String.raw`
    if(!${snapChatLocation})return;
    const visible=el=>!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
    const conversations=[...document.querySelectorAll('[data-conversation-id]')].filter(visible);
    if(conversations.length!==1)return;
    const thread=conversations[0],threadId=thread.getAttribute('data-conversation-id');
    const participants=new Set([...thread.querySelectorAll('[data-participant-username]')].map(el=>'web:snapchat:'+el.getAttribute('data-participant-username').toLowerCase()));
    const current=new URL(location.href).searchParams.getAll('chatId'),desired=${json(expectedThread ?? null)};
    if(!/^[\w-]{8,100}$/.test(threadId||'')||(desired&&desired!==threadId)||
      (current.length&&(current.length!==1||current[0]!==threadId))||
      participants.size!==2||!participants.has(${json(owner)})||!participants.has(${json(recipient)}))return;
  `;
}

export async function proveSnapchatMessagingScreen(ctx: BrowserRecipeContext): Promise<void> {
  const challenge = await snapchatProtectedScreen(ctx.page);
  if (challenge) throw needsHumanError(challenge);
  await ctx.verifyIdentity();
}

/** Opens a verified friend entry only. Arbitrary search, Add Friend and invites are never used. */
export async function openSnapchatFriend(
  ctx: BrowserRecipeContext,
  recipient: string,
  expectedThread?: string,
): Promise<FriendChat> {
  if (!/^web:snapchat:[a-z][\w.-]{1,30}$/.test(recipient) || recipient === ctx.account.platformId)
    throw denied();
  const username = recipient.slice("web:snapchat:".length);
  const friends =
    '[data-testid="my-friends-list"],[aria-label="My Friends"],[aria-label="Arkadaşlarım"]';
  await proveSnapchatMessagingScreen(ctx);
  const friendsControl = String.raw`(() => {
    if(!${snapChatLocation})return false;
    const visible=el=>!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
    const controls=[...document.querySelectorAll('button[data-testid="my-friends"],button[aria-label="My Friends"],button[aria-label="Arkadaşlarım"]')]
      .filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    if([...document.querySelectorAll(${json(friends)})].some(el=>visible(el)&&!el.matches('button,[role="button"]'))||controls.length!==1)return false;
    document.querySelectorAll('[data-bycoda-snap-friends]').forEach(el=>el.removeAttribute('data-bycoda-snap-friends'));
    controls[0].setAttribute('data-bycoda-snap-friends','true');return true;
  })()`;
  if (await ctx.page.evaluate<boolean>(friendsControl)) {
    await ctx.page.click('[data-bycoda-snap-friends="true"]');
  }
  const friendControl = String.raw`(() => {
    if(!${snapChatLocation})return false;
    const visible=el=>!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
    const lists=[...document.querySelectorAll(${json(friends)})].filter(el=>visible(el)&&!el.matches('button,[role="button"]'));
    if(lists.length!==1)return false;
    const rows=[...lists[0].querySelectorAll('[data-username]')].filter(el=>visible(el)&&el.getAttribute('data-username')?.toLowerCase()===${json(username)});
    if(rows.length!==1)return false;
    const row=rows[0];
    const relationship=row.getAttribute('data-relationship');
    if((relationship&&relationship!=='friend')||row.querySelector('[data-testid="add-friend"],[data-testid="invite-friend"],[data-testid="friend-request-pending"]'))return false;
    const buttons=[...row.querySelectorAll('button[data-testid="open-chat"],button[aria-label="Chat"],button[aria-label="Sohbet"]')]
      .filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    if(buttons.length!==1)return false;
    document.querySelectorAll('[data-bycoda-snap-open-chat]').forEach(el=>el.removeAttribute('data-bycoda-snap-open-chat'));
    buttons[0].setAttribute('data-bycoda-snap-open-chat',${json(username)});return true;
  })()`;
  const target = await ctx.waitFor<boolean>(friendControl, 12_000);
  await proveSnapchatMessagingScreen(ctx);
  if (!target || !(await ctx.page.evaluate<boolean>(friendControl))) throw denied();
  await ctx.page.click(`[data-bycoda-snap-open-chat=${json(username)}]`);
  const chat = await ctx.waitFor<FriendChat>(
    String.raw`(() => {
    ${snapchatConversation(ctx.account.platformId, recipient, expectedThread)}
    return {threadId,href:location.origin+location.pathname+'?chatId='+encodeURIComponent(threadId),recipient:${json(recipient)}};
  })()`,
    20_000,
  );
  if (!chat) {
    await proveSnapchatMessagingScreen(ctx);
    throw denied();
  }
  return chat;
}

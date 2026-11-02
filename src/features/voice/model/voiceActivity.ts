const owners=new Set<symbol>();
const listeners=new Set<()=>void>();
export const isVoiceConversationActive=()=>owners.size>0;
export function subscribeVoiceConversationActivity(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
/** Same-renderer activity only; native/Host playback leases retain their own authority. */
export function claimVoiceConversationActivity(){
  const token=Symbol();const wasActive=owners.size>0;owners.add(token);
  if(!wasActive)for(const listener of listeners)listener();
  return()=>{const active=owners.size>0;owners.delete(token);if(active&&!owners.size)for(const listener of listeners)listener();};
}

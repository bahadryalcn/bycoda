import type { AssistantProfile } from "../../../shared/model/host-contracts/assistant";
export function maySpeakVoiceBriefing(profile:AssistantProfile,presence:string,status:string,hold:boolean,hour:number) {
  if(presence!=="active"||status!=="ready"||hold||profile.proactiveSpeech==="never")return false;
  const quiet=profile.quietStart===profile.quietEnd?false:profile.quietStart<profile.quietEnd?
    hour>=profile.quietStart&&hour<profile.quietEnd:hour>=profile.quietStart||hour<profile.quietEnd;
  return !quiet;
}

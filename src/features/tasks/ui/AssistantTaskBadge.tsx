import type {HostTask} from "../model/hostTasks";
import {Badge} from "../../../shared/ui/Badge";
import {Tooltip} from "../../../shared/ui/Tooltip";
import {useT} from "../../../shared/i18n";

export function AssistantTaskBadge({task}:{task:HostTask}) {
 const t=useT(),counts=task.assistantFollowups;
 if(!counts||!Number.isSafeInteger(counts.delivered)||!Number.isSafeInteger(counts.unconfirmed)||counts.delivered<0||counts.unconfirmed<0||(!counts.delivered&&!counts.unconfirmed))return null;
 const label=t("Assistant follow-ups ({p0})",{p0:counts.delivered.toLocaleString()});
 return counts.unconfirmed?<Tooltip label={t("Some assistant follow-up outcomes are unconfirmed.")}><Badge tone="warning" size="xs">{label} · {t("Unconfirmed")}</Badge></Tooltip>:<Badge tone="info" size="xs">{label}</Badge>;
}

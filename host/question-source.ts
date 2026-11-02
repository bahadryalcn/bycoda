import {createHash} from "node:crypto";
import type {HostSession} from "../src/features/connections/model/protocol";
/** Backend occurrence + immutable execution and complete provider question payload. */
export function hostQuestionToken(record:HostSession):string|undefined{
 const question=record.session.pendingQuestion;
 if(!record.runId||!question?.occurrenceId)return;
 return createHash("sha256").update(JSON.stringify({sessionId:record.session.id,projectId:record.projectId,cwd:record.session.worktreeCwd??record.session.cwd,generation:record.authorityGeneration,runId:record.runId,occurrenceId:question.occurrenceId,requestId:question.requestId,providerTurnId:question.providerTurnId,callId:question.callId,questions:question.questions,behavior:question.behavior,dismissAction:question.dismissAction})).digest("hex");
}

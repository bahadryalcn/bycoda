import {expect,it} from "vitest";
import {verifiedAssistantJobDeleteReview} from "./assistantJobDeletion";
import type {AssistantJob,AssistantJobDeleteReview} from "../../../shared/model/host-contracts/assistant";
const job={id:"job",version:2,projectId:"a",projectIds:["a","b"],goalId:"assistant-job"} as AssistantJob;
const review:AssistantJobDeleteReview={jobId:"job",jobVersion:2,sourceToken:"a".repeat(64),goalId:"assistant-job",projectIds:["a","b"],tasks:[{id:"task",title:"Actual title",projectId:"b",status:"running",updatedAt:4}]};
it("accepts only canonical exact-version task scope when every contributing project remains visible",()=>{
 expect(verifiedAssistantJobDeleteReview(job,review,()=>true)).toEqual(review);
 for(const changed of [{...review,jobVersion:1},{...review,jobId:"other"},{...review,goalId:"other"},{...review,projectIds:["a"]},{...review,sourceToken:"model-token"},{...review,tasks:[...review.tasks,...review.tasks]},{...review,tasks:[{...review.tasks[0],projectId:"hidden"}]}])expect(verifiedAssistantJobDeleteReview(job,changed,()=>true)).toBeUndefined();
 expect(verifiedAssistantJobDeleteReview(job,review,id=>id==="a")).toBeUndefined();expect(verifiedAssistantJobDeleteReview({...job,kind:"quick"} as AssistantJob,review,()=>true)).toBeUndefined();
 const captured=verifiedAssistantJobDeleteReview(job,review,()=>true)!;review.tasks[0].title="Changed after capture";expect(captured.tasks[0].title).toBe("Actual title");
});

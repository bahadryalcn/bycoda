import type { SocialAdapter, SocialHttp } from "../adapter";
import { publishMetaMedia } from "../metaMedia";
import { createFacebookPageOperations } from "./facebook-page-operations";
import { createFacebookPublishing } from "./facebook-publishing";
import { createMetaAdapter } from "./meta-shared";

export function createFacebookAdapter(http: SocialHttp, graphVersion: string): SocialAdapter {
  const meta = createMetaAdapter(http, graphVersion, "facebook");
  const publishing = createFacebookPublishing(http, graphVersion);
  return {
    ...meta,
    facebook: createFacebookPageOperations(http, graphVersion),
    send(account, job, ...args) {
      if (
        job.kind === "publish" &&
        !job.payload.facebook &&
        job.payload.media.some((item) => item.uploadId)
      ) {
        const [token, read, checkpoint, beforeSubmit] = args;
        return publishMetaMedia(
          http,
          "facebook",
          account,
          job,
          token,
          graphVersion,
          checkpoint,
          beforeSubmit,
          Date.now,
          read,
        );
      }
      return job.payload.facebook && job.payload.facebook.target !== "reel"
        ? publishing.send(account, job, ...args)
        : meta.send(account, job, ...args);
    },
    reconcile(account, job, token) {
      return job.payload.facebook && job.payload.facebook.target !== "reel"
        ? publishing.reconcile!(account, job, token)
        : meta.reconcile!(account, job, token);
    },
  };
}

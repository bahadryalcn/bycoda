import { SocialPlatformError, type SocialAdapter, type SocialJob } from "../adapter";

type CreatePost = (text: string, previousPostId: string | undefined) => Promise<string>;

/** Journal before submission. A process exit during a request leaves a fence against duplicates. */
export async function sendXThread(
  job: SocialJob,
  posts: readonly string[],
  create: CreatePost,
  checkpoint: Parameters<SocialAdapter["send"]>[4],
  beforeSubmit: Parameters<SocialAdapter["send"]>[5],
): Promise<string> {
  const saved = job.preparation?.xThread;
  if (!checkpoint || saved?.submitting || (saved && saved.postIds.length > posts.length))
    throw new SocialPlatformError("unknown");
  let postIds = saved?.postIds ?? [];
  const record = async (submitting: boolean) => {
    const preparation = { ...job.preparation, xThread: { postIds, submitting } };
    await checkpoint(preparation);
    job.preparation = preparation;
  };
  for (const text of posts.slice(postIds.length)) {
    await record(true);
    try {
      await beforeSubmit?.();
      const postId = await create(text, postIds.at(-1));
      postIds = [...postIds, postId];
      await record(false);
    } catch (error) {
      if (
        postIds.length ||
        !(error instanceof SocialPlatformError) ||
        error.code === "unknown"
      )
        throw new SocialPlatformError("unknown");
      await record(false);
      throw error;
    }
  }
  return postIds[0]!;
}

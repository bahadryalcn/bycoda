export type PublishedPostDeletion = "review" | "deleted";

export type PublishedPost = {
  jobId: string;
  postId: string;
  title: string;
  subreddit?: string;
  url?: string;
  deletion?: PublishedPostDeletion;
};

export type PublishedPosts = { posts: PublishedPost[]; next?: number };

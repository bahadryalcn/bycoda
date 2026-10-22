import type { SocialPolicy } from "./social";
/** Shared character counting and limits without desktop agent-validation imports. */

export function socialCharacterCount(text: string): number {
  return Array.from(text).length;
}

export function socialLimit(
  policy: SocialPolicy,
  kind: "content" | "comment" | "message",
): number | undefined {
  return policy[
    kind === "content"
      ? "maxContentCharacters"
      : kind === "comment"
        ? "maxCommentCharacters"
        : "maxMessageCharacters"
  ];
}

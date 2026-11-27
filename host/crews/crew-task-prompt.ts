/** Compose the request before role context without modifying saved instructions.
 * The checkout and no-commit rules come once, from the worker prompt around it. */
export function crewTaskPrompt(input: {
  request: string;
  instructions: string;
  tools: string;
  scope: string;
}): string {
  return [
    input.request,
    `Role context and instructions:\n${input.instructions}`,
    input.tools,
    input.scope,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Write scopes a crew member is given; the checkout rule itself comes from the worker prompt. */
export function crewMemberScope(files?: readonly string[]): string {
  return files ? `Your write scopes: ${files.join(", ")}. Read outside them as needed.` : "";
}

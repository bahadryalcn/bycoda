/** Compose the request before role context without modifying saved instructions. */
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
  ].join("\n\n");
}

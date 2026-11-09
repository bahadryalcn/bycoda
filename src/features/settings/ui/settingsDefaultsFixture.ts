/** Expected effective delegation settings for the Settings test's single-model catalog. */
const productRef = { harness: "codex", model: "codex:test", providerAccountId: "default" };
export const expectedProductExtras = {
  crossAdvisor: JSON.stringify(productRef),
  crossSubagents: JSON.stringify([productRef]),
};

/** Compact names shared by inbox service links and composer cards. */
export function providerLabel(provider: string | undefined): string {
  switch (provider) {
    case "linear":
      return "Linear";
    case "jira":
      return "Jira";
    case "gitlab":
      return "GitLab";
    case "azuredevops":
      return "ADO";
    default:
      return "GitHub";
  }
}

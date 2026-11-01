# Working with bycoda tools

The assistant can search bycoda's tools by purpose and inspect the full contract
only for the tools it needs. Existing tool names remain available. Finding a tool
does not mean its machine, device or provider is connected or ready.

When you ask for a web application to be checked in the browser, the assistant
uses the integrated preview first when available. The preview opens in the
originating conversation's Browser panel by default. A responsive check can resize
the browser viewport; this does not simulate a physical phone.

The assistant reports page verification and panel visibility separately. If the
desktop is unavailable, it may verify the page without claiming that you saw it.
Another conversation's browser control is never taken over automatically.

Background work does not need to open panels. A created task is not necessarily
running; a completed task may still need review; a saved schedule has not yet run.
The assistant should state the observed stage and any remaining blocker.

Approval rules are unchanged. Drafts do not authorize sending, tool discovery does
not enable disabled skills, and a timeout does not authorize repeating a mutation.
For uncertain operations the assistant checks the original result before retrying.

# Manage decision models

Open **Settings > Providers > Decision models**. These models answer small, typed
questions, such as choosing a visible button or classifying a message. They do not
replace your conversation model or grant permission to send, publish or delete.

Summary chips and the personal-data privacy switch sit at the top. Connected
models appear in compact rows with one status badge, an indication of which
source is tried first, and duplicate markers when sources share a model or
endpoint. Use the row's test button or its menu to edit or remove that source.

## Add an existing local model

1. Open **Add model** and choose the folder option.
2. Select the model's installation folder, or paste its full path. For example,
   `G:\Projects\my_projects\clef`.
3. Scan the folder. The app looks for model files, installation information and a
   compatible runtime. Scanning does not start a program or connect a source.
4. Review the result. If several models are found, choose the one to use.
   Vision projector files are supporting files, not separate decision models.
5. Choose **Test and add**. The connection result tells you whether the source is
   ready. A failed or unfinished test is shown explicitly; adding a source alone
   does not prove that it works.

Prefer the installation folder over a whole drive. A large scan can stop at its
time or file limit; an incomplete scan does not mean that no model exists.
Missing runtime files or an unsupported model may still require manual setup.
The same **Add model** menu lets you choose a model file directly, install a
model, or connect a local service, API provider or custom endpoint.

## Choose which model answers

**Automatic** uses connected sources in this order: local models, APIs, gateways,
then structured LLM sources. It is a routing policy, not a bundled model. With no
connected source, decision-model requests are unavailable.

Task routing uses one table, with customized tasks first. Its compact view shows
existing custom routes; expand it to edit all tasks, their source order and
confidence thresholds. Existing routes stay in place until you save. Clear a
task's source selection to return it to Automatic. Selected source names appear
in fallback order. Saving confirms in place; failures retain the draft for retry.

The confidence threshold decides when an answer can be used. A threshold of
`0.85` requires at least 85% confidence on the gateway's scale. Lower-confidence
answers are skipped and the next source is tried. This is not a promise of 85%
accuracy. A task using Automatic keeps the default threshold.

## Advanced discovery

Discovery is collapsed by default. Expand it to review found models and scan
settings when a model lives outside the usual folders or a service uses another
port. Add the folder or local port and save the scan settings to scan again.
Results list candidates; they are not connected until
you explicitly add them.

For a discovered model file, **Add** opens its installation for review. The app
finds the matching runtime and keeps the selected model; **Test and add** then
registers and tests it. Discovery labels are never used as filesystem paths.

An incomplete scan keeps the results already found and explains that more files
may remain. Retry with a narrower folder when needed.

## Privacy

**Personal data stays on this computer** restricts personal-data requests to local
sources with loopback endpoints. It does not fall back to a remote API for those
requests. Provider keys stay in the credential store and are not written into
the model configuration.

For the gateway contract and maintainer details, see
[Decision models integration](../integrations/decision-models.md).

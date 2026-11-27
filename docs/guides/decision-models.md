# Manage decision models

Open **Settings > Decision models**. These models answer small, typed
questions, such as choosing a visible button or classifying a message. They do not
replace your conversation model or grant permission to send, publish or delete.

The page opens on this computer's Host. While it is loading or offline the page
says so and offers no setup; it never uses another machine in its place. When
other machines are saved, **Applying settings to** lets you choose one
explicitly, and only a connected machine can be set up.

Summary chips and the personal-data privacy switch sit at the top. Connected
models appear in compact rows with one status badge, an indication of which
source is tried first, and duplicate markers when sources share a model or
endpoint. Use the row's test button or its menu to edit or remove that source.

## Add an existing local model

1. Open **Add model** and choose the folder option.
2. Select the model's installation folder, or paste its full path. For example,
   `D:\Models\clef`.
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

A local install shows the bytes downloaded so far and can be cancelled while it
runs; cancelling removes the partial download. Starting the same install again,
even from another window, joins the one already running. A Host that has not
been updated still installs, but shows no progress and cannot cancel.

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

**Found on this computer** lists models and local services the scan found that
are not connected yet. They are not connected until you explicitly add them.
When a model lives outside the usual folders or a service uses another port,
open **Scan settings**, add the folder or port, and choose **Save and scan**.

For a discovered model file, **Add** opens its installation for review. The app
finds the matching runtime and keeps the selected model; **Test and add** then
registers and tests it. Discovery labels are never used as filesystem paths.

An incomplete scan keeps the results already found and explains that more files
may remain. Retry with a narrower folder when needed.

Opening the page scans only when the Host has no scan on record. When a scan found
nothing, the Host remembers that for 24 hours, or until the scan ports or folders
change, and opening the page does not scan again. Use **Scan again** to look
sooner. A scan that fails shows its error and is not remembered.

## Privacy

**Send personal data only to models on this computer**, under Task routing,
restricts personal-data requests to local sources with loopback endpoints. The
app marks three kinds of request as personal data: a contact's interest score,
the sentiment of a message, and choosing who runs a task board task. When the
switch is on and no local model is connected, those decisions are skipped; they
never fall back to a remote API. When it is off, API sources can answer them too. Provider keys stay in the credential store and are not written into
the model configuration.

For the gateway contract and maintainer details, see
[Decision models integration](../integrations/decision-models.md).

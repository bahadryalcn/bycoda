// Renderer bootstrap: adopted-session digests compare blocks in the form this desktop stores
// them. Kept out of the Host's import graph, which must not load the desktop session store.
import { registerStoredBlockForm } from "../model/adoptedSessions";
import { storedBlockForm } from "../../sessions/public/sessionStore";

registerStoredBlockForm(storedBlockForm);

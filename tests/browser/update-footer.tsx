import { useState } from "react";
import { createRoot } from "react-dom/client";
import { version as appVersion } from "../../package.json";
import { GithubStarPrompt } from "../../src/app/shell/GithubStarPrompt";
import { SidebarUpdateFooter } from "../../src/app/shell/SidebarUpdate";
import { consumeInstalledUpdate, rememberInstalledUpdate } from "../../src/app/model/updateNotice";
import { snoozeUpdatePrompt } from "../../src/app/model/updatePrompt";
import { useUpdateNotices } from "../../src/app/workspace/surfaces/useUpdateNotices";
import { languageReady } from "../../src/shared/i18n";
import { Button } from "../../src/shared/ui/Button";
import { ButtonGroup } from "../../src/shared/ui/ButtonGroup";
import "../../src/styles/index.css";

// Real product components, browser-local state, and mocked native operations only.
const params = new URLSearchParams(location.search);
const installation = params.get("install") ?? appVersion;
const seedKey = "bycoda.updateFooterFixture.seededVersion";
if (localStorage.getItem(seedKey) !== installation) {
  rememberInstalledUpdate(installation);
  localStorage.setItem(seedKey, installation);
}
snoozeUpdatePrompt();

function Fixture() {
  const notices = useUpdateNotices({ installedUpdate: consumeInstalledUpdate() });
  const [clicks, setClicks] = useState(0);
  return (
    <main className="update-fixture" data-update-footer-fixture>
      <h1>Update footer</h1>
      <p>Browser fixture: native update and repository actions are mocked.</p>
      <aside className="update-fixture-rail" aria-label="Update footer specimen">
        {params.has("prompt") ? (
          <GithubStarPrompt version={params.get("version") ?? appVersion} />
        ) : (
          <SidebarUpdateFooter
            repositoryPrompt
            update={notices.updateNotice}
            onOpenWhatsNew={notices.onOpenWhatsNew}
            onDismissUpdate={notices.onDismissUpdate}
          />
        )}
      </aside>
      <section className="update-fixture-specimen" aria-label="Shared group specimen">
        <ButtonGroup aria-label="Representative actions">
          <Button variant="ghost" motion="none" onClick={() => setClicks((value) => value + 1)}>
            Enabled action
          </Button>
          <Button variant="ghost" motion="none" disabled>
            Disabled action
          </Button>
          <Button variant="ghost" motion="none" loading loadingLabel="Working">
            Pending action
          </Button>
        </ButtonGroup>
      </section>
      <output className="update-fixture-output" data-fixture-notes>
        {notices.whatsNewVersion ?? "No release notes opened"}
      </output>
      <output className="update-fixture-output" data-fixture-clicks>
        {clicks}
      </output>
    </main>
  );
}

void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));

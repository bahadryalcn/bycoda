import { useState } from "react";
import { createRoot } from "react-dom/client";
import { version as appVersion } from "../../package.json";
import { GithubStarPrompt } from "../../src/app/shell/GithubStarPrompt";
import { SidebarUpdateFooter } from "../../src/app/shell/SidebarUpdate";
import { SidebarAccountFooter } from "../../src/app/shell/SidebarAccountFooter";
import { RailAction } from "../../src/app/shell/RailAction";
import { VoiceLauncher } from "../../src/features/voice/ui/companion/VoiceLauncher";
import { consumeInstalledUpdate, rememberInstalledUpdate } from "../../src/app/model/updateNotice";
import { snoozeUpdatePrompt } from "../../src/app/model/updatePrompt";
import { useUpdateNotices } from "../../src/app/workspace/surfaces/useUpdateNotices";
import { languageReady } from "../../src/shared/i18n";
import { Button } from "../../src/shared/ui/Button";
import { ButtonGroup } from "../../src/shared/ui/ButtonGroup";
import { Clock, FolderTree, Inbox, LayoutGrid, PanelLeft, Search } from "../../src/shared/ui/icons";
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
  if (params.has("account")) {
    const compact = params.has("compact");
    return (
      <main className="update-fixture" data-update-footer-fixture>
        <h1>Account footer</h1>
        <p>Browser fixture: account, update and repository operations are mocked.</p>
        <aside
          className="update-account-rail bycoda-project-rail"
          data-account-fixture-rail
          data-compact={compact || undefined}
          style={params.has("narrow") ? { inlineSize: 200 } : undefined}
          aria-label="Account footer specimen"
        >
          <div className="update-account-brand">
            <img src="/brand/bycoda/app-icon.svg" alt="bycoda" />
          </div>
          <nav className="bycoda-rail-tools" aria-label="Workspace tools">
            <RailAction
              label="Sidebar"
              icon={PanelLeft}
              onClick={() => setClicks((value) => value + 1)}
            />
            <RailAction
              label="Search"
              icon={Search}
              onClick={() => setClicks((value) => value + 1)}
            />
            <RailAction
              label="Inbox"
              icon={Inbox}
              onClick={() => setClicks((value) => value + 1)}
            />
            <RailAction
              label="Workspace"
              icon={LayoutGrid}
              onClick={() => setClicks((value) => value + 1)}
            />
            <RailAction
              label="Working"
              icon={Clock}
              onClick={() => setClicks((value) => value + 1)}
            />
            <RailAction
              label="Projects"
              icon={FolderTree}
              onClick={() => setClicks((value) => value + 1)}
            />
          </nav>
          <nav className="bycoda-rail-tools bycoda-rail-tools--footer" aria-label="Account">
            <SidebarAccountFooter
              compact={compact}
              onOpenSettings={() => setClicks((value) => value + 1)}
            />
          </nav>
        </aside>
        <VoiceLauncher
          ref={null}
          visual="orb"
          name={params.get("name") ?? "Arif"}
          avatar={undefined}
          state="off"
          onOpen={() => setClicks((value) => value + 1)}
        />
      </main>
    );
  }
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

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";

type Status = {
  environmentId: string;
  sourceMachineId: string;
  authorityMachineId?: string;
  authority: { environmentId: string; mapping: Record<string, string> } | null;
  projects: { id: string; name: string }[];
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Keep the renderer's validation consistent with the peer host contract.
function peerEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Bu bilgisayarın ulaşılabilir HTTPS adresini girin.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error("HTTPS adresi kullanın; adrese kullanıcı bilgisi, yol veya sorgu eklemeyin.");
  return url.origin;
}

export function SocialAuthority({
  machines,
  selectedHost,
  projects,
  run,
  onSelect,
}: {
  machines: RemoteMachine[];
  selectedHost: string;
  projects: HostProject[];
  run: (work: () => Promise<unknown>) => Promise<boolean>;
  onSelect: (id: string) => void;
}) {
  const [status, setStatus] = useState<Status>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<{
    host: string;
    mapping: Record<string, string>;
    sourceEndpoint: string;
  }>();
  const epoch = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const selected = useRef(selectedHost);
  selected.current = selectedHost;
  const machinesVersion = JSON.stringify(
    machines.map((machine) => [machine.id, machine.environmentId, machine.endpoint]).sort(),
  );

  const loadStatus = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const value = await invoke<Status | null>("social_authority_status");
      if (!mounted.current || version !== epoch.current) return;
      if (!value) throw new Error("Yerel host bağlantısı kurulamadı.");
      setStatus(value);
    } catch (error) {
      if (mounted.current && version === epoch.current) {
        setStatus(undefined);
        setError(`Merkezi host ayarı okunamadı: ${errorText(error)}`);
      }
    } finally {
      if (mounted.current && version === epoch.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void loadStatus();
    return () => {
      mounted.current = false;
      ++epoch.current;
    };
  }, [machinesVersion, loadStatus]);

  const target = machines.find((machine) => machine.id === selectedHost);
  const remote = !!status && status.sourceMachineId !== selectedHost && !!target;
  const savedMapping =
    status?.authorityMachineId === selectedHost ? (status.authority?.mapping ?? {}) : {};
  // Never reuse a previous target's project IDs when switching hosts.
  const current =
    config?.host === selectedHost
      ? config
      : { host: selectedHost, mapping: savedMapping, sourceEndpoint: "" };
  const validMapping = Object.fromEntries(
    Object.entries(current.mapping).filter(
      ([from, to]) =>
        status?.projects.some((project) => project.id === from) &&
        projects.some((project) => project.id === to),
    ),
  );
  const staleMappings = Object.entries(current.mapping).some(
    ([from, to]) => to && validMapping[from] !== to,
  );
  const update = (changes: Partial<typeof current>) => {
    setConfig({ ...current, ...changes });
    setError("");
    setNotice("");
  };
  const changeAuthority = (
    machineId: string | null,
    mapping: Record<string, string>,
    sourceEndpoint: string | null,
  ) => {
    if (!status || pending.current) return;
    const requestedHost = selectedHost;
    const sourceMachineId = status.sourceMachineId;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let started = false;
    void run(async () => {
      started = true;
      try {
        await invoke("social_authority_connect", {
          machineId,
          mapping,
          sourceEndpoint,
        });
        if (!mounted.current) return;
        setConfig(undefined);
        setNotice(
          machineId
            ? "Merkezi host kaydedildi. Yeni ayarı kullanmak için ajan oturumlarını yeniden başlatın."
            : "Yerel host'a dönüldü. Gönderimler durdurulmuş durumda.",
        );
        await loadStatus();
        if (mounted.current && selected.current === requestedHost)
          onSelect(machineId ?? sourceMachineId);
      } catch (error) {
        if (mounted.current) setError(`Host ayarı değiştirilemedi: ${errorText(error)}`);
        throw error;
      }
    })
      .then((success) => {
        if (!success && !started && mounted.current)
          setError("Başka bir işlem sürüyor. Host ayarını tekrar kaydedin.");
      })
      .catch(
        (error) => mounted.current && setError(`Host ayarı değiştirilemedi: ${errorText(error)}`),
      )
      .finally(() => {
        pending.current = false;
        if (mounted.current) setBusy(false);
      });
  };

  return (
    <details className="social-form" aria-busy={loading || busy}>
      <summary>Birden fazla bilgisayar için merkezi host</summary>
      <p className="social-muted">
        Aynı hesapları başka bilgisayarlardan yönetiyorsanız tek bir host kullanın. Tek bilgisayarda
        bu ayarı değiştirmeniz gerekmez.
      </p>
      {loading ? <p role="status">Host ayarı yükleniyor…</p> : null}
      {error ? (
        <p className="social-error" role="alert">
          {error}
        </p>
      ) : null}
      {!status && !loading ? (
        <button type="button" disabled={busy} onClick={() => void loadStatus()}>
          Tekrar dene
        </button>
      ) : null}
      {status ? (
        <>
          <p>
            {status.authority
              ? `Kullanılan merkezi host: ${machines.find((item) => item.id === status.authorityMachineId)?.name ?? "Kayıtlı host (bağlantı listesinde yok)"}`
              : "Ajan oturumları bu bilgisayarın host'unu kullanıyor."}
          </p>
          {remote ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || loading) return;
                if (staleMappings) {
                  setError("Proje listesi değişti. Proje eşleştirmelerini yeniden seçin.");
                  return;
                }
                if (!Object.keys(validMapping).length) {
                  setError("En az bir projeyi seçili host'taki projeyle eşleştirin.");
                  return;
                }
                try {
                  changeAuthority(selectedHost, validMapping, peerEndpoint(current.sourceEndpoint));
                } catch (error) {
                  setError(errorText(error));
                }
              }}
            >
              <fieldset className="social-workspace" disabled={busy || loading}>
                <p>
                  <strong>Yeni merkezi host: {target.name}</strong>
                </p>
                <label>
                  Bu bilgisayarın host HTTPS adresi
                  <input
                    required
                    type="url"
                    value={current.sourceEndpoint}
                    placeholder="https://windows-host.example"
                    onChange={(event) => update({ sourceEndpoint: event.target.value })}
                  />
                </label>
                <p className="social-muted">
                  Seçili host bu adrese ulaşabilmelidir. İki host'un da birbirine bağlı olması
                  gerekir.
                </p>
                <h3>Proje eşleştirmeleri</h3>
                <p className="social-muted">
                  Bu bilgisayardaki her proje için merkezi host'taki karşılığını seçin.
                </p>
                {!status.projects.length ? <p>Bu bilgisayarda eşleştirilecek proje yok.</p> : null}
                {!projects.length ? (
                  <p>Seçili host'ta proje bulunamadı. Önce bu host'ta bir proje açın.</p>
                ) : null}
                {status.projects.map((project) => (
                  <label key={project.id}>
                    {project.name}
                    <select
                      value={validMapping[project.id] ?? ""}
                      onChange={(event) =>
                        update({
                          mapping: {
                            ...validMapping,
                            [project.id]: event.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Bu projeyi paylaşma</option>
                      {projects.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {staleMappings ? (
                  <p role="alert" className="social-error">
                    Bazı kayıtlı projeler artık bulunamıyor. Eşleştirmeleri yeniden seçin.
                  </p>
                ) : null}
                <button
                  className="social-primary"
                  disabled={!Object.keys(validMapping).length || staleMappings}
                >
                  {busy ? "Kaydediliyor…" : `${target.name} host'unu kullan`}
                </button>
              </fieldset>
            </form>
          ) : null}
          {status.authority ? (
            <div className="social-actions">
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => changeAuthority(null, {}, null)}
              >
                Yerel host'a dön ve gönderimleri durdur
              </button>
            </div>
          ) : null}
          <p className="social-muted">
            Merkezi host'ta proje ve hesap izinleri ayrıca geçerlidir. Host değişikliği gönderim
            izni vermez.
          </p>
        </>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </details>
  );
}

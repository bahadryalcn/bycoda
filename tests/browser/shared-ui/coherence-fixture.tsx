import { useState } from "react";
import { Alert } from "../../../src/shared/ui/Alert";
import { Button } from "../../../src/shared/ui/Button";
import { EffortScale } from "../../../src/shared/ui/EffortScale";
import { SegmentedControl } from "../../../src/shared/ui/SegmentedControl";
import { Select } from "../../../src/shared/ui/Select";
import { Text } from "../../../src/shared/ui/Text";
import { TextareaField } from "../../../src/shared/ui/TextareaField";
import { Sparkles } from "../../../src/shared/ui/icons";

// Fixture-only adversarial data. Labels are unbounded strings at these component boundaries.
const datasets = {
  demo: ["Jo", "Personal account", "Workspace account"],
  worst: [
    "Aleksandra Wiśniewska-Kowalczyk · Üretim ortamı 👩🏽‍💻",
    "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
    "محمد عبد الرحمن · تجربة مساحة العمل",
  ],
  empty: [],
  one: ["Ö"],
  many: Array.from({ length: 1000 }, (_, index) => `Workspace account ${index + 1}`),
};
type Dataset = keyof typeof datasets;

export function CoherenceFixture() {
  const params = new URLSearchParams(location.search);
  const initial = params.get("data") as Dataset;
  const [dataset, setDataset] = useState<Dataset>(initial in datasets ? initial : "demo");
  const [effort, setEffort] = useState("high");
  const [disabled, setDisabled] = useState(false);
  const [account, setAccount] = useState("0");
  const labels = datasets[dataset];
  if (params.get("data") === "textarea")
    return (
      <main className="h-full overflow-auto p-4">
        <section aria-label="Textarea resize fixture" className="mx-auto grid max-w-lg gap-4">
          <TextareaField label="Default resizing" defaultValue="Resizable form text" />
          <TextareaField
            label="Caller disabled resizing"
            className="resize-none"
            defaultValue="Consumer owns growth"
          />
          <TextareaField
            label="Automatic height"
            autosize
            minRows={1}
            maxRows={4}
            defaultValue="Content sizes this field"
          />
          <div className="flex h-40 flex-col">
            <TextareaField label="Fill panel" fill defaultValue="Panel owns height" />
          </div>
        </section>
      </main>
    );
  return (
    <main className="h-full overflow-auto p-4" dir={params.get("dir") === "rtl" ? "rtl" : "ltr"}>
      <section aria-label="UI coherence fixture" className="mx-auto grid max-w-lg gap-4 pb-20">
        <Text as="p" size="body" tone="primary" wrap="anywhere">
          {labels[0] ?? "No accounts"}
        </Text>
        <Text as="p" wrap="anywhere">
          {dataset === "worst"
            ? "Bağlantı kurulamadı. G:\\Projects\\Northwind Industries Holdings\\müşteri-çalışmaları\\üretim-hesapları\\remote-workspace-production-2026.json"
            : "Choose account and reasoning effort."}
        </Text>
        <Select
          label="Account"
          value={account}
          options={labels.map((label, index) => ({ value: String(index), label }))}
          onValueChange={setAccount}
        />
        <EffortScale
          label="Reasoning effort"
          value={effort}
          disabled={disabled}
          options={[
            { value: "automatic", label: "Automatic", icon: <Sparkles className="icon-sm" /> },
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            {
              value: "high",
              label:
                dataset === "worst" ? "Yüksek düşünme seviyesi, ayrıntılı değerlendirme" : "High",
            },
            { value: "ultra", label: "Ultra" },
          ]}
          onValueChange={setEffort}
        />
        <Button onClick={() => setDisabled(!disabled)}>
          {disabled ? "Enable effort" : "Disable effort"}
        </Button>
        <Alert tone="danger" title="Account quota reached">
          {dataset === "worst"
            ? "Bu hesabın kullanım sınırı doldu. Başka hesap veya model seçerek devam edebilirsiniz. Taslağınız korunur."
            : "Choose another account or model to continue."}
        </Alert>
      </section>
      <div className="fixed inset-x-0 bottom-0 flex justify-center p-3">
        <SegmentedControl
          label="Fixture data"
          value={dataset}
          options={[
            { value: "demo", label: "Demo data" },
            { value: "worst", label: "Worst case" },
            { value: "empty", label: "Empty" },
            { value: "one", label: "One" },
            { value: "many", label: "1,000" },
          ]}
          onValueChange={(value) => {
            const next = value as Dataset;
            setDataset(next);
            setAccount(datasets[next].length ? "0" : "");
            const url = new URL(location.href);
            url.searchParams.set("data", next);
            history.replaceState(null, "", url);
          }}
        />
      </div>
    </main>
  );
}

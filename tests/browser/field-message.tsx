import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TextField } from "../../src/shared/ui/TextField";
import { TextareaField } from "../../src/shared/ui/TextareaField";
import { TagInput } from "../../src/shared/ui/TagInput";
import "../../src/styles/index.css";

// FIXTURE evidence only: the application facades (bycoda-arc scope) over the three Arc
// consumers of the shared FieldMessage renderer.
const HELP =
  "Kullanıcılara gösterilen bu açıklama kasıtlı olarak uzundur: birden fazla satıra sarılmalı, taşmamalı ve hata mesajı geldiğinde alanın yerleşimini bozmamalıdır. 外部サービスとの接続に使用される識別子を入力してください。";
const ERROR = "Bu alan zorunludur ve en fazla 64 karakter olabilir, 12 karakter kaldı.";

function Fixture() {
  const [failed, setFailed] = useState(false);
  const error = failed ? ERROR : undefined;
  return (
    <main className="mx-auto grid max-w-md gap-6 p-6" aria-label="Field message fixture">
      <button type="button" onClick={() => setFailed((value) => !value)}>
        {failed ? "Clear error" : "Show error"}
      </button>
      <section aria-label="Input field" className="grid gap-2">
        <TextField label="Display name" description={HELP} error={error} defaultValue="" />
      </section>
      <section aria-label="Textarea field" className="grid gap-2">
        <TextareaField label="Summary" description={HELP} error={error} defaultValue="" />
      </section>
      <section aria-label="TagInput field" className="grid gap-2">
        <TagInput label="Labels" description={HELP} error={error} defaultValue={["alpha"]} />
      </section>
    </main>
  );
}

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
createRoot(document.getElementById("root")!).render(<Fixture />);

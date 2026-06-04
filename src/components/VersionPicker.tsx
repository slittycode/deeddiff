import { open } from "@tauri-apps/plugin-dialog";
import type { VersionInput } from "../lib/types";
import { routeFile } from "../lib/ingest";

interface Props {
  label: string;
  value: VersionInput | null;
  onChange: (v: VersionInput | null) => void;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function VersionPicker({ label, value, onChange }: Props) {
  const pick = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Agreement", extensions: ["docx", "pdf"] }],
    });
    if (typeof selected !== "string") return;
    const name = basename(selected);
    const kind = routeFile(name);
    if (kind === "reject") {
      alert("Please choose a .docx or .pdf file.");
      return;
    }
    onChange({ path: selected, name, kind });
  };

  return (
    <div className="version-picker">
      <span className="vp-label">{label}</span>
      <button onClick={pick}>{value ? value.name : "Choose file…"}</button>
      {value && (
        <span className="vp-kind">{value.kind === "pdf" ? "PDF" : "DOCX"}</span>
      )}
    </div>
  );
}

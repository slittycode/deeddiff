import { useEffect, useState } from "react";
import type { ModelInfo } from "../lib/types";
import { listModels } from "../lib/ollama";
import { errorMessage } from "../lib/notes";

interface Props {
  value: string | null;
  onChange: (model: string) => void;
}

/** Smallest model first is a reasonable default on modest hardware. */
function pickDefault(models: ModelInfo[], remembered: string | null): string | null {
  if (remembered && models.some((m) => m.name === remembered)) return remembered;
  const bySize = [...models].sort((a, b) => (a.size_bytes ?? 0) - (b.size_bytes ?? 0));
  return bySize[0]?.name ?? null;
}

function sizeHint(m: ModelInfo): string {
  if (m.param_size) return ` (${m.param_size})`;
  if (m.size_bytes) return ` (${(m.size_bytes / 1e9).toFixed(1)} GB)`;
  return "";
}

export function ModelSelector({ value, onChange }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "down" | "empty">("loading");

  const refresh = async () => {
    setStatus("loading");
    try {
      const list = await listModels();
      setModels(list);
      if (list.length === 0) {
        setStatus("empty");
      } else {
        setStatus("ready");
        if (!value) {
          const def = pickDefault(list, localStorage.getItem("deeddiff.model"));
          if (def) onChange(def);
        }
      }
    } catch (err) {
      setStatus("down");
      console.warn("ollama list failed:", errorMessage(err));
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="model-selector">
      <label>Model</label>
      {status === "loading" && <span className="muted">Checking Ollama…</span>}
      {status === "down" && (
        <span className="warn">
          Ollama isn't running. Start it (<code>ollama serve</code>), then{" "}
          <button className="link" onClick={refresh}>retry</button>.
        </span>
      )}
      {status === "empty" && (
        <span className="warn">
          No models installed. Run <code>ollama pull llama3.1</code>, then{" "}
          <button className="link" onClick={refresh}>retry</button>.
        </span>
      )}
      {status === "ready" && (
        <select
          value={value ?? ""}
          onChange={(e) => {
            onChange(e.target.value);
            localStorage.setItem("deeddiff.model", e.target.value);
          }}
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {sizeHint(m)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import type { ModelSelection, ThinkingLevel } from "@/lib/shared/types";
import { api } from "@/lib/client/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Label } from "./ui/label";

const THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function ModelPicker({
  value,
  onChange,
}: {
  value: ModelSelection;
  onChange: (next: ModelSelection) => void;
}) {
  const [models, setModels] = React.useState<{ provider: string; id: string }[]>([]);

  React.useEffect(() => {
    void api.models().then(setModels);
  }, []);

  const current = `${value.provider}::${value.model}`;
  const options = React.useMemo(() => {
    const list = models.map((m) => ({ key: `${m.provider}::${m.id}`, provider: m.provider, id: m.id }));
    if (!list.some((o) => o.key === current)) {
      list.unshift({ key: current, provider: value.provider, id: value.model });
    }
    return list;
  }, [models, current, value.provider, value.model]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label>Model</Label>
        <Select
          value={current}
          onValueChange={(v) => {
            const [provider, model] = v.split("::");
            onChange({ ...value, provider, model });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                <span>{o.id}</span>
                <span className="ml-2 text-xs text-muted-foreground">{o.provider}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Thinking</Label>
        <Select value={value.thinking} onValueChange={(v) => onChange({ ...value, thinking: v as ThinkingLevel })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THINKING.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

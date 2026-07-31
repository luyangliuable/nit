"use client";

import type { SessionSnapshot, SessionConfig } from "@/lib/shared/types";
import { useStore } from "@/lib/client/store";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { ModelPicker } from "../model-picker";

// Comma or space separated list helpers for tag style inputs.
function parseList(s: string): string[] {
  return s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}

export function ConfigForm({ snapshot }: { snapshot: SessionSnapshot }) {
  const { updateConfig } = useStore();
  const c = snapshot.config;
  const set = (patch: Partial<SessionConfig>) => updateConfig(c.id, patch);

  return (
    <div className="space-y-4 p-3 text-sm">
      <Field label="Repository (owner/name or URL)">
        <Input value={c.repo} placeholder="owner/name" onChange={(e) => set({ repo: e.target.value })} />
      </Field>

      <Field label="Local clone path (Implement mode)">
        <Input value={c.localPath} placeholder="/path/to/clone" onChange={(e) => set({ localPath: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Interval (s)">
          <Input type="number" value={c.interval} onChange={(e) => set({ interval: Number(e.target.value) })} />
        </Field>
        <Field label="Debounce (min)">
          <Input type="number" value={c.debounceMinutes} onChange={(e) => set({ debounceMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Max attempts">
          <Input type="number" value={c.maxAttempts} onChange={(e) => set({ maxAttempts: Number(e.target.value) })} />
        </Field>
        <Field label="Max age (days)">
          <Input type="number" value={c.maxAgeDays} onChange={(e) => set({ maxAgeDays: Number(e.target.value) })} />
        </Field>
      </div>

      <Field label="Diff cap (bytes)">
        <Input type="number" value={c.diffCapBytes} onChange={(e) => set({ diffCapBytes: Number(e.target.value) })} />
      </Field>

      <Field label="Skills (one path per line)">
        <Textarea
          value={c.skills.join("\n")}
          placeholder="/abs/path/to/skill"
          onChange={(e) => set({ skills: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>

      <Field label="Append prompt">
        <Textarea value={c.appendPrompt} onChange={(e) => set({ appendPrompt: e.target.value })} />
      </Field>

      <Field label="Blacklist authors">
        <Input value={c.blacklistAuthors.join(", ")} onChange={(e) => set({ blacklistAuthors: parseList(e.target.value) })} />
      </Field>
      <Field label="Whitelist authors">
        <Input value={c.whitelistAuthors.join(", ")} onChange={(e) => set({ whitelistAuthors: parseList(e.target.value) })} />
      </Field>
      <Field label="Whitelist PRs">
        <Input value={c.whitelistPrs.join(", ")} onChange={(e) => set({ whitelistPrs: parseList(e.target.value) })} />
      </Field>

      <ModelPicker value={c.model} onChange={(model) => set({ model })} />

      <div className="space-y-2 border-t border-border pt-3">
        <Toggle label="Include own PRs" checked={c.includeOwn} onChange={(v) => set({ includeOwn: v })} />
        <Toggle label="Notify on new PR" checked={c.notifyOnNewPr} onChange={(v) => set({ notifyOnNewPr: v })} />
        <Toggle label="Notify on new commit" checked={c.notifyOnNewCommit} onChange={(v) => set({ notifyOnNewCommit: v })} />
        <Toggle label="Notify on verdict ready" checked={c.notifyOnVerdict} onChange={(v) => set({ notifyOnVerdict: v })} />
        <Toggle label="Notification sound" checked={c.sound} onChange={(v) => set({ sound: v })} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

"use client";

import { FiEye, FiCode } from "react-icons/fi";
import type { SessionSnapshot } from "@/lib/shared/types";
import { useStore } from "@/lib/client/store";
import { cn } from "./ui/utils";
import { ReviewMode } from "./review/review-mode";
import { ImplementMode } from "./implement/implement-mode";

export function Workspace({ snapshot }: { snapshot: SessionSnapshot }) {
  const { updateConfig } = useStore();
  const mode = snapshot.config.mode;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        <div className="inline-flex rounded-md border border-border p-0.5">
          <ModeButton
            active={mode === "review"}
            onClick={() => updateConfig(snapshot.config.id, { mode: "review" })}
            icon={<FiEye className="h-3.5 w-3.5" />}
            label="Review PR"
          />
          <ModeButton
            active={mode === "implement"}
            onClick={() => updateConfig(snapshot.config.id, { mode: "implement" })}
            icon={<FiCode className="h-3.5 w-3.5" />}
            label="Implement"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "review" ? (
          <ReviewMode snapshot={snapshot} />
        ) : (
          <ImplementMode snapshot={snapshot} />
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

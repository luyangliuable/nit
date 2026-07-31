"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { FiBell, FiMoon, FiSun } from "react-icons/fi";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useStore } from "@/lib/client/store";

export function TopBar() {
  const { sessions } = useStore();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const totalUnread = sessions.reduce((sum, s) => sum + s.unreadCount, 0);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-3">
        <Logo className="text-lg" />
        <span className="text-xs text-muted-foreground">PR centric coding agent</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="relative">
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <FiBell className="h-4 w-4" />
          </Button>
          {totalUnread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px]"
            >
              {totalUnread}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {mounted && theme === "dark" ? <FiSun className="h-4 w-4" /> : <FiMoon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}

import * as React from "react";
import { cn } from "./utils";

// Lightweight scroll container. Native overflow, thin scrollbar via utilities.
const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn("overflow-y-auto", className)} {...props}>
      {children}
    </div>
  ),
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };

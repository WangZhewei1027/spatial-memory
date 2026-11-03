import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared surface for application navigation; content and landmarks stay with the caller. */
export const NavigationIsland = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("navigation-island", className)} {...props} />
  ),
);
NavigationIsland.displayName = "NavigationIsland";

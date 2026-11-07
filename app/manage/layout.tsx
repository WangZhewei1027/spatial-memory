import { Suspense, type ReactNode } from "react";
import { TeamPageLoading, TeamShell } from "./components/TeamShell";

/** Navigation and the work surface persist while only the child route changes. */
export default function ManageLayout({ children }: { children: ReactNode }) {
  return <TeamShell><Suspense fallback={<TeamPageLoading label="…" />}>{children}</Suspense></TeamShell>;
}

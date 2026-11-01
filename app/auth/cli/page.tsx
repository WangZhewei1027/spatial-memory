import type { Metadata } from "next";
import { Suspense } from "react";
import { CliLoginForm } from "./CliLoginForm";

export const metadata: Metadata = {
  title: "Spatial Memory CLI",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Suspense fallback={null}><CliLoginForm /></Suspense>;
}

import { Suspense } from "react";
import { AssetDetailRoute } from "../../assets/components/AssetDetailRoute";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense><AssetDetailRoute params={params} library="anchor" /></Suspense>;
}

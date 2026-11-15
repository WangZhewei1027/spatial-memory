"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ManageGridLayout } from "./ManageGridLayout";

/**
 * Neutral three-column placeholder shown while the organization's content
 * collection data is loading.
 */
export function ManageLayoutSkeleton({ fill }: { fill?: boolean } = {}) {
  return (
    <ManageGridLayout
      fill={fill}
      mapEditor
      controls={<Skeleton className="h-8 w-48" />}
      list={
        <Card className="h-full space-y-3 p-3" aria-busy>
          <Skeleton className="h-8 w-2/3" />
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-12 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          ))}
        </Card>
      }
      viewer={<Skeleton className="h-full w-full rounded-none" />}
      sidebar={
        <Card className="space-y-3 p-3" aria-busy>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </Card>
      }
    />
  );
}

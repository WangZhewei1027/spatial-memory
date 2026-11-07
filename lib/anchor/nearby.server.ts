import "server-only";
import { createHash } from "node:crypto";
import { resourceUrl } from "@/lib/assets/urls";
import { db, sql } from "@/lib/db";

interface Candidate {
  id: string;
  asset_id: string;
  name: string;
  file_url: string;
  metadata: Record<string, unknown>;
  distance_meters: number;
  reference_version: string;
}

export async function findNearbyAnchors(
  workspaceId: string,
  gps: { latitude: number; longitude: number; radius: number },
): Promise<Candidate[]> {
  const point = sql`ST_SetSRID(ST_MakePoint(${gps.longitude}::float8, ${gps.latitude}::float8),4326)::geography`;
  const { rows } = await sql<Candidate & { storage_key: string | null; external_url: string | null; updated_at: Date }>`
    select * from (
      select distinct on (p.asset_id) p.asset_id id,a.id asset_id,coalesce(p.name,a.name,'') name,
        r.storage_key,r.external_url,a.updated_at,a.payload->'attributes' metadata,
        ST_Distance(p.location::geography,${point}) distance_meters
      from placement p join asset a on a.id=p.asset_id
      join workspace w on w.id=p.workspace_id join organization o on o.id=p.organization_id
      join lateral (select storage_key,external_url from asset_resource where asset_id=a.id and role in ('reference','primary') order by case role when 'reference' then 0 else 1 end,ordinal limit 1) r on true
      where p.workspace_id=${workspaceId}::uuid and a.file_type='anchor' and p.status='active'
        and w.archived_at is null and o.archived_at is null and p.location is not null
        and ST_DWithin(p.location::geography,${point},${Math.min(gps.radius,200)}::float8)
      order by p.asset_id,distance_meters
    ) candidates order by distance_meters,id limit 201
  `.execute(db);
  return rows.map((row) => {
    const fileUrl = resourceUrl(row);
    return { ...row, file_url: fileUrl, reference_version: createHash("sha256").update(`${fileUrl}:${row.updated_at}`).digest("hex") };
  });
}

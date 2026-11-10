import "server-only";
import { MAX_ANCHOR_REFERENCES } from "@/lib/content-model/contracts";
import { resourceUrl } from "@/lib/assets/urls";
import { db, sql } from "@/lib/db";
import { referenceVersion } from "./reference-version";

interface Candidate {
  id: string;
  asset_id: string;
  name: string;
  /** First reference image; kept for clients that read one image. */
  file_url: string;
  /** Every reference image in ordinal order (at least one). */
  file_urls: string[];
  metadata: Record<string, unknown>;
  distance_meters: number;
  reference_version: string;
}

type ReferenceFile = { storage_key: string | null; external_url: string | null };

export async function findNearbyAnchors(
  workspaceId: string,
  gps: { latitude: number; longitude: number; radius: number },
): Promise<Candidate[]> {
  const point = sql`ST_SetSRID(ST_MakePoint(${gps.longitude}::float8, ${gps.latitude}::float8),4326)::geography`;
  // Reference images in ordinal order; legacy anchors without one fall back to their primary file.
  const { rows } = await sql<Omit<Candidate, "file_url" | "file_urls" | "reference_version"> & { refs: ReferenceFile[]; updated_at: Date }>`
    select * from (
      select distinct on (p.asset_id) p.asset_id id,a.id asset_id,coalesce(p.name,a.name,'') name,
        r.refs,a.updated_at,a.payload->'attributes' metadata,
        ST_Distance(p.location::geography,${point}) distance_meters
      from placement p join asset a on a.id=p.asset_id
      join workspace w on w.id=p.workspace_id join organization o on o.id=p.organization_id
      join lateral (
        select json_agg(json_build_object('storage_key',ar.storage_key,'external_url',ar.external_url) order by ar.ordinal) refs
        from asset_resource ar
        where ar.asset_id=a.id and ar.role=(
          select case when bool_or(x.role='reference') then 'reference' else 'primary' end
          from asset_resource x where x.asset_id=a.id and x.role in ('reference','primary'))
          and (ar.role='reference' or ar.ordinal=0)
      ) r on r.refs is not null
      where p.workspace_id=${workspaceId}::uuid and a.file_type='anchor' and p.status='active'
        and w.archived_at is null and o.archived_at is null and p.location is not null
        and ST_DWithin(p.location::geography,${point},${Math.min(gps.radius,200)}::float8)
      order by p.asset_id,distance_meters
    ) candidates order by distance_meters,id limit 201
  `.execute(db);
  return rows.map(({ refs, ...row }) => {
    const urls = refs.slice(0, MAX_ANCHOR_REFERENCES).map(resourceUrl);
    return { ...row, file_url: urls[0], file_urls: urls, reference_version: referenceVersion(urls, row.updated_at) };
  });
}

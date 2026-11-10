"use client";

import { MapCenterSection } from "./MapCenterSection";
import { FileTypesSection } from "./FileTypesSection";

interface OrgFormSectionsProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  fileTypes: Set<string>;
  toggleFileType: (type: string) => void;
}

export function OrgFormSections({
  lat,
  setLat,
  lng,
  setLng,
  fileTypes,
  toggleFileType,
}: OrgFormSectionsProps) {
  return (
    <>
      <div className="border-t" />
      <MapCenterSection lat={lat} setLat={setLat} lng={lng} setLng={setLng} />

      <div className="border-t" />
      <FileTypesSection fileTypes={fileTypes} toggleFileType={toggleFileType} />
    </>
  );
}

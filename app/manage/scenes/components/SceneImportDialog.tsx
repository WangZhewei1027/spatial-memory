"use client";

import { SceneNameDialog } from "@/app/manage/content/SceneNameDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/typography";
import { useId, useRef, useState } from "react";
import { newIdempotencyKey, organizationApi } from "../../lib/content-api";
import { ERROR_TEXTS, runContentAction } from "../../lib/content-errors";
import { useIntegrationText, type IntegrationTexts } from "../../lib/integration-text";
import { readSceneImport } from "../../lib/scene-document";

const TEXTS: IntegrationTexts = {
  ...ERROR_TEXTS,
  "contentModel.integration.sceneImport.title": ["导入场景 JSON", "Import scene JSON"],
  "contentModel.integration.sceneImport.body": [
    "在团队「{{team}}」中新建场景。使用文件中引用的素材最新内容。",
    "Creates a scene in the team “{{team}}”. References use the latest asset content.",
  ],
  "contentModel.integration.sceneImport.file": ["场景文件", "Scene file"],
  "contentModel.integration.sceneImport.action": ["导入", "Import"],
  "contentModel.integration.sceneImport.fileRequired": ["请选择一个 JSON 文件", "Choose a JSON file"],
};

/** Import a schema-4 document with asset references. */
export function SceneImportDialog({ open, onOpenChange, teamName, organizationId, onImported }: {
  open: boolean; onOpenChange: (open: boolean) => void; teamName: string; organizationId: string; onImported: (sceneId: string) => void;
}) {
  const tx = useIntegrationText(TEXTS);
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const key = useRef<string | null>(null);

  const submit = (name: string) => runContentAction(async () => {
    if (!file) throw new Error(tx("contentModel.integration.sceneImport.fileRequired"));
    const document = readSceneImport(await file.text());
    key.current ??= newIdempotencyKey();
    return organizationApi.createScene(organizationId, { name, document, idempotencyKey: key.current });
  }, tx, (scene) => {
    key.current = null;
    setFile(null);
    onImported(scene.id);
  });

  return (
    <SceneNameDialog
      open={open}
      onOpenChange={(next) => { if (!next) { setFile(null); key.current = null; } onOpenChange(next); }}
      title={tx("contentModel.integration.sceneImport.title")}
      description={tx("contentModel.integration.sceneImport.body", { team: teamName })}
      submitLabel={tx("contentModel.integration.sceneImport.action")}
      initialName={file?.name.replace(/\.json$/i, "") ?? ""}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor={id}>{tx("contentModel.integration.sceneImport.file")}</Label>
        <Input id={id} type="file" accept="application/json,.json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); key.current = null; }} />
        {file && <Text as="p" variant="bodyXs" tone="subdued">{file.name}</Text>}
      </div>
    </SceneNameDialog>
  );
}

## 组织配置扩展流程（Web 管理端 → 小程序消费）

当需要为组织添加新的可配置项时，遵循以下步骤。

---

### 第一步：数据库

`organization` 表有一个 `config jsonb NOT NULL DEFAULT '{}'` 字段，直接在其中新增 key，无需加列。

---

### 第二步：Web 管理端

#### 1. 类型（`components/org-settings/types.ts`）

在 `OrgConfig` 接口中加字段（`app/super-admin/organizations/types.ts` 只是从这里 re-export）：

```ts
export interface OrgConfig {
  confetti_enabled?: boolean;
  your_new_field?: YourType;
}
```

#### 2. API 路由

读取：`app/api/admin/organizations/route.ts` 的 Kysely 查询已选出 `organization.config`；写入：`app/super-admin/organizations/actions.ts`（`updateOrganization`）与 `app/api/organizations/[id]/route.ts`（PUT）都接受整个 `config` 对象并以 `JSON.stringify` 写入 jsonb 列。新增字段时同步检查两条写路径的类型和值校验；例如 `text_asset_miniapp_style` 会过滤非法枚举值。客户端表单校验不能替代服务端校验。

#### 3. Hook（`components/org-settings/useOrgSettingsForm.ts`，super-admin 与 `/admin/settings` 共用）

- 初始化 state：`useState(org.config?.your_new_field ?? defaultValue)`
- 加入 `hasChanged` 比较
- `handleSave` 时写入 `config: { ...existingFields, your_new_field: value }`

#### 4. UI 组件（`components/org-settings/`）

新建 section 组件，参考 `MiniappConfigSection.tsx`：

- 使用已有 UI 组件（`Checkbox`、`Select` 等，注意 `Switch` 未安装）
- 引入 `SectionHeader` + i18n

#### 5. 串联（`OrgFormSections.tsx` → `OrgSettingsForm.tsx`）

- `OrgFormSections` 加 props、渲染新 section
- `OrgSettingsForm` 从 hook 取新值并透传（`app/super-admin/organizations/components/OrgDetailPanel.tsx` 与 `app/admin/settings/page.tsx` 都渲染它）

#### 6. i18n（用 Python 更新，避免加载大 JSON 到上下文）

```python
python3 - <<'EOF'
import json
for lang, zh, en in [
    ('zh', '中文标签', '...'),
    ('en', '...', 'English Label'),
]:
    path = f'locales/{lang}.json'
    with open(path) as f: d = json.load(f)
    d['superAdmin']['orgs']['section']['yourSection'] = zh if lang == 'zh' else en
    d['superAdmin']['orgs']['yourSection'] = {'yourKey': zh if lang == 'zh' else en}
    with open(path, 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2); f.write('\n')
EOF
```

---

### 第三步：公开接口白名单（`app/api/miniapp/organizations/route.ts`）

小程序只能通过匿名接口 `GET /api/miniapp/organizations?ids=` 读组织配置，该路由用 `PUBLIC_CONFIG_KEYS` 数组过滤 `config`，**新 key 必须加进这个白名单**，否则小程序永远读不到（同步更新 `docs/miniapp-api.md` 里的键列表）。

### 第四步：小程序消费

小程序通过 `fetchOrgStyle`（`miniprogram/components/xr-start/index.js`）调用 `fetchOrganizations([orgId])`（`miniprogram/utils/backend.ts`）拉取组织配置：

```js
const { statusCode, data } = await fetchOrganizations([orgId]);
const row = data[0];
const cfg = row.config && typeof row.config === "object" ? row.config : {};
// 结果存入 this._orgConfig
this._orgConfig = cfg;
```

首页 `miniprogram/pages/index/index.ts` 也通过 `fetchOrganizations` 读同一份 `config`。在需要读取配置的地方直接使用：

```js
if (this._orgConfig && this._orgConfig.your_new_field) {
  // 执行对应逻辑
}
```

> `fetchOrgStyle` 在组件 `attached()` 时调用，早于资源加载完成，读取时序安全。

---

### 注意事项

- `config` 字段更新时应合并写入，不要覆盖整个对象：`config: { ...existingConfig, new_key: value }`
- 小程序不直连数据库：只能读到 `PUBLIC_CONFIG_KEYS` 白名单内的键，`config` 里的其他内容对外不可见
- 新配置项默认值应为"关闭/保守"状态（如 `false`、`null`），避免意外开启功能

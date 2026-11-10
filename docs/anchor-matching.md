# 匹配点与图像识别

小程序上传现场图片与 WGS84 GPS，服务端在当前合集的附近匹配点中筛选、比较特征，命中后返回关联投放。识别表示附近地点匹配，不提供相机 6DoF 或厘米级 AR 重定位。部署拓扑见 [线上部署说明](production-deployment.md)。

## 素材、投放与参考特征

匹配点是 `file_type="anchor"` 的团队素材，参考图片来自 `asset_resource` 的 reference 资源（序号 0 起，最多 5 张；旧数据回退到 primary#0），特征保存在 `anchor_embedding`。地理位置由该素材的 Placement 决定；其他投放通过 `anchor_id` 关联匹配点素材 ID。

创建匹配点素材、上传参考图和在合集投放是不同操作。浏览器上传 JPEG/PNG/WebP 原图（最多 32 MiB），服务端以最长边 1280px、JPEG quality 65 和 256 KiB 预算压缩，必要时降为 1024px / quality 50；透明图保留 PNG，最终上限 4 MiB；保存后可生成特征，失败不删除图片。修改参考图会使旧特征失效，生成任务通过 generation ID 防止旧结果覆盖新图；改名或移动投放不需要重新编码图片。

识别候选来自当前未归档团队、未归档合集中的 active 匹配点投放，按匹配点素材去重。命中响应的 `anchor.id` 是匹配点素材 ID；`assets[].id` 是关联内容的 **Placement ID**。响应包含当前素材/场景内容及投放参数，不返回数据库实体或固定版本。

## 接口边界

| 接口 | 访问方式与作用 |
| --- | --- |
| `POST /api/miniapp/anchors/recognize?workspace_id=<uuid>` | 匿名，提交现场图片；必须指定单个合集 |
| `GET /api/assets/<anchor_id>/matching` | 当前实现为公开状态读取，不返回特征向量 |
| `POST /api/assets/<anchor_id>/matching` | 当前实现为公开生成/重建，只处理已存匹配点参考图 |

`proxy.ts` 放行这些路径；匹配点素材创建和编辑仍通过正常团队内容接口鉴权。参考图片只允许本项目媒体域名下的 assets 对象，不能通过生成接口指定任意远程 URL。公开生成会触发模型计算。

## 请求与匹配规则

识别接口使用 multipart/form-data：

| 字段 | 要求 |
| --- | --- |
| image | 现场 JPEG/PNG/WebP，最大 4 MiB |
| latitude / longitude | WGS84，纬度 -90～90、经度 -180～180 |
| accuracy | GPS 精度估计，0～100 米 |
| gps_timestamp | 定位采样的 Unix 毫秒时间，过去 30 秒内 |
| coordinate_system | 固定 wgs84 |

GPS 候选半径为 `min(200, max(75, 2 × accuracy))` 米；最多接受 200 个候选。没有候选时不调用模型。服务端只接受已就绪且版本一致的参考特征；存在未就绪竞争点、图像版本变化、分数不足或前两名分差不足时不返回投放。

成功响应为 `{ data: { matched: true, reason: "matched", anchor, assets, gps_radius_meters, embedding_version, diagnostics, request_id } }`。未命中仍为 HTTP 200，`matched=false`、`anchor=null`、`assets=[]`。常见 reason：

| reason | 含义 |
| --- | --- |
| no_nearby_anchor | 范围内没有匹配点 |
| reference_not_ready | 参考特征未完成 |
| model_version_mismatch | 参考特征与当前模型版本不同 |
| below_threshold | 相似度未达到阈值 |
| ambiguous | 候选之间分差不足 |
| reference_changed | 推理期间参考图或候选信息改变 |

匹配响应不计算相对 anchor 的空间姿态。关联内容的地理位置和展示配置来自投放；同一素材在不同合集的投放不会共用地图实例 ID。

## 限流与错误

每个合集内按设备限流 90 次/分钟（合法 `X-Client-Id`，否则按 IP），进程内计数；每合集共享上限为 3000 次/分钟，由数据库计数。客户端限流先于上传读取，被拒请求不占合集额度。

429 响应带 `code`、`retry_after_ms` 和 `Retry-After`。代码包括 client_rate_limited、workspace_rate_limited、model_busy、model_queue_full、model_queue_timeout；客户端按响应统一退避，不对每个并发请求独立发起重试。

其他错误包括参数/格式错误、请求过大、候选过多、模型或数据库不可用。错误结构包含 error、request_id 和耗时诊断；精确状态以 [识别路由](../app/api/miniapp/anchors/recognize/route.ts) 为准。

可传 `X-Recognition-Request-Id` 关联客户端与服务端日志；格式为 1～64 位字母数字及 `._-`，首位必须为字母或数字。服务端回显响应头及 request_id。

## 模型配置

服务端需要 `DATABASE_URL`、`NEXT_PUBLIC_MEDIA_BASE_URL`、`SAGE_EAS_ENDPOINT`、`SAGE_EAS_TOKEN`、`SAGE_MATCH_THRESHOLD`；可选 `SAGE_MATCH_MARGIN` 默认为 0.03。阈值需用现场正负样本校准，代码没有通用相似度默认值。

模型提供 POST /embed，返回 8448 维向量和 embedding_version。Token 通过 Authorization 原值发送，不加 Bearer。生产通过 SAGE 网关调度 GPU，实际地址与按需启动策略见部署文档；凭据仅在服务端配置。

每次请求先读取参考特征元数据，再复用进程内匹配版本的归一化向量缓存。特征更新会使旧缓存失效，不能将缓存命中当成参考图永远不变。

## 诊断与管理端提示

`data.diagnostics` 包含候选数、就绪特征数、阈值、最高/次高分、分差、最高分候选距离、参考缓存命中/未命中数及 timings_ms。摘要不暴露候选身份、图片 URL、原始坐标或向量。

timings_ms 区分请求解析、限流、GPS 查询、参考读取、模型请求、排序、候选复查和内容读取；模型可提供自己的排队/推理耗时。model_request_ms 包含网络往返，api_total_ms 不包含进入路由前的平台排队。原参考图自匹配约 1.0 只能证明链路，不能代替现场准确率验证。

管理端显示缺图、未配置、待生成、生成中、就绪或失败等状态；换图未保存时单独提示。查询失败显示“无法确认”，不直接断言生成失败。轮询、超时及旧请求取消由 `scripts/test-matching-status.mjs` 覆盖。

## 验证

`node --test scripts/test-anchor-matching.cjs` 使用数据库/模型替身检查参数、公开边界和匹配流程；它不验证真实 PostGIS、GPU 性能或现场精度。联调还需检查目标数据库迁移、服务端配置、参考特征生成、现场正负照片，以及小程序命中后的投放展示。

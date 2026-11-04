## iframe Messaging Protocol

Follow this structure when sending messages between iframes by postmessage:

{
type: "SET_ASSETS", // 必须：事件类型
payload: { ... }, // 必须：数据主体
source: "manage", // 必须：来源标识——React 侧发 "manage"，viewer iframe 回传 "viewer"；双方都按 source 过滤消息
version: 1 // 可选：协议版本
}

Message types in use: parent → viewer `SET_ORIGIN` / `SET_ASSETS` / `FOCUS_ASSET` / `SET_SELECTION` / `CLEAR_SELECTION`; viewer → parent `LOCATION_CLICKED` / `ASSET_CLICKED` / `ASSETS_MOVED` / `ASSETS_SELECTED` (see `app/manage/hooks/usePlacementViewer.ts` and `public/js/viewer/src/managers/messageHandler.js`).

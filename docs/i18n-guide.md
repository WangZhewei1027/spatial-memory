# 国际化

应用支持 zh 和 en，默认 zh、fallback en。翻译文本只保存在 `locales/zh.json` 与 `locales/en.json`；`lib/i18n/config.ts` 加载它们，`lib/i18n/settings.ts` 定义语言及 cookie 名。

## 组件用法

```tsx
"use client";

import { useTranslation } from "react-i18next";

export function SaveButton() {
  const { t } = useTranslation();
  return <button>{t("common.save")}</button>;
}
```

新增文案前先搜索现有键；新键必须同时写入中英文 JSON。按业务功能选择命名空间，具体名称以文件为准。动态生成的键也需覆盖全部取值，不能只靠静态搜索结果删除翻译。

带文案的 UI 需要在 zh/en 下检查长度、换行、截断与可访问名称；排版和 token 规则见 [设计系统](design-system.md)。

## 语言切换与首帧

`components/language-switcher.tsx` 使用 `components/i18n-provider.tsx` 的 `applyLanguage()` 切换语言，同时更新 cookie、localStorage 与 document.documentElement.lang。

服务端布局读取 cookie，向 I18nProvider 传入语言；Provider 在首帧渲染前同步 i18next。根 html 的 lang 静态默认 zh，挂载后校正。仅有旧 localStorage 偏好而没有 cookie 时，客户端会迁移保存。

使用指南共用 `/instructions` 入口，由全站语言设置决定正文语言；旧的中英文地址会转至该入口，章节链接继续有效。

语言切换影响翻译展示，不改变路由、团队选择或资源归属。

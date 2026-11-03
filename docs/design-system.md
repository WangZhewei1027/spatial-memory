# UI 规范体系与实践

本项目的 UI 规范采用分层模型：**Token（词汇）→ 组件（语法）→ 强制（lint/review）**。设计决策的唯一事实源在代码仓库内，规范文档与对应源码保持一致。

## 一、体系分层

### 1. Token 层 —— 什么值存在

| Token | 定义位置 | 说明 |
|---|---|---|
| 颜色 | `app/globals.css`（CSS 变量，明/暗两套） | 语义命名：`background/foreground/primary/secondary/muted/accent/destructive/border` 等，经 `tailwind.config.ts` 映射为 `bg-primary`、`text-muted-foreground` 等类 |
| 字体栈 | `tailwind.config.ts` → `fontFamily.sans` | Geist（拉丁，next/font 加载）→ PingFang SC → Hiragino Sans GB → Microsoft YaHei → Noto Sans SC → 系统兜底。**中文不加载 webfont**，全站唯一字体定义点，任何地方不再单独写 font-family |
| 字号刻度 | `tailwind.config.ts` → `fontSize`（词汇表）+ `components/ui/typography.tsx` 的 `VARIANT_CLASSES`（组合） | 六级：30/24/18/16/14/12px + 营销专用 `display`(36px)/`display-lg`(48px)，全部 rem。**theme 已收窄：刻度外的类（text-xl/4xl…）不存在，写了不生效** |
| 圆角 | `globals.css` 的 `--radius` | 经 config 映射为 `rounded-sm/md/lg` |
| 导航浮岛 | `globals.css` 的 `--navigation-*` 与 `--app-navbar-height` | 全站导航共用圆角、阴影、间距和高度约定 |

核心规则：**只用语义 token，不写死值**。禁止 hex 色、禁止 `text-[..px]` 任意值、禁止绕过语义色直接用 `text-red-600` 这类调色板类（分类标识色的例外见下文）。

### 2. 组件层 —— 合法的组合

- **基础组件**：`components/ui/`（shadcn/Radix），自带刻度内的字号字重，使用时不手写文字样式。禁止直接 import `@radix-ui/*` 原始包。
- **文字组件**：`components/ui/typography.tsx` 的 `<Text>`，Polaris 风格 API（详见下文）。

### 3. 强制层 —— 现状与缺口

- `npm run check` 执行类型检查、lint、离线回归与 build；本地提交和 CI 的接入见 [贡献指南](../CONTRIBUTING.md)。
- **lint error**：`app/`、`components/`、`lib/` 通过 `components/ui/` 使用 Radix；直接导入 `@radix-ui/*` 或 `radix-ui`（含重导出、require 和字面量动态导入）会阻止检查通过。
- **零警告门槛**：任意值字号 `text-[..px]`、刻度外字号（text-xl/4xl/5xl…）及 Text 的 className 携带文字类由 ESLint 检查。`npm run lint` 使用 `--max-warnings 0`，warning 同样阻止提交和 CI。
- **图片预览例外**：固定尺寸缩略图使用 `next/image`；用户素材可能来自外站或本地 Blob，使用 `unoptimized` 保留直接加载。匹配参考图需要未知尺寸下的自然高度和本地 Blob 预览，保留原生 `img`，在组件内注明该单行 lint 豁免；不得把该例外扩展成全局禁用。

## 二、文字体系（全站最重要的一章）

### 字体栈

拉丁字形走 Geist，中文走系统字体链（见上表）。字体回退是逐字符的，中西混排自动各归其位，zh/en 共用同一个栈。若未来需要品牌中文字体，必须走子集化 + 按需加载，并先修订本节。

### 六级刻度

| variant | 字号 | 用途 |
|---|---|---|
| `headingXl` | 30px / 1.875rem | 页面主标题，每页仅一个 |
| `headingLg` | 24px / 1.5rem | 区块标题 |
| `headingMd` | 18px / 1.125rem | 小节 / 卡片标题 |
| `bodyMd` | 16px / 1rem | 正文，**最小正文字号** |
| `bodySm` | 14px / 0.875rem | 辅助信息，不用于成段正文 |
| `bodyXs` | 12px / 0.75rem | 组件级微文本（badge/时间戳/表格备注），禁止承载完整句子 |

排版规则：标题不加负 letter-spacing（CJK 方块字不收紧字距），标题行高 `leading-snug`，正文 `leading-7`；长文行长由容器限制约 65ch（≈32 汉字），组件本身不限宽。

**Display 档**：`text-display`(36px) / `text-display-lg`(48px) 仅限营销页（首页、hero）的展示性大字，utility 直写、不进入 Text variant；console 路由（/manage、/admin、/super-admin 等）禁用。

### Text 组件 API

```tsx
<Text as="h2" variant="headingLg">区块标题</Text>
<Text as="p" variant="bodyMd" tone="subdued">辅助说明</Text>
<Text as="span" variant="bodySm" truncate className="max-w-64">…</Text>
```

- `as` 必填，语义标签与外观（variant）解耦，h1→h2→h3 不跳级。
- `tone`：`default / subdued / critical / success / warning`，对应语义色 token；不直接写 `text-muted-foreground`。**缺省时继承父级颜色**（可安全用于 primary 按钮、彩色横幅等有色表面），需要明确前景色时显式传 `tone="default"`。
- `fontWeight / alignment / truncate / breakWord` 按需。
- **`className` 只准放布局类**（margin/width/display）；字号、字重、行高、颜色、字距一律走 props。`cn` 走 twMerge，className 能静默覆盖 variant——这是逃生舱不是后门，review 重点盯这条。
- 表单标签用 `components/ui/label.tsx`，链接用 `next/link`，不走 Text。

### 三区边界 —— 哪些文字归谁管

1. **文档流内容**（页面/区块标题、成段正文、长说明）→ 必须用 `<Text>`。判断标准：像"文章的一部分"就用。
2. **组件内嵌文字**（按钮、badge、输入框、菜单项、表格内容）→ 用 ui 组件自带样式，不手写字号、不包 Text。
3. **零散 UI 辅助文字**（字段标签、时间戳、计数）→ 允许直接写 utility，但只准刻度内字号 + 语义色 token。

长文例外：`app/instructions/` 的 MDX 用 `@tailwindcss/typography` 的 `prose` 类排版，不与应用 UI 混用。shadcn 官方文档站的 typography 样式（`text-4xl font-extrabold` 等）**不作为本项目依据**。

## 三、颜色使用规则

- 只用语义 token；`destructive` 只用于不可逆的危险操作且必须配二次确认；同一视图只有一个 `primary` 主操作按钮，其余 `secondary/outline/ghost`。
- `muted-foreground` 白底对比度约 4.7:1，是辅助文字的对比度下限，不得再调浅。
- 状态色：`success`（成功/已完成）、`warning`（警示/需注意）、`destructive`（错误/不可逆），各含 `-foreground` 配对，明暗双套，文字对比度白底 ≥4.5:1。柔和底色用透明度修饰（`bg-success/10`、`border-warning/30`），禁止再写 `text-green-600` 式调色板类。
- **分类标识色豁免**：成员角色徽章（purple/blue/gray/green）、资产类型色（音频 purple、锚点 amber）、清理工具的分类区（orange/blue）、owner 皇冠（yellow/amber）——这些是身份/类别色不是状态色，暂允许调色板类（需带 dark: 变体），未来如引入 categorical token 集再收编。

## 四、i18n 相关的 UI 规则

- 默认 `zh`、fallback `en`；en 文本普遍比 zh 长 50–200%，因此：文本容器不定死宽高；截断必须显式（`truncate` + tooltip），禁止静默溢出；带文案的 UI 须 zh/en 各过一遍再算完成。
- 全部字号 rem，跟随浏览器字号设置缩放。
- 已知限制：`html lang` 首帧恒为 zh，客户端 hydration 后由 i18n-provider 修正（cacheComponents 下 cookie 读取位置的取舍）。

## 五、协作实践

- **人**：新人先阅读本文档和现有组件；设计决策变更由实现与规则在同一 PR 中修订。
- **AI**：AGENTS.md 指向本文档与组件源码；AI 写 UI 前应遵守三区边界与 token 规则，新增例外须先修订规则，不允许静默绕过。
- **验证**：改动共享层（token、ui 组件、Text）属于高杠杆操作——合规不等于视觉无损，改完至少人工检查受影响的应用页面与明暗主题。

## 全站导航浮岛

公共页、认证页、团队工作台和管理后台的顶栏，以及地图和场景编辑器的项目栏，都使用 `NavigationIsland` 的实色表面、12px 圆角和轻阴影，不叠加外边框或玻璃模糊。`navigation-row` 的最小内容高度为 48px，桌面外围间距 12px，低于 640px 为 8px；内容可因保存状态或提示自然增高。页面标题和普通工具条不自动套用浮岛。

普通页面的顶栏在文档流内，高度由 `--app-navbar-height` 推导；页面剩余高度不得写死 56px。地图和场景编辑器隐藏全站顶栏，由自己的导航占位后让工作区填满剩余视口。场景的二维码 portal 仍挂在项目栏容器，错误、冲突与只读提示保留在其中。

`ConsoleNavigation` 为团队、管理后台和超级管理后台提供同一侧栏：桌面宽 224px，独立浮岛、44px 导航项；手机在内容上方显示入口并打开带标题的 Sheet。链接仍由各业务层提供，保留权限过滤、团队参数和当前页标记。长团队名与面包屑可截断并提供完整标题，账户和语言操作不被挤出。

## 第三方场景编排界面

Three.js Editor 的嵌入视口、相机操作、坐标轴与变换工具栏属于第三方边界；保留上游交互，外层限定布局与资源路径。应用直接在同一 DOM 中呈现项目栏、素材库、所选对象检视器和多媒体时间轴，遵守本设计系统及 zh/en 规范。属性、关键帧和撤销由应用管理，按钮不重复实现原生视口的变换工具。

2026-10-22 起，场景工作台固定使用 Light 主题。`app/globals.css` 的 `:root` 与 `.scene-workspace-theme` 共用全站浅色语义 token；`scene-workspace-theme.css` 设置 `color-scheme: light`、6px 圆角，并局部覆盖 `muted-foreground: hsl(0 0% 42%)` 与 `destructive: hsl(0 62.8% 30.6%)`：辅助文字在选中浅灰背景上满足 AA 对比度，错误文字在浅底上保持可读。项目栏、素材库、检视器、时间轴和浮层共用此主题；后台其他页面的主题偏好保持独立。Three 视口通过 `viewport/theme: light` 保留上游浅色背景，工具图标保留原色；应用提供统一的 1 米网格、带米制刻度的原点轴及虚拟摄像机辅助器，轴色沿用 Three 的方向约定。时间轴播放头使用深色 `primary`，结束区域使用 `muted-foreground` 的浅灰透明遮罩。

浮层通过 PopoverContent 的 `portalContainer` 挂到触发器所在的工作台容器，并继承 Light 主题；适用场景的二维码在视口点击、Escape 和卸载时关闭并清理监听。2026-10-29 起，场景工作台采用局部浮岛布局：项目栏在上，素材库独立占满左列高度；舞台和时间轴纵向排列在右列，时间轴只占右下区域。原生工具在舞台顶部，所选对象检视器浮在舞台右侧。项目栏使用全站导航浮岛规则；其他工作面使用实色背景、10px 圆角与轻阴影，工具岛为 8px，控件继续使用现有 6px 圆角与语义 token。窄屏默认收起素材库，整高素材库与舞台检视器交替显示，时间轴保留独立滚动。模型、图片、音频、视频及场景文字共用轨道与出入场编辑；文字与当前场景保存，独立于团队素材库。页面行为与网页/小程序预览边界见 `app/manage/scenes/DESIGN.md`。

场景编辑器的精简规则：同一操作只保留当前布局需要的入口，说明文字优先移入工具提示；不移除保存状态、错误恢复或可访问名称。素材类型决定关键帧参数：可见对象显示不透明度，音视频显示音量，音频不提供无实际视觉效果的旋转/缩放/不透明度控制。参数值与菱形关键帧按钮在同一行，空间音频配置按启用状态逐步展开。相机预览沿用主时间轴播放，不另设重复播放工具栏。

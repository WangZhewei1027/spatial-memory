import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import engineering from "./scripts/eslint/engineering.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "packages/*/node_modules/**",
      "packages/*/dist/**",
      "vendor/three-editor/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // 设计规范检查（详见 docs/design-system.md）；npm run lint 使用零警告门槛。
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Literal[value=/text-\\[[0-9.]+(px|rem)\\]/]",
          message:
            "禁止任意值字号（text-[..px]）。用刻度内字号：text-xs/sm/base/lg/2xl/3xl（见 docs/design-system.md）。",
        },
        {
          selector: "Literal[value=/\\btext-(xl|4xl|5xl|6xl|7xl|8xl|9xl)\\b/]",
          message:
            "刻度外字号（该类已从 theme 移除，写了不生效）。六级刻度：text-xs/sm/base/lg/2xl/3xl；营销页展示字号用 text-display / text-display-lg。见 docs/design-system.md。",
        },
        {
          selector:
            'JSXOpeningElement[name.name="Text"] > JSXAttribute[name.name="className"] Literal[value=/(\\btext-(xs|sm|base|lg|2xl|3xl|display|display-lg)\\b|\\bfont-(thin|light|normal|medium|semibold|bold|black)\\b|\\bleading-|\\btracking-|\\btext-(foreground|muted-foreground|destructive|success|warning)\\b)/]',
          message:
            "Text 的 className 只放布局类；字号/字重/行高/颜色/字距走 variant/tone/fontWeight props（见 docs/design-system.md）。",
        },
      ],
    },
  },
  // Existing architecture boundary: primitives belong in components/ui/.
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "components/**/*.{js,jsx,ts,tsx}", "lib/**/*.{js,jsx,ts,tsx}"],
    ignores: ["components/ui/**"],
    plugins: { engineering },
    rules: {
      "engineering/no-dynamic-radix": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@radix-ui/*", "radix-ui", "radix-ui/*"],
              message:
                "不要直接 import Radix 原始包，使用 components/ui/ 里的封装组件。",
            },
          ],
        },
      ],
      "no-restricted-modules": ["error", {
        patterns: ["@radix-ui/*", "radix-ui", "radix-ui/*"],
      }],
    },
  },
  {
    files: ["lib/**/*.server.ts", "lib/db/index.ts", "lib/auth/server.ts", "lib/storage/oss.ts", "lib/email.ts"],
    plugins: { engineering },
    rules: { "engineering/require-server-only": "error" },
  },
  {
    files: ["packages/scene-core/**/*.js"],
    rules: {
      // The shared package ships a single CommonJS runtime to Web and WeChat.
      "no-restricted-syntax": ["error",
        { selector: "ImportDeclaration, ImportExpression, ExportNamedDeclaration[source], ExportAllDeclaration", message: "Scene Core 保持无依赖的单文件运行时；宿主负责资源加载和渲染。" },
      ],
      "no-restricted-globals": ["error",
        "require", "window", "document", "globalThis", "global", "process", "Buffer", "wx",
        "fetch", "XMLHttpRequest", "WebSocket", "Worker",
        "setTimeout", "setInterval", "setImmediate", "requestAnimationFrame",
      ],
      "no-eval": "error",
      "no-new-func": "error",
    },
  },
];

export default eslintConfig;

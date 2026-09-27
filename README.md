# dsh-pet-desktop

把 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（DeepSeek Harness 桌宠插件）的桌面模式解绑 DSH 宿主，改造成**独立的 Windows 桌面宠物应用**。

## 状态

- 设计规格：[docs/superpowers/specs/2026-09-24-dsh-pet-desktop-design.md](docs/superpowers/specs/2026-09-24-dsh-pet-desktop-design.md)
- 实施计划：[docs/superpowers/plans/2026-09-24-dsh-pet-standalone-desktop.md](docs/superpowers/plans/2026-09-24-dsh-pet-standalone-desktop.md)
- 基座代码：`dsh-pet/`（上游 v0.2.12 zip 快照，改造遵循"上游文件能不改就不改"原则，开发在 `standalone-desktop` 分支）
- 上游同步：本仓库含 `upstream` remote 指向 PC2005-cloud/dsh-pet；同步 = `git fetch upstream` + merge upstream/main 后重放全部本地补丁，补丁台账：main.js（独立接线）、sprite.js（noLlm 菜单门）、helper-process.test.ts（electron 解析优先级断言）、eslint.config.js 与 .prettierignore（runtime CJS 豁免）、package.json + scripts/prepare.js（构建串接）、src/host/standalone-patch.test.ts（守卫=补丁台账，merge 后它红就是补丁丢了）

## 快速开始（开发）

```bash
cd dsh-pet/dsh-pet
npm install              # 自动构建（prepare：lib + shared-core + standalone-core）
npm run ensure:electron  # 首次下载 Electron（走 npmmirror）
npm run start:standalone # 启动独立桌宠（系统托盘图标 = 显示/隐藏/退出）
```

## 打包 exe

```bash
npm run dist:desktop     # 产物在 dsh-pet/dsh-pet/dist-desktop/（portable + NSIS 安装器）
```

## 已知事项

- 便携版（portable 单文件 exe）存在窗口隐形问题（内容不渲染），安装版与解压版不受影响；预编译产物见 GitHub Releases
- 未签名 exe：Windows SmartScreen 首次运行会弹「已保护你的电脑」提示，点「更多信息 → 仍要运行」
- 桌宠数据目录：`~/.dsh/dsh-pet/`（main-config.json 配置、main-animation/webm 覆盖素材、pet/ 新种类），与上游文档完全一致——上游 README 的素材管线（prompts/ + scripts/ 生成自家角色）在独立版原样可用
- 第一阶段限制：无对话/碎碎念/余额（无 LLM/凭据，右键入口已隐藏；事件动画可在右键「动作」子树手动点播预览）；开机自启未做
- 开发注意：`dist-desktop/`、`temp/`、`electron-builder-cache/` 已 gitignore；`ELECTRON_BUILDER_CACHE` 必须在 ESM 包目录之外（见 electron-builder.yml 注释）
- 完整独立验收需同时跑 `npm test`（main.js 源码守卫等在其中）与 `npm run test:standalone`（standalone-core 构建 + mini-host 单测 + Electron 运行时净网），缺一不可

## 许可与署名

- 上游代码 MIT；**动画素材/提示词/源视频禁止商用**
- 依上游二创约定：本项目任何介绍、展示、分发处须注明原作者 <https://github.com/PC2005-cloud/dsh-pet>

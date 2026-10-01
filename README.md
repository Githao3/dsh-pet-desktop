# dsh-pet-desktop

把 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（DeepSeek Harness 桌宠插件）的桌面模式解绑 DSH 宿主，改造成**独立的 Windows 桌面宠物应用**。

## 状态

- 预编译成品（安装版 / 解压版 / 便携版）见 GitHub Releases（v0.2.13-desktop 起）
- 基座代码：`dsh-pet/`（上游 v0.2.12 zip 快照，改造遵循"上游文件能不改就不改"原则，已在 `master`）
- 上游同步：本仓库含 `upstream` remote 指向 PC2005-cloud/dsh-pet；同步 = `git fetch upstream` + merge upstream/main 后重放全部本地补丁，补丁台账：main.js（独立接线）、sprite.js（noLlm 菜单门 + 素材加载失败可见性报错条）、helper-process.test.ts（electron 解析优先级断言）、eslint.config.js 与 .prettierignore（runtime CJS 豁免）、package.json + scripts/prepare.js（构建串接）、electron-builder.yml（关 `preCompressedFileExtensions`，修便携版漏素材）、assets/config.jsonc（写福字移入 noMirror 文字分类，避免福字镜像成反字）、sprite.js + src/client/pet.ts（修上游移动方向双重翻转：dir 只看 facing，不再亦或上个动画是否转向）、scripts/check-desktop-artifact.js（产物体检门禁）、漫游开关全套：types.ts/config.ts/settings.ts/config.jsonc（moveEnabled 字段）+ standalone-entry.ts（setUserPetField 只改不增写盘）+ mini-host.js（暴露 userFile）+ main.js（pet:save-field 写盘 IPC）+ preload.js（savePetField 桥）+ sprite.js（moveOn 门控与菜单开关项）、src/host/standalone-patch.test.ts（守卫=补丁台账，merge 后它红就是补丁丢了）

## 快速开始（开发）

```bash
cd dsh-pet                 # 插件项目（仓库根即上游仓库布局，与上游目录一致）
npm install              # 自动构建（prepare：lib + shared-core + standalone-core）
npm run ensure:electron  # 首次下载 Electron（走 npmmirror）
npm run start:standalone # 启动独立桌宠（系统托盘图标 = 显示/隐藏/退出）
```

## 打包 exe

```bash
npm run dist:desktop     # 产物在 dsh-pet/dist-desktop/（portable + NSIS 安装器），末尾自动跑产物体检门禁
```

## 自定义与素材

### 用户数据目录 `~/.dsh/dsh-pet/`

所有用户级定制都在这里，**改文件即生效**（重启桌宠后），与包内默认配置同构：

```
~/.dsh/dsh-pet/
├─ main-config.json             # 主宠物配置（大小/位置/多开/动画池…）
├─ main-animation/webm/*.webm   # 主宠物素材覆盖（同名优先于包内）
├─ standalone-settings.json     # 独立版 LLM 插槽（第二阶段用，当前 enabled:false）
└─ pet/                         # 额外宠物种类（pet pack，见下）
```

`main-config.json` 可写的字段（没写的字段回落包内默认 `dsh-pet/assets/config.jsonc`；写了就**整体替换**该字段）：

| 字段 | 作用 |
|------|------|
| `pets` | 宠物列表：每只 `id` / `size`（宽 px，高=宽×9/16）/ `position`（`corner` 四角之一 + `marginX/marginY` 边距）/ `display`（独立版固定用 `desktop`）/ `moveEnabled`（漫游开关，默认开；也可右键菜单「漫游：开/关」一键翻转，自动写回本字段）。多开＝数组里加多项 |
| `animations` | 动画池：idle / turn / drag / clicks / moves / categories / events，照 config.jsonc 结构写 |
| `animationWeights` | 动画链播放权重（默认 idle 10 / turn 5 / move 5），播完按权重选下一个，首尾相接无缝切换 |

格式写错的字段会回落默认值；物理与挤压曲线在 `dsh-pet/src/shared/physics.ts`（拖拽阻尼弹簧跟手、甩抛抛物线、屏幕边缘反弹、落地摩擦）。

### 自定义动画（不换角色，只换/加动作）

往 `~/.dsh/dsh-pet/main-animation/webm/` 放 **VP9-Alpha 的 `.webm`**，文件名与动作名一致（中文即动作名，如 `吃火锅.webm`）即覆盖该动作。新增动作还需在 `main-config.json` 的 `animations` 池里登记名字（否则随机链和右键菜单都不认识它）；注意覆盖语义是整字段替换——登记时要照着包内 `config.jsonc` 的完整 `animations` 结构改，不能只写新增那一条。

### pet pack：添加全新「种类」

在 `~/.dsh/dsh-pet/pet/` 下建**同名配对**的两个条目即新增一个独立宠物种类（独立动画池＋自己的素材，多实例共享）：

```
pet/
├─ pig-config.json        # 与 main-config.json 同构的完整配置（animations/animationWeights 必须写全，不回退全局）
└─ pig-animation/*.webm   # 该种类的动画素材（直接平铺）
```

规则：素材只查自己的目录（绝不落到 main 或包内）；实例 id 不得与主宠物冲突；配置非法会在加载时显式报错并跳过该种类（不影响其它宠物）。

### 从零生成你自己的宠物（完整素材管线）

任何 clone 本仓库的人都可以从零生成自家桌宠，全流程可复现（管线工具与提示词配方属上游资产，此处摘要，原文详见[上游仓库](https://github.com/PC2005-cloud/dsh-pet)）：

**① 提示词 → 源视频**：按 `prompts/桌面宠物 10 秒动作提示词.md` 的配方，用 AI 视频工具（可灵 / Runway / 豆包等，上游素材即豆包生成）一个动作生成一段 10 秒视频。规范：16:9、背景纯绿幕 `#00FF00`、人物位置大小固定（头顶 ~20% 高度、脚底 ~85%）、动作全程在画幅内、**首尾帧为标准正面站立**（保证无缝循环）。产物各存一个 mp4 放入 `video/`。上游全部源视频可在其 GitHub Release 下载 `assets-videos.zip` 解压放回 `video/`（mp4 不入 git）。

**② 源视频 → 透明动画**（`scripts/` 下的 Python 链，依赖 Python 3 + ffmpeg + numpy + scipy）：

```bash
cd scripts
python watermark_step01.py   # 水印遮罩填充 → step01/
python chroma_step02.py      # 路线 A（默认）：HSV 自动绿幕抠像 → step02/
# 路线 B（上游全部动作实际采用，含第三方物品/透明边缘复杂的更精细）：
#   在 PR 里手工抠像导出带 alpha 的 .mov（如 ProRes 4444），文件名=动作名放入 pr/
python pr_import_step02.py   # pr/*.mov → step02/（覆盖该动作自动抠像结果）
python normalize_step03.py   # 归一化 2160×1215 统一站立居中 → step03/
python encode_thumbs.py      # 转码 640×360 播放变体 → step04/
```

中间产物 step01~04/ 不入库可再生。

**③ 动画 → 桌宠**：把 `step04/*.webm` 拷进 `~/.dsh/dsh-pet/main-animation/webm/`（用户级覆盖，改完即用）或 `dsh-pet/assets/webm/`（替换包内素材，需重新 `npm run dist:desktop` 打包）。

## 项目结构

```
├─ prompts/            # ① 动画生成提示词配方（绿幕规范 + 按秒分解）
├─ video/              # ② 素材源视频（绿幕 mp4；不入仓库，Releases 提供压缩包）
├─ scripts/            # ② 素材生成链（Python/ffmpeg：水印→抠像→归一化→转码）
├─ tools/              # 开发小工具（素材链各阶段预览等）
├─ .github/workflows/  # CI：Safari/HEVC 转码流水线（macOS runner，手动触发，独立版用不到）
└─ dsh-pet/            # ③ 桌宠项目（插件 + 我们的独立化改造）
   ├─ src/             #   TS 源码：host（配置/路由）、client（动画链）、shared（双端纯逻辑/物理）
   │                   #   standalone-entry.ts / standalone-patch.test.ts = 我们的独立化入口与守卫
   ├─ runtime/         #   Electron 桌面壳（main.js 独立接线、mini-host.js 迷你宿主、sprite.js 渲染）
   ├─ assets/          #   webm 动画 / 字体 / 图标 / config.jsonc 默认配置
   ├─ scripts/         #   构建脚本（prepare / build-standalone-core / start-standalone 等）
   └─ electron-builder.yml  # 独立版打包配置
```

## 已知事项

- 便携版历史坑（已解决）：0.2.12 便携版因 electron-builder 26.15.3 的 `preCompressedFileExtensions` 分流机制丢失全部 106 个 webm 素材（窗口隐形无画面），已从 Releases 撤下。修复随 0.2.13 发布：`electron-builder.yml` 关分流 + `scripts/check-desktop-artifact.js` 构建后产物门禁（漏素材直接非零退出）+ sprite.js 素材加载失败时点亮错误提示条
- 未签名 exe：Windows SmartScreen 首次运行会弹「已保护你的电脑」提示，点「更多信息 → 仍要运行」
- 第一阶段限制：无对话/碎碎念/余额（无 LLM/凭据，右键入口已隐藏；事件动画可在右键「动作」子树手动点播预览）；开机自启未做
- 开发注意：`dist-desktop/`、`temp/`、`electron-builder-cache/` 已 gitignore；`ELECTRON_BUILDER_CACHE` 必须在 ESM 包目录之外（见 electron-builder.yml 注释）
- 完整独立验收需同时跑 `npm test`（main.js 源码守卫等在其中）与 `npm run test:standalone`（standalone-core 构建 + mini-host 单测 + Electron 运行时净网），缺一不可

## 许可与署名

- 上游代码 MIT；**动画素材/提示词/源视频禁止商用**
- 依上游二创约定：本项目任何介绍、展示、分发处须注明原作者 <https://github.com/PC2005-cloud/dsh-pet>

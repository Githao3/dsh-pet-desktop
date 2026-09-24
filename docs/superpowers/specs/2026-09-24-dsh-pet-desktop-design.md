# dsh-pet 独立桌宠应用 — 设计文档

- 日期：2026-09-24
- 状态：已获用户批准（对话确认）
- 基座项目：[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（本地副本 `dsh-pet/`，MIT 代码 + 素材禁商用 + 二创须署名）

## 1. 背景与目标

用户（零基础、AI 辅助开发）想要一只 Windows 桌面宠物：动漫风格、多帧/视频式动画、后续接入 LLM 实现对话与 agent 状态可视化。已选定现成项目 dsh-pet 为基座——它自带 106 段透明动画、透明置顶窗（Electron）、拖拽甩抛物理、动作链、pet pack 自定义素材管线，但其桌面模式依赖 DSH（DeepSeek Harness）HTTP 宿主。

**本项目目标：把桌面模式从 DSH 解绑，变成独立可双击运行的 Windows 桌面应用；行为与上游桌面模式严格一致；为后续 LLM 接入预留插槽。**

### 非目标（本期不做）

- 不重构为纯 Electron 应用（保留插件工程结构，便于跟随上游）
- 不接 LLM（第二阶段做，本期只留接口与配置位）
- 不产出用户自己的角色素材（素材管线上游文档已完备，后续按需使用）
- 不支持 macOS/Safari 特化路径（.mov 素材链忽略）

## 2. 总体架构

```
改造前：electron-helper（Electron 透明窗） ──HTTP──▶ DSH web 服务的 /dsh-pet-7340/*（宿主）
改造后：electron-helper ──HTTP──▶ 同进程内嵌"迷你宿主"（本地 127.0.0.1 随机端口）
```

核心决策：**渲染端（sprite.js / renderer.js / events.js / shared-core）零改动**（唯一例外为 §2.2 明示的一处 noLlm 菜单补丁）。渲染端本就支持"非 bridge 直连 HTTP"模式（`DSH_PET_BRIDGE` 未设时按 configUrl 直连），迷你宿主利用这一点：

- Electron 主进程 `app.whenReady` 后启动 Node `http` 服务，监听 `127.0.0.1:0`（随机端口）
- 路由前缀保持 `/dsh-pet-7340/`，实现直接复用插件编译产物 `lib/` 中的 `handlePetRoute` / `readAllConfig`
- configUrl 指向自己：`http://127.0.0.1:<port>/dsh-pet-7340/config`，然后按现有逻辑为每只 `display` 含 desktop 的宠物开窗
- 不注入 `DSH_PET_HOST_PID`（宿主存活检测自然关闭：PID 未注入 → 不探测、不误退）

### 2.1 对 3 个 `@deepseek-ai/*` 依赖的处理

| 包 | 用途 | 处理 |
|----|------|------|
| `dsh-home-paths` | 解析 `$DSH_HOME` | 垫片：返回 `~/.dsh`（与 DSH 用户完全同路径，pet pack / main-config 文档全部照用） |
| `dsh-credentials` | 取 API key | 垫片：第一阶段一律返回"无凭据"；第二、三阶段读应用本地设置文件 |
| `dsh-llm` | 碎碎念/对话调模型 | 第一阶段不引入：菜单入口被 `noLlm` 补丁隐藏（见 2.2/3.2），即便端点被触达也返回 501、前端静默回落；第二阶段以 OpenAI 兼容 HTTP 客户端实现同名接口 |

**实施风险与后备方案**：若 `lib/host` 的路由代码与 DSH 运行时耦合超出这三个包（如实例化期订阅 DSH 事件总线），则退化为"在迷你宿主内按响应形状重写薄实现"——`/config` 直接调 `src/host/config.ts` 的 `readAllConfig`（该文件零外部依赖，纯 node:fs/path），`/thumb` 为静态文件服务，其余端点返回无害空值。两方案对渲染端表现一致。

### 2.2 新增/修改文件清单

```
dsh-pet/
├── runtime/electron-helper/
│   ├── mini-host.js              # 新增：迷你宿主（HTTP 服务 + 三垫片 + 路由挂载）
│   └── main.js                   # 修改：启动时先起 mini-host，configUrl 指向本机；退出逻辑改为托盘驱动
├── scripts/
│   └── start-standalone.mjs      # 新增：开发流一键启动（复用 start-desktop 的 Electron 探测逻辑）
├── assets/config.jsonc           # 不改动（上游文件保持原样）
└── package.json                  # 修改：加 start:standalone 脚本 + electron-builder devDependency
```

**唯一一处渲染端补丁（明示的本地偏差）**：`runtime/electron-helper/sprite.js` 菜单注入处（约 L1026-1033，「碎碎念/对话」上游是无条件显示的），当窗口 URL 带 `noLlm=1` 查询参数（由 main.js 在独立模式下注入）时跳过这两项。「查看余额」无需补丁——上游本就按 `balanceEnabled` 门控。此补丁在上游更新时可能需手工重放，故控制在最小一处。

原则：**上游文件能不改就不改，功能全部落在新增文件里**（唯一例外即上述 noLlm 补丁），未来 rebase 上游成本最低。

## 3. 功能取舍（第一阶段）

### 3.1 完整保留（91 段随机链动画 + 全部交互）

待机/转向/漫游移动、拖拽甩抛物理与 Q 弹、点击回应、右键菜单动作点播、多开、多屏、积分弹窗、字体/图片端点、pet pack 与 `main-animation/webm` 素材覆盖通道。

### 3.2 关闭/空转（15 段事件动画不触发，文件与配置保留）

| 组 | 数量 | 第一阶段处理 | 后续复活条件 |
|----|------|-------------|-------------|
| 余额动画 | 6 | `pets[0].balanceEnabled` 覆盖为 false，右键"查看余额"自动隐藏 | 设置里配 API key 后开启 |
| 碎碎念动画 | 3 | `whisperEnabled:false`（本就是包默认）；`/whisper` 返回 501；菜单入口隐藏（noLlm 补丁） | 第二阶段接 LLM 自动复活 |
| 工作状态动画 | 6 | 无 DSH 事件源，`/work-status` 恒返回 `{ts:0}` | agent 场景：向迷你宿主 POST 会话状态即可复活 |
| DSH 会话监听 | — | 移除（不是动画，是事件源） | — |
| 系统通知 | — | 保留代码，无事件源故实际不弹 | 随 LLM/agent 接入获得事件源 |

右键菜单差异：「碎碎念」「对话」两项由 noLlm 补丁隐藏，「查看余额」由既有 `balanceEnabled:false` 门控自动隐藏；其余（动作树/打开网站/回到初始位置）全部保留。

**补充（不矛盾的彩蛋）**：「动作」子树里上游会列出「余额档位/碎碎念/工作状态」分类（buildMenuTree 把 events 池也平铺进菜单）——这 15 段动画**仍可右键手动点播预览**，因为点播只是本地播 webm，不需要事件源。"不触发"指的是事件自动触发，素材本身随时可看。

**覆盖方式**：迷你宿主读配置时在用户层注入默认覆盖（等价于往 `~/.dsh/dsh-pet/main-config.json` 写 `balanceEnabled:false`），不改包内 config.jsonc。用户在配置目录手写 `main-config.json` 时以用户文件为准（沿用上游覆盖语义）。

## 4. 生命周期与退出

- 启动：双击 exe（或开发流 `npm run start:standalone`）→ 迷你宿主起 → 读配置 → 为每只 desktop 可见宠物开透明置顶窗
- 退出：新增**系统托盘图标**（右键菜单：显示/隐藏宠物、退出应用）；托盘"退出"→ 关窗、关 HTTP 服务、`app.quit()`
- 崩溃兜底：渲染端加载配置失败沿用上游行为（界面左上角错误提示 + 5s 重试）
- 单实例：`app.requestSingleInstanceLock()`，二次启动聚焦已有实例（防止双击两下出现两套宠物）

## 5. 数据目录与素材管线

- 用户数据：`~/.dsh/dsh-pet/`（main-config.json、main-animation/webm、pet/）——与上游文档逐字一致，用户照 README 放素材即生效，无需为独立版学新格式
- 换角色通道（本期即可用，无需等 LLM）：按上游 `prompts/` 配方用用户自己的生图/生视频模型产绿幕动作视频 → `scripts/` 素材链抠像转码 → 建 `pet/<名>-config.json + pet/<名>-animation/` 即出现全新种类

## 6. 第二阶段预览（LLM 插槽，本期不实现）

- `~/.dsh/dsh-pet/standalone-settings.json`：`{ "llm": { "apiBase", "apiKey", "model", "enabled" } }`，任何 OpenAI 兼容服务（DeepSeek 官方 API / Kimi / 本地 ollama）；LLM 启用后 main.js 不再注入 `noLlm=1`，菜单两项自动回归
- 实现 `dsh-llm` 垫片的真实版本 → 碎碎念、对话、配图表情包全部按上游既有流程复活
- agent 状态可视化：暴露 `POST /dsh-pet-7340/work-status`（本机），任何外部程序（未来用户的 agent 主程序）推送 `{level}` 即驱动 6 段工作状态动画
- 该阶段只动迷你宿主与设置读写，渲染端依旧零改动

## 7. 打包与分发

- **electron-builder**：Windows NSIS 安装包 + portable 单文件 exe 两种产物；素材 webm（约百 MB 级）随包 `extraResources` 打入
- 开发流不打包：改代码 → `npm run prepare` → `npm run start:standalone` 秒级看效果
- 许可合规：自用无限制；若对外发布，须①注明原作者 GitHub 链接（上游二创约定）②替换或移除素材（禁商用条款）③代码维持 MIT 声明

## 8. 测试与验收

1. **冒烟**：全新 clone/解压 → `npm install` → `npm run prepare` → `npm run start:standalone` → 桌面右上出现宠物，无错误角标
2. **行为对照**（并排开上游桌面模式或按 README 预览 GIF 核对）：待机呼吸循环 / 随机动作切换无空白帧 / 点击 Q 弹 / 拖拽甩出抛物线撞边反弹 / 右键菜单动作点播真实行走 / 多开两只互不干扰
3. **生命周期**：托盘退出进程清零；开机自启暂不做（后续可加）；二次启动不产生第二套宠物
4. **配置面**：改 `main-config.json`（size/corner/display）重启生效；`main-animation/webm` 放同名 webm 优先于包内素材
5. **回归**：上游 `npm test`（node:test）全绿，证明垫片未破坏 host 逻辑

## 9. 实施注意事项

- 本地基座代码是上游 zip 解压快照（已改名 `dsh-pet/`并入库本仓库）；后续所有改动以独立 commit 叠加在快照点上，同步上游用 `git remote add upstream` + merge 方案
- `lib/` 为构建产物（`npm run prepare` 产出，含 shared-core.js），迷你宿主 require 编译产物而非 TS 源码
- Electron 首次由 `npm run ensure:electron` 拉取到 `~/.dsh/electron/`；打包路径需改为随应用分发内嵌 Electron
- Windows  Defender/SmartScreen 对未签名 exe 会告警，文档中向用户说明即可（不买证书）

# dsh-pet 独立桌面应用 实施计划

> 状态：Task 1–9 完成（standalone-desktop 分支），Task 10 机器侧完成、人工验收进行中。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 dsh-pet 桌面模式从 DSH 宿主解绑，成为可独立启动、可打包为 exe 的 Windows 桌面宠物应用（第一阶段：不接 LLM）。

**Architecture:** Electron 主进程（`runtime/electron-helper/main.js`）启动时在本地随机端口起一个"迷你宿主"HTTP 服务，按上游 `/dsh-pet-7340/*` 路由契约就地应答配置/素材/空事件；配置合并逻辑复用上游 `src/host/config.ts`（纯 Node、零外部依赖），经 rolldown 打成 CJS 供主进程 require。渲染端唯一改动是一处 `noLlm=1` 菜单补丁。

**Tech Stack:** Node 24 / Electron（ensure-electron 拉取）/ TypeScript（仅复用，不新增源码编译面）/ rolldown（已有 devDep）/ node:test / electron-builder（打包）

**规格文档:** `docs/superpowers/specs/2026-09-24-dsh-pet-desktop-design.md`

**关键事实（已核实）:**
- 上游自带 `scripts/dev/mock-server.mjs`（模拟 /config /thumb /balance /balance/trigger 四端点），配合 `npm run start:desktop -- <configUrl>` 已能无 DSH 启动桌宠——本计划以它为脚手架，产品化为 mini-host
- `src/host/config.ts` 导出 `readAllConfig(paths: ConfigPaths)`、`flattenPetList(merged)`、`ID_FORBIDDEN`，全部纯 Node（只 import node:fs/node:path）；`ConfigPaths = { defaultFile, userFile, petDir }`
- `src/shared/config.ts` 导出 `isDesktopVisible`（`display === 'desktop' || 'both'`）
- 渲染端请求的全部端点：`/config`、`/thumb/<assetRoot>/<name>.webm`、`/font/上首软糖体.ttf`、`/pic/cursor-grab.png`、`/pic/cursor-grabbing.png`、`/broadcast?pet=`（1s 轮询）、`/balance`、`/balance/trigger`、`/whisper`、`/work-status`、`/chat`、`/notify?since=`（部分由配置门控，第一阶段不触达）
- `broadcast` 应答形状：`{ ok:true, text:'', image:undefined, ts:0 }`（no-cache）；`notify`：`{ ok:true, seq:0, frames:[] }`；`work-status`：`{ts:0}` 即空闲
- thumb 素材归属：`<userRoot>/pet/<petId>-animation/` 存在→只查它；否则 `<userRoot>/main-animation/webm` 优先 → 包内 `assets/webm`（`<userRoot>` = `~/.dsh/dsh-pet`，即 `$DSH_HOME/dsh-pet`）
- 主进程窗口列表来自环境变量 `DSH_PET_PETS`（JSON `[{id,size}]`），未设时回落单默认宠；`DSH_PET_CONFIG_URL` 未设时默认指向 3080（需覆盖）；`DSH_PET_HOST_PID` 未设时**不做存活探测**（独立运行天然安全）
- 上游 `npm test` = `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/**/*.test.ts`
- 包内静态图：`assets/pic/notify-done.png` 可用作托盘图标；`assets/fonts/上首软糖体.ttf`

**全局约定:** 所有命令在 `d:\Attempt\Qoder\Pet\dsh-pet\dsh-pet`（包根目录）执行，除非另有说明；git 操作在仓库根 `d:\Attempt\Qoder\Pet`；每个 Task 结束时勾掉 checkbox 并提交。

---

### Task 1: 环境准备与上游基线冒烟（验证前提，不写代码）

**Files:**
- 无新增；生成 `node_modules/`、`lib/`、`runtime/electron-helper/shared-core.js`（均为构建产物）

- [x] **Step 1: 安装依赖（自动触发 prepare 构建 lib + shared-core）**

```powershell
cd d:\Attempt\Qoder\Pet\dsh-pet\dsh-pet
npm install
```
预期：无报错；`lib/`、`runtime/electron-helper/shared-core.js` 出现。若 prepare 阶段失败，停下排错，不要继续。

- [x] **Step 2: 跑上游测试套件，确认环境健康**

```powershell
npm test
```
预期：现有 node:test 全部 pass（这是我们的回归基线）。

- [x] **Step 3: 下载 Electron**

```powershell
npm run ensure:electron
```
预期：`~\.dsh\electron\electron.exe` 存在（`Test-Path "$env:USERPROFILE\.dsh\electron\electron.exe"` 为 True）。

- [x] **Step 4: 基线冒烟——mock 宿主 + 桌宠窗口**

终端 A：
```powershell
npm run dev:mock
```
预期：`[mock-server] listening on http://127.0.0.1:8231/dsh-pet-7340/`。

终端 B：
```powershell
npm run start:desktop -- http://127.0.0.1:8231/dsh-pet-7340/config
```
预期：桌面右上角出现"蓝毛小女仆"，会呼吸、随机做动作、可拖拽。**这一步只是验证环境，产物不提交**（无代码改动，`git status` 应只有未跟踪的构建产物——已被 .gitignore 覆盖则无输出）。

- [x] **Step 5: 关闭两端进程，记录观察**

把冒烟中看到的动画/交互行为记在笔记里，供 Task 10 对照验收。

---

### Task 2: standalone-entry.ts（配置聚合 + 桌面宠物清单 + 初始用户配置）

> ✅ 已完成（b1e4c10 → eae8c02 → 1a2f95f）。代码以 `src/host/standalone-entry.ts` 审查后版本为准，与本节下列计稿的差异：STARTER_USER_CONFIG 瘦身（只写差异字段+name）、desktopPetList 去掉静默 catch（异常上抛）、本地谓词 isDesktopDisplay 替代 shared 导入、参数名 dataRoot；另补了抛错回归测试。

**Files:**
- Create: `src/host/standalone-entry.ts`
- Test: `src/host/standalone-entry.test.ts`

- [x] **Step 1: 写失败测试**

创建 `src/host/standalone-entry.test.ts`：

```typescript
/**
 * standalone-entry 测试 —— 独立桌面应用的宿主侧纯逻辑（配置路径组装 / 桌面宠物清单 /
 * 初始用户配置写入）。风格与 config.test.ts 一致：mkdtemp 临时目录做夹具，node:test。
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { petPaths, desktopPetList, ensureStarterUserConfig, mergedConfig } from './standalone-entry.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'dshpet-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** 最小合法默认配置（结构与包内 config.jsonc 一致，字段能省则省） */
function writeDefault(pkgRoot: string, petsJson: string): void {
  mkdirSync(join(pkgRoot, 'assets'), { recursive: true });
  writeFileSync(
    join(pkgRoot, 'assets', 'config.jsonc'),
    `{ "pets": ${petsJson}, "whisperPrompt": "x", "chatMemoryRounds": 5, "whisperImageEnabled": false, "chatImageEnabled": false, "memes": {}, "notificationsEnabled": true, "eventsRefreshSec": { "balance": 1800, "whisper": 300 } }`,
  );
}

describe('petPaths', () => {
  test('组装三个路径：包内默认配置 / 用户 main-config / 用户 pet 目录', () => {
    // 第二参数 = dshHome（~/.dsh 那一层），实现内部再拼 'dsh-pet' 段（与 pet-pack 用例同口径）
    const p = petPaths('/pkg', '/user');
    assert.equal(p.defaultFile, join('/pkg', 'assets', 'config.jsonc'));
    assert.equal(p.userFile, join('/user', 'dsh-pet', 'main-config.json'));
    assert.equal(p.petDir, join('/user', 'dsh-pet', 'pet'));
  });
});

describe('desktopPetList', () => {
  test('只保留 display 含 desktop 的宠物，并透出 id/size', () => {
    const pkg = tmp();
    const user = tmp();
    writeDefault(pkg, JSON.stringify([
      { id: 'main', size: 462, balanceEnabled: true, display: 'desktop', position: { corner: 'top-right', marginX: 24, marginY: 100 } },
      { id: 'webby', size: 200, balanceEnabled: false, display: 'web', position: { corner: 'top-left', marginX: 24, marginY: 100 } },
    ]));
    const list = desktopPetList(pkg, user);
    assert.deepEqual(list, [{ id: 'main', size: 462 }]);
  });

  test('pet pack（文件宠物）的 desktop 宠物也在清单里', () => {
    const pkg = tmp();
    const userRoot = tmp();
    const user = join(userRoot, 'dsh-pet');
    writeDefault(pkg, JSON.stringify([
      { id: 'main', size: 462, balanceEnabled: false, display: 'desktop', position: { corner: 'top-right', marginX: 24, marginY: 100 } },
    ]));
    mkdirSync(join(user, 'pet'), { recursive: true });
    writeFileSync(
      join(user, 'pet', 'pig-config.json'),
      JSON.stringify({
        pets: [{ id: 'pig1', size: 420, balanceEnabled: false, display: 'both', position: { corner: 'bottom-left', marginX: 24, marginY: 100 } }],
        animations: { idle: ['a'], turn: [], drag: [], clicks: [], moves: { default: { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 }, actions: [] }, categories: [], events: {} },
        animationWeights: { idle: 100, turn: 0, move: 0 },
      }),
    );
    mkdirSync(join(user, 'pet', 'pig-animation'), { recursive: true });
    writeFileSync(join(user, 'pet', 'pig-animation', 'a.webm'), 'x');
    const ids = desktopPetList(pkg, userRoot).map((p) => p.id).sort();
    assert.deepEqual(ids, ['main', 'pig1']);
  });
});

describe('ensureStarterUserConfig', () => {
  test('无用户配置时写入独立版初始配置（balanceEnabled=false, display=desktop）', () => {
    const dir = tmp();
    const file = join(dir, 'main-config.json');
    assert.equal(ensureStarterUserConfig(file), true);
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(obj.pets[0].balanceEnabled, false);
    assert.equal(obj.pets[0].display, 'desktop');
  });

  test('已有用户配置时绝不覆盖', () => {
    const dir = tmp();
    const file = join(dir, 'main-config.json');
    writeFileSync(file, JSON.stringify({ pets: [] }));
    assert.equal(ensureStarterUserConfig(file), false);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pets: [] });
  });
});

describe('mergedConfig', () => {
  test('返回 readAllConfig 成品聚合（含 main 条目且字段已填满）', () => {
    const pkg = tmp();
    const user = tmp();
    writeDefault(pkg, JSON.stringify([
      { id: 'main', size: 462, balanceEnabled: false, display: 'desktop', position: { corner: 'top-right', marginX: 24, marginY: 100 } },
    ]));
    const merged = mergedConfig(pkg, user);
    assert.ok(merged.main);
    assert.ok(Array.isArray(merged.main.pets));
    void existsSync; // 保持 import 一致性占位
  });
});
```

注意：若 `writeDefault` 造的最小夹具因缺 `animations`/`animationWeights` 字段被 readAllConfig 校验报错，就把 pig-config 里那段 animations/weights 块同样补进默认配置 —— 校验语义以上游 config.ts 实测为准，不为迁就测试改上游。

- [x] **Step 2: 运行确认失败**

```powershell
node --experimental-strip-types --import ./scripts/test-register.mjs --test src/host/standalone-entry.test.ts
```
预期：FAIL（Cannot find module ... standalone-entry.ts）。

- [x] **Step 3: 实现 standalone-entry.ts**

```typescript
/**
 * standalone-entry —— 独立桌面应用（无 DSH）的宿主侧入口。
 *
 * 角色：把 src/host/config.ts 的纯逻辑（readAllConfig/flattenPetList）包装成
 * 迷你宿主可直接消费的三个 API：
 *   - petPaths(packageRoot, userRoot)：组装 ConfigPaths（与上游 ~/.dsh/dsh-pet 布局逐字一致）
 *   - mergedConfig / desktopPetList：成品配置聚合 / display 含 desktop 的 [{id,size}] 清单
 *   - ensureStarterUserConfig：首次运行写入独立版初始配置（关余额，桌面显示）
 *
 * 本文件由 scripts/build-standalone-core.mjs 打成 CJS（standalone-core.cjs）供
 * runtime/electron-helper（主进程）require；它同时是 TS 源，接受上游 typecheck/test 管辖。
 *
 * 用户配置语义（沿用上游）：main-config.json 是覆盖层，pets 字段整体替换内置默认；
 * 用户手写配置后本模块不再碰它（存在即跳过）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAllConfig, flattenPetList, type ConfigPaths } from './config';
import { isDesktopVisible } from '../shared/config';

/** 独立版初始用户配置：单宠、桌面显示、关余额/碎碎念/工作状态（第二阶段接 LLM 后再放开） */
const STARTER_USER_CONFIG = {
  pets: [
    {
      name: '蓝毛小女仆',
      id: 'main',
      size: 462,
      balanceEnabled: false,
      whisperEnabled: false,
      workStatusEnabled: false,
      display: 'desktop',
      position: { corner: 'top-right', marginX: 24, marginY: 100 },
    },
  ],
};

/** 三路径组装：包根 + 用户数据根（= $DSH_HOME 的值，独立版默认 ~/.dsh） */
export function petPaths(packageRoot: string, dshHome: string): ConfigPaths {
  const user = join(dshHome, 'dsh-pet');
  return {
    defaultFile: join(packageRoot, 'assets', 'config.jsonc'),
    userFile: join(user, 'main-config.json'),
    petDir: join(user, 'pet'),
  };
}

/** 成品配置聚合（{ main: {...}, <种类前缀>: {...} }，全部字段已填满） */
export function mergedConfig(packageRoot: string, dshHome: string): Record<string, Record<string, unknown>> {
  return readAllConfig(petPaths(packageRoot, dshHome));
}

/** 桌面窗口清单：display 含 desktop/both 的全部宠物（主配置 + pet pack） */
export function desktopPetList(packageRoot: string, dshHome: string): Array<{ id: string; size: number }> {
  try {
    return flattenPetList(mergedConfig(packageRoot, dshHome))
      .filter((p) => isDesktopVisible(String(p.display ?? 'both') as 'web' | 'desktop' | 'both' | 'none'))
      .map((p) => ({ id: String(p.id), size: Number(p.size) }));
  } catch (error) {
    console.error('[standalone] desktopPetList failed:', error);
    return [];
  }
}

/** 首次运行写初始配置；已存在（无论内容）→ 不碰。返回是否写入 */
export function ensureStarterUserConfig(userFile: string): boolean {
  if (existsSync(userFile)) return false;
  mkdirSync(join(userFile, '..'), { recursive: true });
  writeFileSync(userFile, JSON.stringify(STARTER_USER_CONFIG, null, 2) + '\n', 'utf8');
  return true;
}
```

- [x] **Step 4: 运行确认通过**

```powershell
node --experimental-strip-types --import ./scripts/test-register.mjs --test src/host/standalone-entry.test.ts
```
预期：全部 pass。若 `isDesktopVisible` 的类型不匹配 `String(...)`，改用 `p.display as 'web'|'desktop'|'both'|'none'` 直接传。

- [x] **Step 5: 全量测试 + 类型检查**

```powershell
npm test; npm run typecheck
```
预期：全绿（新文件进入既有测试网）。

- [x] **Step 6: Commit**

```powershell
cd d:\Attempt\Qoder\Pet
git add dsh-pet/dsh-pet/src/host/standalone-entry.ts dsh-pet/dsh-pet/src/host/standalone-entry.test.ts
git commit -m "feat(standalone): host config aggregation entry with starter user config"
```

---

### Task 3: 构建 standalone-core.cjs（rolldown → CJS）

> ✅ 已完成。产物实测：bundle 只 require `node:fs` / `node:path`（零 `@deepseek-ai/*`、零三方依赖），四个导出（mergedConfig/desktopPetList/ensureStarterUserConfig/petPaths）require 后均为 function。与计稿的差异：① 根 .gitignore 三行必须带两层前缀 `dsh-pet/dsh-pet/…`（包体真身在 dsh-pet/dsh-pet/，单层写法匹配不到任何东西，已用 `git check-ignore -v` 实测）；② 生成的 .cjs 追加进 `dsh-pet/dsh-pet/.prettierignore`（`prettier --check .` 会扫 runtime/，与 shared-core.js 同一处理），否则 format:check 红。

**Files:**
- Create: `scripts/build-standalone-core.mjs`
- Modify: `package.json`（scripts 增加一行）
- Modify: `scripts/prepare.js`（增加 1.7 步）

- [x] **Step 1: 写构建脚本**（镜像 build-desktop-core.mjs，差异：platform node、格式 cjs）

```javascript
#!/usr/bin/env node
/**
 * build-standalone-core.mjs —— 把 src/host/standalone-entry.ts 打成
 * runtime/electron-helper/standalone-core.cjs（CommonJS），供 Electron 主进程的
 * mini-host require（helper 无构建管线，经典 CJS 直载）。
 *
 * 用法：node scripts/build-standalone-core.mjs（npm run build:standalone-core；
 * 由 prepare.js 与本地开发调用）
 */
import { rolldown } from 'rolldown';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

try {
  const bundle = await rolldown({
    input: join(ROOT, 'src', 'host', 'standalone-entry.ts'),
    platform: 'node',
  });
  await bundle.write({ format: 'cjs', file: join(ROOT, 'runtime', 'electron-helper', 'standalone-core.cjs') });
  console.log('[build-standalone-core] ✓ runtime/electron-helper/standalone-core.cjs');
} catch (error) {
  console.error('[build-standalone-core] build failed:', error);
  process.exit(1);
}
```

- [x] **Step 2: package.json scripts 增加**（在 `"build:desktop-core"` 行后）

```json
"build:standalone-core": "node scripts/build-standalone-core.mjs",
```

- [x] **Step 3: prepare.js 挂链**（在 1.5 desktop-core 块之后、1.6 types 之前插入）

```javascript
// 1.55 构建独立应用宿主核心（src/host/standalone-entry → CJS，供 electron-helper require）
console.log('[prepare] building standalone core...');
const saRun = process.platform === 'win32' ? 'cmd /c npm run build:standalone-core' : 'npm run build:standalone-core';
const buildSa = spawnSync(saRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (buildSa.status !== 0) {
  console.error(`[prepare] 独立 standalone-core 构建失败 (exit ${buildSa.status})`);
  process.exit(1);
}
```

- [x] **Step 4: 构建并验证产物可 require**

```powershell
npm run build:standalone-core
node -e "const m=require('./runtime/electron-helper/standalone-core.cjs'); console.log([typeof m.mergedConfig, typeof m.desktopPetList, typeof m.ensureStarterUserConfig].join(','))"
```
预期输出：`function,function,function`

- [x] **Step 5: 仓库根 .gitignore 追加构建产物**

```powershell
cd d:\Attempt\Qoder\Pet
Add-Content .gitignore "`ndsh-pet/runtime/electron-helper/shared-core.js`ndsh-pet/runtime/electron-helper/standalone-core.cjs`ndsh-pet/dist-desktop/"
```

- [x] **Step 6: Commit**

```powershell
git add -A
git commit -m "build(standalone): rolldown standalone-core.cjs + prepare hook + gitignore"
```

---

### Task 4: mini-host.js（本地 HTTP 迷你宿主）

> ✅ 已完成。计稿实现落地，三处实测补充：① `server.close()` 会等 keep-alive 套接字自己超时（实测 ~3s 才回 close 事件，表现为退出应用白等 3 秒），故 close() 内补 `server.closeAllConnections()`；② 防穿越光用 fetch 看不出真相（undici 先按 WHATWG URL 折叠点段），故测试额外用 `node:http` 直发未规范化的原始路径覆盖 `%2F` 编码版 / 字面 `../..` 版 / `%5C` 版：thumb 命中扩展名白名单 → 400，font、pic 命中 resolveExisting 的 root 前缀检查 → 404，折出前缀之外 → 404，没有一条能读到前缀外文件（安全行为未为测试放宽）；③ 两个新文件都需过 `npx prettier --write`（`runtime/**` 只在 eslint 的 ignores 里，prettier 仍会扫）。
>
> 🔧 评审修复轮（Task 4 review round）：sendFile 对齐上游 issue #62 修复（open 事件里 fstat 取长度，弃读释放 fd，不再 stat-then-stream）；全响应加 `access-control-allow-origin: *`（渲染端 file://（null 源）跨源）+ Host 门 403（DNS rebinding 纵深防御）；路由改整路径精确匹配（/config/meta 不再误配成 config）+ 非 GET/HEAD 一律 405；坏百分号编码 400；listen/close 错误上抛；initStandalone 单一 home 推导；ID_FORBIDDEN 经 standalone-core 再导出与上游同源（防镜像漂移）；测试 7→11 全绿，tolerant 400||404 断言已按实测码字钉死。
>
> ⚠️ 第二阶段约束：放行 POST 端点前必须把 ACAO:* 收紧为白名单回显或加一次性 token（本机网页可跨源打随机端口）

**Files:**
- Create: `runtime/electron-helper/mini-host.js`
- Test: `runtime/electron-helper/mini-host.test.js`（新建独立测试入口，不进上游 `src/**` glob）

- [x] **Step 1: 写失败测试**

```javascript
/**
 * mini-host 测试 —— 独立桌宠迷你宿主的端点契约（node:test + 真起 HTTP 服务）。
 * 前置：先 npm run build:standalone-core（本测试 require 其产物 standalone-core.cjs）。
 * 运行：npm run test:standalone
 */
'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createMiniHost } = require('./mini-host.js');

const dirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'dshpet-mh-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** 造一个最小"包根 + 用户根"夹具，返回 {packageRoot, dshHome} */
function fixture() {
  const packageRoot = tmp();
  const dshHome = tmp();
  mkdirSync(join(packageRoot, 'assets', 'webm'), { recursive: true });
  mkdirSync(join(packageRoot, 'assets', 'fonts'), { recursive: true });
  mkdirSync(join(packageRoot, 'assets', 'pic'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'assets', 'config.jsonc'),
    JSON.stringify({
      pets: [{ id: 'main', size: 462, balanceEnabled: false, display: 'desktop', position: { corner: 'top-right', marginX: 24, marginY: 100 } }],
      animations: { idle: ['待机'], turn: [], drag: [], clicks: [], moves: { default: { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 }, actions: [] }, categories: [], events: {} },
      animationWeights: { idle: 100, turn: 0, move: 0 },
      eventsRefreshSec: { balance: 1800, whisper: 300 },
    }),
  );
  writeFileSync(join(packageRoot, 'assets', 'webm', '待机.webm'), 'WEBMBYTES');
  writeFileSync(join(packageRoot, 'assets', 'fonts', 'f.ttf'), 'TTFBYTES');
  writeFileSync(join(packageRoot, 'assets', 'pic', 'cursor-grab.png'), 'PNGBYTES');
  return { packageRoot, dshHome };
}

async function start() {
  const f = fixture();
  const host = await createMiniHost(f);
  return { f, host, base: host.url + '/dsh-pet-7340' };
}

describe('mini-host endpoints', () => {
  test('GET /config → 200 成品聚合（main 条目 + 初始用户层已写）', async () => {
    const { f, host, base } = await start();
    const res = await fetch(base + '/config');
    assert.equal(res.status, 200);
    const merged = await res.json();
    assert.ok(Array.isArray(merged.main.pets));
    assert.equal(merged.main.pets[0].balanceEnabled, false);
    assert.ok(f.dshHome);
    await host.close();
  });

  test('GET /thumb/main/待机.webm → 200 video/webm 内容正确', async () => {
    const { host, base } = await start();
    const res = await fetch(base + '/thumb/main/' + encodeURIComponent('待机.webm'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'video/webm');
    assert.equal(await res.text(), 'WEBMBYTES');
    await host.close();
  });

  test('thumb 防穿越与非法 id：路径穿越 400，非法 petId 400，未知文件 404', async () => {
    const { host, base } = await start();
    assert.equal((await fetch(base + '/thumb/main/..%2F..%2Fconfig.jsonc')).status, 400);
    assert.equal((await fetch(base + '/thumb/bad..id/x.webm')).status, 400);
    assert.equal((await fetch(base + '/thumb/main/%E4%B8%8D%E5%AD%98%E5%9C%A8.webm')).status, 404);
    await host.close();
  });

  test('font / pic 静态服务；未知 scope 400', async () => {
    const { host, base } = await start();
    assert.equal((await fetch(base + '/font/f.ttf')).status, 200);
    assert.equal((await fetch(base + '/pic/cursor-grab.png')).status, 200);
    assert.equal((await fetch(base + '/whatever/x')).status, 400);
    await host.close();
  });

  test('事件类端点空转形状：broadcast / work-status / notify', async () => {
    const { host, base } = await start();
    const bc = await (await fetch(base + '/broadcast?pet=main')).json();
    assert.deepEqual({ ok: bc.ok, text: bc.text, ts: bc.ts }, { ok: true, text: '', ts: 0 });
    const ws = await (await fetch(base + '/work-status')).json();
    assert.equal(ws.ts, 0);
    const nt = await (await fetch(base + '/notify?since=0')).json();
    assert.deepEqual([nt.ok, nt.seq, nt.frames.length], [true, 0, 0]);
    await host.close();
  });

  test('LLM/凭据类端点第一阶段 501：balance / balance/trigger / whisper / chat', async () => {
    const { host, base } = await start();
    for (const p of ['/balance', '/balance/trigger', '/whisper']) {
      assert.equal((await fetch(base + p)).status, 501, p);
    }
    assert.equal((await fetch(base + '/chat?pet=main')).status, 501);
    await host.close();
  });
});
```

- [x] **Step 2: 加测试脚本并确认失败**

package.json scripts 增加（`"test"` 行后）：

```json
"test:standalone": "node scripts/build-standalone-core.mjs && node --test runtime/electron-helper/mini-host.test.js",
```

```powershell
npm run test:standalone
```
预期：FAIL（Cannot find module './mini-host.js'）。

- [x] **Step 3: 实现 mini-host.js**

```javascript
/**
 * mini-host.js —— 独立桌面应用的"迷你宿主"：本地 127.0.0.1 HTTP 服务，
 * 按上游 /dsh-pet-7340/* 路由契约就地应答（渲染端零感知）。
 *
 * 端点策略（设计文档 §2/§3）：
 *   /config            readAllConfig 成品聚合（首次运行先写初始用户层：关余额/桌面显示）
 *   /thumb/<id>/<f>    素材：pet/<id>-animation 专属目录 → 用户 main-animation/webm → 包内 assets/webm
 *   /font/<f> /pic/<f> 包内静态图/字体（pic/memes/* 归 memes 目录，与上游同规则）
 *   /broadcast /work-status /notify   空转（"无事发生"形状，客户端轮询恒定不触发）
 *   /balance* /whisper /chat          501（第一阶段无凭据/无 LLM；第二阶段就地实装）
 *
 * 纯 Node（不 require electron）——可被 main.js 同进程调用，也可独立单测。
 */
'use strict';
const { createServer } = require('node:http');
const { createReadStream, existsSync, statSync, mkdirSync, writeFileSync } = require('node:fs');
const { join, normalize, sep } = require('node:path');
const core = require('./standalone-core.cjs');

const PREFIX = '/dsh-pet-7340';
/** 与上游 src/host/config.ts 的 ID_FORBIDDEN 同规则（Windows 保留符 + 控制字符） */
// eslint-disable-next-line no-control-regex
const ID_FORBIDDEN = /[\\/:\x00-\x1f]/;
const MIME = {
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};

const json = (res, status, obj, noCache) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...(noCache ? { 'cache-control': 'no-cache, no-store' } : {}),
  });
  res.end(body);
};
const text = (res, status, msg) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(msg);
};
/** 整文件流式应答（与上游宿主一致：不支持 Range，素材为短小 webm） */
function file(res, path) {
  const { size } = statSync(path);
  res.writeHead(200, {
    'content-type': MIME[extOf(path)] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'public, max-age=3600',
  });
  const stream = createReadStream(path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
const extOf = (p) => p.slice(p.lastIndexOf('.')).toLowerCase();
/** 根目录内安全解析：拼接后必须仍在 root 内（防 .. 穿越），文件存在才返回 */
function resolveExisting(root, rel) {
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : undefined;
}

/**
 * 起迷你宿主。
 * @param {{packageRoot:string, dshHome?:string, port?:number}} opts
 *   packageRoot = dsh-pet 包根（assets 所在）；dshHome 缺省 = env DSH_HOME || ~/.dsh
 * @returns {Promise<{server, url:string, close():Promise<void>}>}
 */
async function createMiniHost({ packageRoot, dshHome, port = 0 }) {
  const home = dshHome || process.env.DSH_HOME || join(require('node:os').homedir(), '.dsh');
  const paths = core.petPaths(packageRoot, home);
  const userRoot = join(home, 'dsh-pet');
  // 首次运行落初始用户配置（已存在绝不覆盖——用户手写文件优先）
  core.ensureStarterUserConfig(paths.userFile);
  // LLM 配置占位（规格 §2.2/§6）：第二阶段读它实装 /whisper /chat，第一阶段仅存默认禁用态
  const settingsFile = join(userRoot, 'standalone-settings.json');
  if (!existsSync(settingsFile)) {
    mkdirSync(userRoot, { recursive: true });
    writeFileSync(settingsFile, JSON.stringify({ llm: { enabled: false, apiBase: '', apiKey: '', model: '' } }, null, 2) + '\n', 'utf8');
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      if (!pathname.startsWith(PREFIX + '/')) return text(res, 404, 'mini-host: outside prefix');
      const rest = decodeURIComponent(pathname.slice(PREFIX.length + 1));
      const [scope, ...parts] = rest.split('/');

      if (scope === 'config') {
        return json(res, 200, core.mergedConfig(packageRoot, home), true);
      }
      if (scope === 'font') {
        const f = resolveExisting(join(packageRoot, 'assets', 'fonts'), parts.join('/'));
        return f ? file(res, f) : text(res, 404, 'font not found');
      }
      if (scope === 'pic') {
        const isMeme = parts[0] === 'memes';
        const root = join(packageRoot, 'assets', isMeme ? 'memes' : 'pic');
        const f = resolveExisting(root, (isMeme ? parts.slice(1) : parts).join('/'));
        return f ? file(res, f) : text(res, 404, 'pic not found');
      }
      if (scope === 'thumb') {
        const [petId, ...nameParts] = parts;
        const fileName = nameParts.join('/');
        if (!petId || !fileName || ID_FORBIDDEN.test(petId)) return text(res, 400, 'invalid pet id or path');
        const ext = extOf(fileName);
        if (ext !== '.webm' && ext !== '.mov') return text(res, 400, 'unsupported animation format');
        const packDir = join(userRoot, 'pet', petId + '-animation');
        const sub = ext === '.mov' ? 'mov' : 'webm';
        const from =
          existsSync(packDir)
            ? resolveExisting(packDir, fileName)
            : resolveExisting(join(userRoot, 'main-animation', sub), fileName) ??
              resolveExisting(join(packageRoot, 'assets', sub), fileName);
        return from ? file(res, from) : text(res, 404, 'asset not found');
      }
      if (scope === 'broadcast') {
        return json(res, 200, { ok: true, text: '', ts: 0 }, true);
      }
      if (scope === 'work-status') {
        return json(res, 200, { ts: 0, state: null, task: null }, true);
      }
      if (scope === 'notify') {
        return json(res, 200, { ok: true, seq: 0, frames: [] }, true);
      }
      if (scope === 'balance' || rest === 'balance/trigger' || scope === 'whisper' || scope === 'chat') {
        return json(res, 501, { error: 'dsh-pet standalone: not available in phase 1 (needs credentials / LLM)' });
      }
      return text(res, 400, 'mini-host: expected /config | /thumb/<id>/<f> | /font | /pic | /broadcast | /work-status | /notify');
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const bound = server.address().port;
  return {
    server,
    url: `http://127.0.0.1:${bound}`,
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/**
 * 独立模式总装：起宿主 + 注入 main.js 依赖的两个环境变量（DSH_PET_CONFIG_URL / DSH_PET_PETS）。
 * main.js 只 require 本文件并 await 这一个函数。
 */
async function initStandalone({ packageRoot }) {
  const host = await createMiniHost({ packageRoot });
  process.env.DSH_PET_CONFIG_URL = host.url + PREFIX + '/config';
  const home = process.env.DSH_HOME || join(require('node:os').homedir(), '.dsh');
  const list = core.desktopPetList(packageRoot, home);
  if (list.length) process.env.DSH_PET_PETS = JSON.stringify(list);
  return host;
}

module.exports = { createMiniHost, initStandalone };
```

- [x] **Step 4: 运行确认通过**

```powershell
npm run test:standalone
```
预期：6 个 describe 用例全 pass。若 `/thumb/bad..id` 用例 400 不成立（fetch 客户端归一化了 `..`），改用直连 socket 或断言 404——按实际行为修正测试，再改代码。

- [x] **Step 5: 上游测试回归不受影响**

```powershell
npm test
```
预期：全绿（.test.js 不在 src/**.test.ts glob 内）。

- [x] **Step 6: Commit**

```powershell
cd d:\Attempt\Qoder\Pet
git add dsh-pet/dsh-pet/runtime/electron-helper/mini-host.js dsh-pet/dsh-pet/runtime/electron-helper/mini-host.test.js dsh-pet/dsh-pet/package.json
git commit -m "feat(standalone): in-process mini host serving upstream /dsh-pet-7340 contract"
```

---

### Task 5: sprite.js noLlm 菜单补丁（唯一渲染端改动）

**Files:**
- Modify: `runtime/electron-helper/sprite.js`（约 L1025-1033 菜单工具项组装处）

- [x] **Step 1: 打补丁**

原文（约 L1025 起）：

```javascript
    const tools = [{ label: '打开网站', action: 'open-site' }];
    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });
    tools.push(
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      { label: '回到初始位置', action: 'home' },
    );
```

改为：

```javascript
    // 独立桌宠模式（noLlm=1，见 mini-host/main.js）：碎碎念/对话依赖 LLM，第一阶段隐藏入口
    const NO_LLM = new URLSearchParams(location.search).get('noLlm') === '1';
    const tools = [{ label: '打开网站', action: 'open-site' }];
    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });
    if (!NO_LLM) tools.push({ label: '碎碎念', action: 'whisper' }, { label: '对话', action: 'chat' });
    tools.push({ label: '回到初始位置', action: 'home' });
```

- [x] **Step 2: 回归——DSH/mock 流（无 noLlm 参数）菜单两项仍在**

```powershell
npm run dev:mock         # 终端 A
npm run start:desktop -- http://127.0.0.1:8231/dsh-pet-7340/config   # 终端 B
```
右键宠物：应看到「碎碎念」「对话」（无 noLlm 参数 → 原行为）。关闭两进程。

- [x] **Step 3: Commit**

```powershell
cd d:\Attempt\Qoder\Pet
git add dsh-pet/dsh-pet/runtime/electron-helper/sprite.js
git commit -m "feat(standalone): hide whisper/chat menu entries under noLlm=1 (design spec 2.2 patch)"
```

---

### Task 6: main.js 独立模式接线（启动 + 托盘 + 单实例 + 错误兜底）

> ➕ second-instance 现身语义（补规格 §4“聚焦已有实例”与计划“静默退出”的分歧：托盘已有显隐，二次启动=亮出宠物不抢焦点）

**Files:**
- Modify: `runtime/electron-helper/main.js`

- [x] **Step 1: 文件头（`const { app, ... } = electronApi;` 之后）加独立模式常量与单实例锁**

```javascript
// ---------- 独立桌宠模式（无 DSH 宿主；设计文档 §2） ----------
const STANDALONE = process.env.DSH_PET_STANDALONE === '1';
// 包根：开发 = runtime/electron-helper 上两级；打包后 = resources/dsh-pet-package（electron-builder extraResources）
const PACKAGE_ROOT =
  process.env.DSH_PET_PACKAGE_ROOT ||
  (app.isPackaged ? path.join(process.resourcesPath, 'dsh-pet-package') : path.join(__dirname, '..', '..'));
let miniHost = null; // createMiniHost 返回句柄（before-quit 时关服务）
if (STANDALONE && !app.requestSingleInstanceLock()) {
  console.log('[standalone] another instance is running, quit.');
  app.quit();
}
```

注：main.js 顶部已有 `const path = require('node:path');`（L49，已核实），统一用 `path.join`。`app` 在 L48 从 `electronApi` 解构，位于本段之前。

- [x] **Step 2: `app.whenReady()` 回调内、创建窗口之前，接线迷你宿主与托盘**

在 whenReady 既有逻辑最前插入（若代码结构是 `app.whenReady().then(async () => {...})` 则加 async 体内首行）：

```javascript
  if (STANDALONE) {
    const { initStandalone } = require('./mini-host.js');
    try {
      miniHost = await initStandalone({ packageRoot: PACKAGE_ROOT });
      console.log('[standalone] mini-host at', miniHost.url);
    } catch (e) {
      console.error('[standalone] mini-host failed:', e);
      const { dialog } = electronApi;
      dialog.showErrorBox('桌宠启动失败', String((e && e.message) || e));
      app.quit();
      return;
    }
    // 托盘：显示/隐藏 + 退出（独立模式唯一的显式出口）
    const { Tray, Menu, nativeImage } = electronApi;
    const tray = new Tray(nativeImage.createFromPath(path.join(PACKAGE_ROOT, 'assets', 'pic', 'notify-done.png')));
    tray.setToolTip('dsh-pet 桌宠');
    let petsVisible = true;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示/隐藏宠物',
          click: () => {
            petsVisible = !petsVisible;
            for (const w of windows.values()) {
              if (petsVisible) w.show();
              else w.hide();
            }
          },
        },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    );
  }
```

注：`windows` 是 main.js 既有的 `Map<petId, BrowserWindow>`（L482 附近 `windows.delete(pet.id)` 可佐证）；miniHost 已在 Step 1 声明于模块级，这里只赋值。

- [x] **Step 3: 窗口 loadFile query 注入 noLlm（standalone 限定）**

`createPetWindows()` 里 loadFile 的 query 对象（约 L489）末尾加：

```javascript
          ...(STANDALONE ? { noLlm: '1' } : {}),
```

- [x] **Step 4: 生命周期兜底（standalone）**

先 `Select-String -Path .\runtime\electron-helper\main.js -Pattern 'window-all-closed|before-quit'` 查现状：

- **已有 `window-all-closed` 监听** → 在其回调首行插入 `if (STANDALONE) return;`
- **没有** → 在模块级（Step 1 代码块下方）新增：

```javascript
if (STANDALONE) {
  // 关窗不退应用（托盘才是出口；穿透窗无关闭按钮，此拦截主要防未来 F5/快捷键形态）
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    if (miniHost && miniHost.server) miniHost.server.close();
  });
}
```

- [x] **Step 5: 手动验证——独立模式启动**

```powershell
$env:DSH_PET_STANDALONE = '1'
& "$env:USERPROFILE\.dsh\electron\electron.exe" .\runtime\electron-helper\main.js
```
预期：
1. 宠物出现在右上角（首次运行自动生成 `~\.dsh\dsh-pet\main-config.json`，`balanceEnabled:false`）
2. 右键菜单**没有**「碎碎念」「对话」，也没有「查看余额」；动作树完整
3. 托盘有图标（对勾样式），右键托盘可 显示/隐藏、退出；退出后进程清零（`Get-Process electron -ErrorAction SilentlyContinue` 无残留）
4. 二次启动（已有实例运行时）不产生第二套宠物
5. 控制台打印 `[standalone] mini-host at http://127.0.0.1:<port>`

- [x] **Step 6: Commit**

```powershell
cd d:\Attempt\Qoder\Pet
git add dsh-pet/dsh-pet/runtime/electron-helper/main.js
git commit -m "feat(standalone): wire mini-host, tray, single-instance into electron main"
```

---

### Task 7: 一键启动脚本 start:standalone

**Files:**
- Create: `scripts/start-standalone.mjs`
- Modify: `package.json`（scripts）

- [x] **Step 1: 写脚本**（镜像 start-desktop.mjs；差异：不设 configUrl、不设 HOST_PID、注入 STANDALONE=1）

```javascript
#!/usr/bin/env node
/**
 * start-standalone.mjs —— 独立桌宠一键启动（无 DSH 宿主、无 mock）。
 * Electron 探测逻辑与 start-desktop 一致；主进程内 mini-host 自拉自建，
 * 不注入 DSH_PET_HOST_PID（桌宠不随本脚本退出而死，托盘才是出口）。
 * 用法：npm run start:standalone
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const helperMain = resolve(here, '..', 'runtime', 'electron-helper', 'main.js');

const PLAT = process.platform;
const electronRel =
  PLAT === 'win32' ? 'electron.exe' : PLAT === 'darwin' ? join('Electron.app', 'Contents', 'MacOS', 'Electron') : 'electron';
const candidates = [
  process.env.DSH_PET_ELECTRON_PATH,
  process.env.ELECTRON_PATH,
  join(process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh'), 'electron', electronRel),
];
const electron = candidates.find((v) => v && existsSync(v));
if (!electron) {
  console.error('[start-standalone] Electron not found. Run `npm run ensure:electron` first.');
  process.exit(1);
}
// 前置检查：standalone-core.cjs 必须已构建（prepare/build:standalone-core 产物）
if (!existsSync(resolve(here, '..', 'runtime', 'electron-helper', 'standalone-core.cjs'))) {
  console.error('[start-standalone] standalone-core.cjs missing. Run `npm run build:standalone-core` first.');
  process.exit(1);
}

const env = { ...process.env, DSH_PET_STANDALONE: '1', DSH_PET_SCALE: process.env.DSH_PET_SCALE || '1' };
delete env.ELECTRON_RUN_AS_NODE; // 同 start-desktop（issue #63）
delete env.DSH_PET_CONFIG_URL; // 由 mini-host 自己注入
delete env.DSH_PET_HOST_PID; // 桌宠独立存活

console.log(`[start-standalone] electron: ${electron}`);
const child = spawn(electron, [helperMain], { env, stdio: 'inherit', windowsHide: false });
child.on('exit', (code, signal) => console.log(`[start-standalone] exited (code=${code}, signal=${signal})`));
```

- [x] **Step 2: package.json scripts 增加**

```json
"start:standalone": "node scripts/start-standalone.mjs",
```

- [x] **Step 3: 端到端验证**

```powershell
npm run start:standalone
```
预期：与 Task 6 Step 5 相同的五项验证全部通过。再验证配置面：改 `~\.dsh\dsh-pet\main-config.json` 的 `corner` 为 `bottom-left`、`size` 为 `300`，重启后生效。

- [x] **Step 4: Commit**

```powershell
cd d:\Attempt\Qoder\Pet
git add dsh-pet/dsh-pet/scripts/start-standalone.mjs dsh-pet/dsh-pet/package.json
git commit -m "feat(standalone): one-command launcher (npm run start:standalone)"
```

---

### Task 8: electron-builder 打包 Windows exe

**Files:**
- Create: `electron-builder.yml`（包根）
- Modify: `package.json`（scripts + devDependencies）
- Modify: `runtime/electron-helper/main.js`（PACKAGE_ROOT 已在 Task 6 支持 app.isPackaged 分支，验证即可）

- [x] **Step 1: 对齐 Electron 版本并安装 electron-builder**

```powershell
& "$env:USERPROFILE\.dsh\electron\electron.exe" --version   # 记为 vX.Y.Z（含 v 前缀，取数字）
npm add -D electron-builder electron@<X.Y.Z去掉v>
```
预期：安装成功；`npx electron-builder --version` 有输出。

- [x] **Step 2: 写 electron-builder.yml**

```yaml
# 独立桌宠打包配置（设计文档 §7）
appId: com.local.dsh-pet-desktop
productName: dsh-pet-desktop
directories:
  output: dist-desktop
# 主入口改指 helper 的 main.js（root package.json 的 main 是 DSH 插件入口，不能用）
extraMetadata:
  main: runtime/electron-helper/main.js
asar: false # helper 体系按纯目录设计（loadFile 子资源、nativeImage 路径），关 asar 保行为一致
files:
  - runtime/electron-helper/**
  - package.json
extraResources:
  # 素材/配置以"包"形态随附：main.js 打包态取 resources/dsh-pet-package
  - from: .
    to: dsh-pet-package
    filter:
      - assets/**
      - runtime/electron-helper/standalone-core.cjs
win:
  target:
    - nsis
    - portable
  icon: assets/pic/notify-done.png
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [x] **Step 3: 补 main.js 打包态资源解析**

Task 6 Step 1 已写 `PACKAGE_ROOT = app.isPackaged ? join(process.resourcesPath, 'dsh-pet-package') : ...`。核对 `createPetWindows` 里 `loadFile('index.html')` 的相对路径解析在打包态是否仍以 helper 目录为基准（Electron 以 appPath 为基准，files 已含整个 helper 目录 → 正确）。**若托盘图标在打包态路径不同步**，检查 `notify-done.png` 是否在 `resources/dsh-pet-package/assets/pic/` 下。

- [x] **Step 4: package.json scripts 增加**

```json
"dist:desktop": "npm run build:standalone-core && electron-builder --win",
```

- [x] **Step 5: 构建并验证 portable exe**

```powershell
npm run dist:desktop
Get-ChildItem .\dist-desktop\*.exe
```
预期：`dsh-pet-desktop <version> portable.exe` 与 NSIS 安装包各一。双击 portable → 出现宠物 + 托盘图标；右键菜单无「碎碎念/对话」；素材加载正常（网络面板不可见，但以动画真实播放为准）；托盘退出后进程清零。

- [x] **Step 6: Commit**

```powershell
cd d:\Attempt\Qoder\Pet
git add dsh-pet/dsh-pet/electron-builder.yml dsh-pet/dsh-pet/package.json dsh-pet/dsh-pet/package-lock.json dsh-pet/dsh-pet/runtime/electron-helper/main.js
git commit -m "build(standalone): electron-builder windows nsis+portable packaging"
```

注：`dist-desktop/` 已被 Task 3 Step 5 的 .gitignore 行覆盖，产物不入库。

---

### Task 9: 上游同步通道（upstream remote，一次性）

- [x] **Step 1: 添加 upstream 并抓取（不发 PR、不合并，只留通道）**

```powershell
cd d:\Attempt\Qoder\Pet
git remote add upstream https://github.com/PC2005-cloud/dsh-pet.git
git fetch upstream --tags
git branch -r --list 'upstream/*' | Select-Object -First 3
```
预期：能看到 upstream/main。此后同步流程 = `git merge upstream/main` + 冲突手工重放（我们的改动集中在新增文件与两处小补丁）。

- [x] **Step 2: 提交 .git/config 变更说明到 README**

在根 README「状态」小节追加一行：

```markdown
- 上游同步：本仓库含 `upstream` remote 指向 PC2005-cloud/dsh-pet；同步 = merge upstream/main 后重放两处补丁（sprite.js noLlm、main.js 独立接线）
```

```powershell
git add README.md; git commit -m "docs: upstream sync channel note"; git push
```

---

### Task 10: 全量验收与文档收尾

- [x] **Step 1: 质量闸门全跑**

```powershell
cd dsh-pet\dsh-pet
npm run typecheck
npm run lint
npm run format
npm test
npm run test:standalone
```
预期：全绿。（`format` 只应格式化我们的新文件；若它改动上游文件，`git checkout` 回退对上游文件的格式化并加入 .prettierignore。）

- [ ] **Step 2: 对照规格 §8 逐项验收（人工清单）**

| # | 验收项 | 操作 | 通过标准 |
|---|--------|------|---------|
| 1 | 冒烟 | 全新终端 `npm run start:standalone` | 宠物出现，无错误角标 |
| 2 | 行为对照 | 对照 Task 1 笔记 | 呼吸循环/动作切换无空白/点击Q弹/甩抛反弹/右键点播行走 |
| 3 | 生命周期 | 托盘退出；重复启动 | 进程清零；不出第二套 |
| 4 | 配置面 | 改 main-config.json size/corner；放一个同名 webm 到 `~\.dsh\dsh-pet\main-animation\webm\` | 重启生效；用户素材优先于包内 |
| 5 | 事件动画点播 | 右键 动作→余额档位/碎碎念/工作状态 分类 | 能本地播放预览（不依赖事件源） |
| 6 | 打包 | portable exe 在无 Node 的目录双击 | 功能与开发流一致 |

- [x] **Step 3: 根 README 补「快速开始」**

```markdown
## 快速开始（开发）

cd dsh-pet/dsh-pet
npm install            # 自动构建（prepare）
npm run ensure:electron  # 首次下载 Electron
npm run start:standalone # 启动桌宠（托盘图标可退出）

## 打包

npm run dist:desktop   # 产物在 dsh-pet/dsh-pet/dist-desktop/
```

- [x] **Step 4: 最终提交并推送**

```powershell
cd d:\Attempt\Qoder\Pet
git add -A
git commit -m "docs: standalone quickstart + acceptance pass"
git push
```

---

## 已知风险与决策记录

1. **mini-host vs 复用 lib/host**：本计划自实现路由（规格 §2.1 的"后备方案"转正），理由是 mock-server 已验证该形状可行、且彻底避开 cordis DI 耦合；`handlePetRoute` 整体打包为备选未采用。
2. **fetch 客户端对 `..%2F` 的归一化**可能导致穿越用例测不到服务端防线（Task 4 Step 4 已预案）。
3. **electron-builder asar 关闭**：helper 全链路按纯目录假设写（loadFile 相对路径、nativeImage），打包兼容性优先于体积。
4. **未签名 exe** SmartScreen 告警：按规格 §9 文档说明处理，不买证书。
5. **上游 shared-core.js/standalone-core.cjs 为生成物**：新克隆必须 `npm install`（触发 prepare）或显式 `npm run build:desktop-core && npm run build:standalone-core`，start-standalone.mjs 已对 standalone-core 做前置检查。

## 评审遗留台账（非阻断）

以下为各 Task 评审 Carry-over 的小型非阻断项，记录在此供后续阶段参考：

- (a) mini-host 双份 standalone-core.cjs（resources/app 与 dsh-pet-package 各一，运行时用前者；两副本不同步）——源：Task 8 打包评审。
- (b) helper-process.test 对「~/.dsh 落地路径」优先级的覆盖在装了 electron devDep 的机器上变间接（CI 语义保留）——源：Task 2/7 测试评审。
- (c) icon-256.png 素材许可归类未明确（对外发布前按设计 §7 复核）——源：Task 8 打包评审。
- (d) package.json 无 author 字段 → NSIS Publisher 显示异常（改了会增上游 diff，留待用户决定）——源：Task 8 打包评审。
- (e) 冒烟观测 releaseKeptPosition ~11px 偏移（上游物理时序抖动，非本次引入）——源：Task 6/验收冒烟。
- (f) 冒烟/验收截图依赖 DPI-aware 裁剪（1.5 缩放直截全屏会错位）——源：Task 8/验收冒烟。

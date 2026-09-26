/**
 * 独立桌宠模式（DSH_PET_STANDALONE）接线与渲染端 noLlm 补丁的源码守卫。
 *
 * 背景：helper（runtime/electron-helper）随包发行、不经 tsc，Electron 起不来时
 * 什么断言都做不了——只能像 pointer-target.test.ts 的「源码守卫」一节那样读源码钉结构：
 *   ① main.js 的独立模式总闸 / 单实例锁 / mini-host 接线在位；
 *   ② noLlm=1 只经 createPetWindows 的 loadFile query 注入（设计文档 §2.2 唯一渲染端补丁）；
 *   ③ sprite.js 用 constants.js 的全局 params 消费（单次解析，同 BRIDGE 先例），不许退回
 *      就地 new URLSearchParams(location.search)。
 *
 * 断言风格：一律「结构化提取 + 语义断言」（先取出回调体 / 取出所在行，再断言其中出现或未出现
 * 什么调用）。禁止字符距离预算（[\s\S]{0,N}?）与整行签名等值：距离预算会让「加一句注释、多换一行」
 * 就假红，而真正的语义回归（showInactive 被换成 show）反而可能因为落在预算内而漏判。
 * 这里断的是「语义 = 不抢焦点」，与字符距离无关。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const helper = '../../runtime/electron-helper/';

/** 包内文件源码（守卫用；相对 src/host/ 解析） */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 取第一行包含 needle 的源码行（找不到则空串）：行内语义断言，不关心这一行前后有多少内容 */
const lineWith = (src: string, needle: string): string => src.split('\n').find((l) => l.includes(needle)) ?? '';

/**
 * 提取 `app.on('<事件>', (…) => { … })` 的整段回调（含 app.on 那一行）。
 * 结束边界 = 第一个「换行 + 缩进 + });」，与回调体长度/行数无关：往里插注释、增删语句都照样
 * 提取到整段，所以后续断言可以是纯语义的（有什么调用 / 没有什么调用）。
 */
const extractHandler = (src: string, event: string): string =>
  src.match(new RegExp(`app\\.on\\('${event}',\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s*\\}\\);`))?.[0] ?? '';

describe('守卫：main.js 的独立模式接线必须在位（设计文档 §2）', () => {
  const main = readSource(helper + 'main.js');

  test('总闸 = DSH_PET_STANDALONE 环境变量；包根解析（打包走 resourcesPath）', () => {
    assert.match(main, /DSH_PET_STANDALONE\s*===\s*'1'/, '独立模式总闸必须存在');
    assert.match(main, /dsh-pet-package/, '打包后包根必须落到 resources/dsh-pet-package（Task 8）');
  });

  test('mini-host 同进程接线：await initStandalone（配置损坏弹错误框退出，不静默半死）', () => {
    assert.match(main, /require\('\.\/mini-host\.js'\)/, '必须接线 mini-host');
    // 只钉「await + 对象实参里有 packageRoot 这一项」：实参怎么写（换行、加 dshHome/port、改属性
    // 顺序）都不敏感，initStandalone 的签名扩展不会让守卫假红
    assert.match(main, /await initStandalone\(\s*\{[^}]*\bpackageRoot\b/, '必须 await 总装');
    assert.match(main, /showErrorBox/, '启动失败必须弹错误框');
  });

  test('单实例锁必须排除 DPI 探测子进程（探测子进程继承 env，抢锁必失败自杀 → 永远探不到值）', () => {
    const lockLine = lineWith(main, 'app.requestSingleInstanceLock()');
    assert.match(lockLine, /^\s*if \(.*\bapp\.requestSingleInstanceLock\(\)/, '抢锁必须在 if 条件里（失败即退出）');
    assert.match(lockLine, /\bSTANDALONE\b/, '锁只在独立模式生效（bridge/dev 保持上游行为）');
    assert.match(lockLine, /!DPI_PROBE/, '锁必须排除 DPI 探测子进程');
  });

  test('二次启动走 second-instance：已有实例把宠物亮出来（设计文档 §4），不静默零反馈', () => {
    // 提取整段回调再断语义，而不是「相隔 300 字符内必须出现 showInactive」
    const si = extractHandler(main, 'second-instance');
    assert.ok(si, "第一实例必须接住 second-instance：app.on('second-instance', (…) => {…}) 回调体提取失败");
    // 亮出来用 showInactive（不抢焦点），与托盘「显示宠物」同一条路径
    assert.match(si, /showInactive\(\)/, 'second-instance 必须把宠物亮出来');
    // 同一回调的反面语义：段内不得出现任何抢焦点/抢层调用（若将来在注释里写下 show() 也会命中，
    // 那是刻意收紧——宁可改注释也不放宽语义）
    assert.doesNotMatch(si, /\.show\(\)|\.focus\(\)|\.moveTop\(\)/, '现身不得抢焦点（禁 show()/focus()/moveTop()）');
    // 与托盘显隐状态同步：不置位的话托盘要连点两次才显示
    assert.match(si, /petsVisible\s*=\s*true/, '亮窗后必须回写 petsVisible');
  });

  test('现身统一走 showInactive；全文净网：绝不出现 showWithoutFocus（Electron 从无此 API）', () => {
    // 幻觉兜底：showWithoutFocus 在 Electron 中根本不存在（实测 typeof===undefined），
    // 调用它只会抛 TypeError——整份 main.js 里一个 token 都不许留（正则覆盖全文件，含注释）。
    assert.doesNotMatch(main, /\bshowWithoutFocus\b/, 'main.js 仍含 showWithoutFocus（不存在的 API）');
    // 正例：不抢焦点的现身必须真实调用 showInactive（托盘显示 + second-instance 共用同一条路径）
    assert.match(main, /\.showInactive\(\)/, '现身必须调用 showInactive()');
  });

  test('便携形态用独立锁身份：PORTABLE_EXECUTABLE_FILE 命中时的 setName 必须早于抢锁行', () => {
    // 行序结构化断言（不看字符距离预算）：便携 setName 与基础 setName 是两行，
    // 只钉「同一行里既有 PORTABLE_EXECUTABLE_FILE 门控、又有 app.setName」的那一行。
    const lines = main.split('\n');
    const portableIdx = lines.findIndex((l) => /PORTABLE_EXECUTABLE_FILE/.test(l) && /app\.setName\(/.test(l));
    const lockIdx = lines.findIndex((l) => l.includes('app.requestSingleInstanceLock()'));
    assert.ok(portableIdx >= 0, '必须按 PORTABLE_EXECUTABLE_FILE 重设 app 名（便携锁身份隔离）');
    assert.ok(lockIdx >= 0, '抢锁行必须存在（提取失败）');
    assert.ok(portableIdx < lockIdx, '便携 setName 必须早于 requestSingleInstanceLock：锁身份要在抢锁前定死');
    // 独立身份必须与基础名不同名，否则便携/开发/安装版仍共享同一把锁（缺陷未修）
    assert.match(
      lines[portableIdx],
      /setName\(\s*'dsh-pet-electron-helper-portable'\s*\)/,
      '便携形态必须用独立 app 名（区别于基础名，互不阻塞）',
    );
  });

  test('抢锁失败弹框提示（便携版双击没反应的可见出口），仍 app.exit(0)，且只在独立非探测分支', () => {
    // 结构化提取整个 `if (STANDALONE && !DPI_PROBE && !app.requestSingleInstanceLock()) {…}` 块：
    // 弹框只许出现在这个（独立、非探测）分支里，插件/桥接/探测模式行为不受影响。
    const block =
      main.match(
        /if \(\s*STANDALONE\s*&&\s*!DPI_PROBE\s*&&\s*!app\.requestSingleInstanceLock\(\)\s*\)\s*\{[\s\S]*?\n\s*\}/,
      )?.[0] ?? '';
    assert.ok(block, '抢锁失败分支提取失败（结构须为 if (STANDALONE && !DPI_PROBE && !…Lock()) {…}）');
    assert.match(block, /showErrorBox/, '抢锁失败必须弹 showErrorBox（不能再静默 exit）');
    assert.match(block, /app\.exit\(0\)/, '弹框后仍须 app.exit(0)');
  });

  test('首帧显示要尊重 petsVisible（托盘隐藏后新窗口不得自己冒出来）', () => {
    const rts = main.match(/win\.once\('ready-to-show'[\s\S]*?\n\s*\}\);/)?.[0] ?? '';
    assert.ok(rts, 'ready-to-show 处理器必须在位（提取失败）');
    assert.match(rts, /petsVisible/, '独立模式首帧必须按 petsVisible 决定是否显示');
    // 首帧仍需真实可见，这里不许换成 showWithoutFocus（抢焦点只在用户主动亮窗时才需要考虑）
    assert.match(rts, /win\.show\(\)/, '首帧走 show()：非独立模式行为必须逐字不变');
  });

  test('托盘是唯一显式出口：window-all-closed 在独立模式不杀进程，before-quit 关迷你宿主', () => {
    assert.match(main, /new Tray\(/, '独立模式必须建托盘');
    const wac = extractHandler(main, 'window-all-closed');
    assert.ok(wac, '必须接线 window-all-closed');
    // 语义：回调第一行就让独立模式 return（不看后面的语句怎么写）
    assert.match(wac, /^\s*if \(STANDALONE\) return;/m, 'window-all-closed 第一行必须让独立模式豁免（托盘才是出口）');
    assert.match(main, /miniHost\.close\(\)/, 'before-quit 必须关迷你宿主');
  });

  test('noLlm=1 只经 loadFile query 注入，且仅 STANDALONE 携带', () => {
    const line = lineWith(main, "noLlm: '1'");
    assert.ok(line, 'query 里必须注入 noLlm=1');
    assert.match(line, /\.\.\.\(/, '必须以展开表达式并入 query（不是写死一个对象）');
    assert.match(line, /STANDALONE\s*\?/, '只有 STANDALONE 携带 noLlm');
    assert.match(line, /:\s*\{\}\)/, '非独立模式展开成空对象');
  });
});

describe('守卫：sprite.js 的 noLlm 消费走全局 params（Task 5 评审遗留）', () => {
  const sprite = readSource(helper + 'sprite.js');

  test('用 constants.js 的全局 params 单次解析（同 BRIDGE 先例），不得就地再 new URLSearchParams', () => {
    const line = lineWith(sprite, "params.get('noLlm')");
    assert.match(line, /\bNO_LLM\b\s*=\s*params\.get\('noLlm'\)\s*===\s*'1'/, 'NO_LLM 必须由全局 params 解析');
    assert.doesNotMatch(
      sprite,
      /new URLSearchParams\(location\.search\)\.get\('noLlm'\)/,
      'noLlm 必须复用全局 params（多处解析会漂移）',
    );
  });

  test('NO_LLM 挂上调试钩子（冒烟可观测 __dshPetDebug.noLlm）', () => {
    const line = lineWith(sprite, '__dshPetDebug.noLlm');
    assert.ok(line, '__dshPetDebug.noLlm 必须存在');
    assert.match(line, /if \(window\.__dshPetDebug\)/, '钩子必须防一手缺失（不裸赋值）');
    assert.match(line, /=\s*NO_LLM/, '挂的必须是 NO_LLM 本身');
  });
});

describe('start-standalone launcher', () => {
  // 启动器不经 tsc、Electron 没起来时什么断言都做不了——只能读源码钉结构（同本文件其余守卫）。
  // 一律「语义断言」：断某行/某形态存在或不存在，不看字符距离（禁止 [\s\S]{0,N}? 距离预算）。
  const launcher = readSource('../../scripts/start-standalone.mjs');

  test('必须删键而非设空串：劫持/外部宿主/冒烟变量都从 env 里 delete（issue #63 同 start-desktop）', () => {
    // delete env.X 的「删键」语义是硬要求（实测设空串会让 Electron 直接 abort）：
    // 逐条钉 delete 语句在位，写法（换行/注释）怎么变都不敏感
    for (const key of ['ELECTRON_RUN_AS_NODE', 'DSH_PET_CONFIG_URL', 'DSH_PET_HOST_PID', 'DSH_PET_SMOKE']) {
      assert.match(launcher, new RegExp(`delete\\s+env\\.${key}\\b`), `必须 delete env.${key}`);
    }
  });

  test("独立模式总闸由启动器注入：env 里设 DSH_PET_STANDALONE: '1'", () => {
    assert.match(launcher, /DSH_PET_STANDALONE\s*:\s*'1'/, "必须以对象字面量设 DSH_PET_STANDALONE: '1'");
  });

  test('负向：不得把 DSH_PET_HOST_PID 写成 env 赋值形态（防重新引入 host-pid 注入）', () => {
    // delete env.DSH_PET_HOST_PID 里 token 后随分号，命中不了 /DSH_PET_HOST_PID\s*:/；
    // 只有 `DSH_PET_HOST_PID: <值>` 这种注入形态才会命中——正是「桌宠独立存活、托盘才是出口」要禁的
    assert.doesNotMatch(launcher, /DSH_PET_HOST_PID\s*:/, 'start-standalone 不得注入 DSH_PET_HOST_PID');
  });

  test('前置检查在位：standalone-core.cjs 必须先构建才启动（缺失即报错退出，不静默半死）', () => {
    assert.match(launcher, /standalone-core\.cjs/, '必须前置校验 standalone-core.cjs 是否已构建');
  });
});

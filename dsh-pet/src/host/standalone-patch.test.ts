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

/**
 * 提取箭头函数回调体（含声明行）：从 `const <name> = (…) => {` 到其后第一个「独占一行、
 * 任意缩进的 };」。回调体多长都不敏感（往里头加注释/换行/语句都照样整段提出）。
 */
const extractArrow = (src: string, name: string): string =>
  src.match(new RegExp(`^\\s*const ${name} = \\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?^\\s*\\};`, 'm'))?.[0] ?? '';

/**
 * 提取类方法体（含签名行）：从 `  <name>(…) {` 到下一个「两空格缩进的 }」（内层语句是 4 空格，
 * 故终止边界唯一）。同 extractArrow：只看语义，不看行距/字符距离。
 */
const methodBody = (src: string, name: string): string =>
  src.match(new RegExp(`^  ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?^  \\}`, 'm'))?.[0] ?? '';

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
    // 钉到mini-host启动失败那一次调用自己的标题（main.js: dialog.showErrorBox('桌宠启动失败', …)）：
    // 若只断 /showErrorBox/，抢锁失败分支那弹（标题「dsh-pet 桌宠」）会空转满足断言——
    // 删掉启动失败弹框守卫照样绿，这里防的就是这个虚接。
    assert.match(
      main,
      /showErrorBox\(\s*'桌宠启动失败'/,
      '启动失败必须弹专属错误框（钉标题，不接受抢锁失败那弹的虚接）',
    );
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

describe('守卫：sprite.js 的素材缺失错误条（0.2.12 便携版隐形窗口的可见性兜底）', () => {
  // 这一整块兜底在 helper 里（不经 tsc、Electron 不起来什么断言都做不了），而它本身就是
  // 「构建成功但产物坏」的最后一道可见出口——出口自已在不在位只能读源码钉：
  // 0.2.12 那轮它恰好存在却永不触发（阈值不可达），所以只钉「有调用」不够，阈值语义也得钉住。
  const sprite = readSource(helper + 'sprite.js');

  test('switchTo 的加载兜底两头都接线：失败上报 noteAssetLoadFailure / 成功复位 clearAssetLoadFailure', () => {
    const guard = extractArrow(sprite, 'loadGuard');
    assert.ok(guard, 'loadGuard 回调体提取失败（结构须为 const loadGuard = (why) => {…}）');
    assert.match(guard, /this\.pending = null;/, '兜底必须先释放 pending（否则相同目标会被防重分支吞掉）');
    assert.match(
      guard,
      /this\.noteAssetLoadFailure\(why\)/,
      '兜底必须把失败上报给错误条（只 console.warn 就是隐形窗口）',
    );
    // 两条失败路径（10s 超时 / video error 事件）都得进同一个兜底，缺一即半边失效
    const calls = [...sprite.matchAll(/loadGuard\(/g)].length;
    assert.ok(calls >= 2, 'loadGuard 必须被超时与 onerror 两条路径共同调用（两处调用一个都不能少）');
    const ready = extractArrow(sprite, 'onReady');
    assert.ok(ready, 'onReady 回调体提取失败');
    assert.match(ready, /this\.clearAssetLoadFailure\(\)/, '成功就位必须复位计数（否则一次偶发失败永久滞留）');
  });

  test('错误条复用 #pet-error 的 .visible 开关（不新增样式），文案带素材源与两条可能成因', () => {
    const fn = methodBody(sprite, 'noteAssetLoadFailure');
    assert.ok(fn, 'noteAssetLoadFailure 方法体提取失败（必须存在且在类上）');
    assert.match(
      fn,
      /errorEl\.classList\.add\('visible'\)/,
      '必须点亮 #pet-error（与 renderer.js 配置错误同一节点、同一开关）',
    );
    assert.match(fn, /BASE/, '文案必须带素材源 BASE（含 mini-host 端口：能区分「包没打全」与「宿主没起来」）');
    assert.match(fn, /assets\/webm/, '文案必须点名 assets/webm（便携版事故的准确形态）');
    assert.match(
      fn,
      /用户目录覆盖素材损坏/,
      '文案还须提到用户目录覆盖素材损坏（mini-host /thumb 的回退链不止包内一处）',
    );
    assert.match(fn, /window\.__dshPetDebug\.assetFailures\s*=/, '失败计数必须挂上 __dshPetDebug（冒烟断言可观测）');
  });

  test('阈值按 everAssetOk 分档：从未成功加载过 ⇒ 首次失败即点亮（绝不残留写死的连败 <3）', () => {
    const fn = methodBody(sprite, 'noteAssetLoadFailure');
    assert.ok(fn, 'noteAssetLoadFailure 方法体提取失败');
    assert.match(fn, /this\.assetFailures\s*(\+=\s*1|=\s*\(this\.assetFailures[^)]*\)\s*\+\s*1)/, '必须自增失败计数');
    assert.match(
      fn,
      /everAssetOk\s*\?\s*3\s*:\s*1/,
      '阈值必须是 everAssetOk ? 3 : 1（没成功过 ⇒ 1：素材缺失时动画链走不下去，连败永远攒不满）',
    );
    // 反面：写死的 <3 就是旧版不可达阈值（那句「每次切动画都失败、总能攒够 3 次」的注释是错的）
    assert.doesNotMatch(fn, /<\s*3\b/, '不得残留写死的连败阈值 <3');
    assert.doesNotMatch(sprite, /必然连败/, '过时注释「必然连败」（阈值不可达的根源）不得重现');
  });

  test('已点亮后再失败只刷新文案里的次数（不重加 class、不重排 DOM）', () => {
    const fn = methodBody(sprite, 'noteAssetLoadFailure');
    assert.match(fn, /const msg =/, '文案先成形（点亮与后续刷新共用同一份）');
    assert.match(
      fn,
      /if \(this\.assetErrorShown\)\s*\{[\s\S]*?errorEl\.textContent[\s\S]*?return;/,
      'assetErrorShown 为真时必须走「只更新 textContent 再 return」的廉价分支',
    );
    // 点亮分支只能在首次：add('visible') 必须在 assetErrorShown 的早退之后（全文件只这一处 add）
    const adds = [...sprite.matchAll(/errorEl\.classList\.add\('visible'\)/g)].length;
    assert.equal(adds, 1, "noteAssetLoadFailure 里的 classList.add('visible') 必须唯一（刷新分支不得重加）");
  });

  test('恢复路径：置 everAssetOk + 计数归零，且只在错误条由本方法点亮时才收起（不误藏配置错误条）', () => {
    const fn = methodBody(sprite, 'clearAssetLoadFailure');
    assert.ok(fn, 'clearAssetLoadFailure 方法体提取失败');
    assert.match(fn, /this\.everAssetOk\s*=\s*true/, '成功就位必须登记 everAssetOk（否则阈值永远停在 1）');
    assert.doesNotMatch(fn, /everAssetOk\s*=\s*false/, 'everAssetOk 是单向棘轮（成功过就永不回退）');
    assert.match(fn, /this\.assetFailures\s*=\s*0/, '计数必须归零');
    assert.match(
      fn,
      /if \(!this\.assetErrorShown\) return;/,
      '收起前先过 assetErrorShown 守卫：#pet-error 与 renderer.js 配置错误条同节点，不是自己点亮的就不能替它藏',
    );
    const guardIdx = fn.indexOf('if (!this.assetErrorShown) return;');
    const removeIdx = fn.indexOf("errorEl.classList.remove('visible')");
    assert.ok(removeIdx > 0, '必须真的收起（classList.remove 缺失）');
    assert.ok(guardIdx < removeIdx, '守卫必须先于收起动作');
  });
});

describe('守卫：转向后紧跟移动的方向计算不得双重翻转（上游 bug 本地修）', () => {
  // 上游原版 dir = (facing==='right') !== turn.includes(上个动画名) ? 1 : -1：
  // facing 翻转已在 handleEnded/ended 完成，而选下一个动画时 this.anim/animRef 仍是转向名，
  // 亦或项再翻一次 → 转向→移动相邻时窗口位移与跑步画面方向相反。
  // 修法：dir 只看当前 facing。两端（sprite.js / pet.ts）同病同治，这里两头都钉。
  const sprite = readSource(helper + 'sprite.js');
  const pet = readSource('../client/pet.ts');

  test('sprite.js：dir 必须只由 facing 决定，不得残留 turn 亦或', () => {
    const line = lineWith(sprite, 'const dir =');
    assert.match(
      line,
      /const dir = this\.facing === 'right' \? 1 : -1;/,
      'dir 必须直取当前朝向（翻转向已在 handleEnded 做过）',
    );
    assert.doesNotMatch(line, /\bturn\b/, 'dir 行不得再掺入转向判断（双重翻转即本 bug 本体）');
  });

  test('pet.ts（浏览器端）：同款修复同步在位，不得单边回退', () => {
    const line = lineWith(pet, 'const dir =');
    assert.match(
      line,
      /const dir = facingRef\.current === 'right' \? 1 : -1;/,
      '浏览器端 dir 必须与桌面端同一语义（两端行为一致是本项目底线）',
    );
    assert.doesNotMatch(line, /\bturn\b/, 'dir 行不得再掺入转向判断');
  });
});

describe('守卫：漫游开关（moveEnabled）全链接线（桌面端新功能，菜单翻转→IPC 写盘→重启读回）', () => {
  const sprite = readSource(helper + 'sprite.js');
  const main = readSource(helper + 'main.js');
  const preload = readSource(helper + 'preload.js');

  test('sprite.js：moveOn 必须从 pet.moveEnabled 取（!== false：缺失默认开）', () => {
    const line = lineWith(sprite, 'this.moveOn =');
    assert.match(
      line,
      /this\.moveOn = this\.pet\.moveEnabled !== false;/,
      '初始化语义必须是「非 false 即开」（与 config.jsonc 内置默认 true 配套）',
    );
  });

  test('sprite.js：随机链抽到 move 必须改走分类；tryMove 第 0 道守卫拒演', () => {
    assert.match(
      sprite,
      /if \(k === 'move' && !this\.moveOn\) k = 'category';/,
      '关闭时随机链不得抽到移动（改走分类，池空回落 idle）',
    );
    const body = methodBody(sprite, 'tryMove');
    assert.match(
      body,
      /if \(!this\.moveOn\) return false;[\s\S]*moveRef !== null/,
      'tryMove 入口第一行就得多 moveOn 守卫（先于占用检查：关闭时点播/其它路径一律拦下）',
    );
  });

  test('sprite.js：菜单永远显示「漫游」开关项（关闭时也显示，否则再也打不开）；关闭时菜单树隐藏移动组', () => {
    assert.match(
      sprite,
      /label: this\.moveOn \? '漫游：开' : '漫游：关', action: 'toggle-roam'/,
      '开关项必须无条件 push（文字即状态）',
    );
    assert.match(
      sprite,
      /moves: \{ \.\.\.this\.animations\.moves, actions: \[\] \}/,
      '关闭时菜单树用 moves.actions 置空的浅拷贝（buildMenuTree 对空池自动省略「移动」分类）',
    );
  });

  test('sprite.js：翻转后持久化走 petBridge.savePetField（能力探测，桥缺失时静默仅当次生效）', () => {
    const fn = methodBody(sprite, 'onMenuAction');
    assert.match(fn, /this\.moveOn = !this\.moveOn;/, 'toggle-roam 必须真实翻转运行态');
    assert.match(
      fn,
      /window\.petBridge\) window\.petBridge\.savePetField\('moveEnabled', this\.moveOn\)/,
      '翻转后必须请求写盘（带 window.petBridge 存在守卫）',
    );
  });

  test('main.js：pet:save-field 处理器把守键白名单+布尔校验，写盘用发送窗口反查的 petId', () => {
    const handler = main.match(/ipcMain\.on\('pet:save-field'[\s\S]*?\n {2}\}\);/)?.[0] ?? '';
    assert.ok(handler, 'pet:save-field 处理器提取失败（必须存在）');
    assert.match(
      handler,
      /key !== 'moveEnabled' \|\| typeof value !== 'boolean'\) return;/,
      '必须只收 moveEnabled 键 + 布尔值（否则任意键都能写用户配置）',
    );
    assert.match(handler, /\[\.\.\.windows\.keys\(\)\]\.find/, 'petId 必须由发送窗口反查（渲染端报不了别人的 id）');
    assert.match(
      handler,
      /setUserPetField\(miniHost\.userFile/,
      '落盘必须走 mini-host 同源路径（与 /config 读同一份）',
    );
  });

  test('preload.js：savePetField 桥方法在位（渲染端唯一出口，不暴露裸 ipcRenderer）', () => {
    assert.match(preload, /savePetField\(key, value\)\s*\{/, 'contextBridge 必须暴露 savePetField');
    assert.match(preload, /ipcRenderer\.send\('pet:save-field', \{ key, value \}\)/, '桥体只转发固定通道与固定形状');
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

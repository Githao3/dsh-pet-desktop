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
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const helper = '../../runtime/electron-helper/';

/** 包内文件源码（守卫用；相对 src/host/ 解析） */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('守卫：main.js 的独立模式接线必须在位（设计文档 §2）', () => {
  const main = readSource(helper + 'main.js');

  test('总闸 = DSH_PET_STANDALONE 环境变量；包根解析（打包走 resourcesPath）', () => {
    assert.ok(/DSH_PET_STANDALONE === '1'/.test(main), '独立模式总闸必须存在');
    assert.ok(/dsh-pet-package/.test(main), '打包后包根必须落到 resources/dsh-pet-package（Task 8）');
  });

  test('mini-host 同进程接线：await initStandalone（配置损坏弹错误框退出，不静默半死）', () => {
    assert.ok(/require\('\.\/mini-host\.js'\)/.test(main), '必须接线 mini-host');
    assert.ok(/await initStandalone\(\{ packageRoot: PACKAGE_ROOT \}\)/.test(main), '必须 await 总装');
    assert.ok(/showErrorBox/.test(main), '启动失败必须弹错误框');
  });

  test('单实例锁必须排除 DPI 探测子进程（探测子进程继承 env，抢锁必失败自杀 → 永远探不到值）', () => {
    assert.ok(/STANDALONE && !DPI_PROBE && !app\.requestSingleInstanceLock\(\)/.test(main));
  });

  test('托盘是唯一显式出口：window-all-closed 在独立模式不杀进程，before-quit 关迷你宿主', () => {
    assert.ok(/new Tray\(/.test(main), '独立模式必须建托盘');
    assert.ok(
      /app\.on\('window-all-closed', \(\) => \{\s*if \(STANDALONE\) return;/.test(main),
      'window-all-closed 第一行必须让独立模式豁免（托盘才是出口）',
    );
    assert.ok(/miniHost\.close\(\)/.test(main), 'before-quit 必须关迷你宿主');
  });

  test('noLlm=1 只经 loadFile query 注入，且仅 STANDALONE 携带', () => {
    assert.ok(/\.\.\.\(STANDALONE \? \{ noLlm: '1' \} : \{\}\),/.test(main), 'query 展开必须条件注入');
  });
});

describe('守卫：sprite.js 的 noLlm 消费走全局 params（Task 5 评审遗留）', () => {
  const sprite = readSource(helper + 'sprite.js');

  test('用 constants.js 的全局 params 单次解析（同 BRIDGE 先例），不得就地再 new URLSearchParams', () => {
    assert.ok(/const NO_LLM = params\.get\('noLlm'\) === '1';/.test(sprite));
    assert.ok(
      !/new URLSearchParams\(location\.search\)\.get\('noLlm'\)/.test(sprite),
      'noLlm 必须复用全局 params（多处解析会漂移）',
    );
  });

  test('NO_LLM 挂上调试钩子（冒烟可观测 __dshPetDebug.noLlm）', () => {
    assert.ok(/window\.__dshPetDebug\)\s*window\.__dshPetDebug\.noLlm = NO_LLM/.test(sprite));
  });
});

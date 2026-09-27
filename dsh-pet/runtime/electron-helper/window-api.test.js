/**
 * 运行时窗口 API 净网测试 —— 直接对**打包进本仓库的那份 Electron** 断言：
 * BrowserWindow 暴露 showInactive()/hide（现身不抢焦点用的就是它），且从不存在的
 * showWithoutFocus 确实不存在（typeof undefined）。
 *
 * 为什么单独起一个 Electron 子进程：src/host/standalone-patch.test.ts 只能读 main.js 源码
 * 钉结构（helper 不经 tsc、Electron 没起来时什么运行时断言都做不了）；这里补上真机一跳，
 * 把「showInactive 是真函数、showWithoutFocus 是幻觉」钉成运行时事实。
 *
 * 由 npm run test:standalone 拉起（见 package.json 的 --test 文件列表）。探针窗口 show:false
 * + webPreferences.offscreen:true，但注意 offscreen ≠ headless-proof：Linux 上 Electron 启动
 * 仍需显示服务器（无 DISPLAY/WAYLAND_DISPLAY 直接 abort），故 headless Linux 整组 skip——
 * 与 src/host/helper-process.ts hasGraphicalDisplay 的判定口径一致（win32/darwin 放行，
 * linux 看 DISPLAY/WAYLAND_DISPLAY）。子进程 <3s 退出。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { writeFileSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// 解析仓库自带的 Electron 可执行文件：在纯 Node 下 require('electron') 直接返回二进制路径
const electronPath = require('electron');

// headless Linux：Electron 起不来（offscreen 也要显示服务器），整组 skip（见顶部注释）
const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

test('运行时：BrowserWindow 有 showInactive/hide，且 showWithoutFocus 确为幻觉', { skip: headless }, () => {
  // 临时探针主脚本（.cjs 强制 CommonJS，避开仓库根 type:module）。跑完即删。
  const probe = join(tmpdir(), `dshpet-window-api-${process.pid}-${Date.now()}.cjs`);
  writeFileSync(
    probe,
    [
      "const { app, BrowserWindow } = require('electron');",
      'app.disableHardwareAcceleration();',
      "app.on('ready', () => {",
      '  const win = new BrowserWindow({ show: false, width: 160, height: 160, webPreferences: { offscreen: true } });',
      "  const ok = typeof win.showInactive === 'function' && typeof win.hide === 'function' && typeof win.showWithoutFocus === 'undefined';",
      "  console.log('WINDOW_API_' + (ok ? 'OK' : 'FAIL') + ' showInactive=' + typeof win.showInactive + ' hide=' + typeof win.hide + ' showWithoutFocus=' + typeof win.showWithoutFocus);",
      '  app.exit(ok ? 0 : 1);',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  // ELECTRON_RUN_AS_NODE 会让内置 electron 模块不注册（helper 同款坑）——显式摘掉
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let res;
  try {
    res = spawnSync(electronPath, [probe], { env, timeout: 20000, encoding: 'utf8', windowsHide: true });
  } finally {
    try {
      unlinkSync(probe);
    } catch {
      /* 删不掉也不该让测试失败 */
    }
  }
  const out = String(res.stdout || '') + String(res.stderr || '');
  assert.match(
    out,
    /WINDOW_API_OK\b[^\n]*showInactive=function[^\n]*hide=function[^\n]*showWithoutFocus=undefined/,
    'Electron 探针未确认 showInactive/hide 为函数且 showWithoutFocus 不存在：' + out.slice(0, 400),
  );
  assert.equal(res.status, 0, 'Electron 探针退出码非 0（status=' + res.status + '）：' + out.slice(0, 400));
});

#!/usr/bin/env node
/**
 * start-standalone.mjs —— 独立桌宠一键启动（无 DSH 宿主、无 mock）。
 *
 * Electron 探测逻辑与 start-desktop 一致；主进程内 mini-host 自拉自建，
 * 不注入 DSH_PET_HOST_PID（桌宠不随本脚本退出而死，托盘才是出口）。
 *
 * 用法：npm run start:standalone
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const helperMain = resolve(here, '..', 'runtime', 'electron-helper', 'main.js');

// 平台适配：Electron 可执行文件相对路径（win32=electron.exe / darwin=Electron.app / linux=electron）
const PLAT = process.platform;
const electronRel =
  PLAT === 'win32'
    ? 'electron.exe'
    : PLAT === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

// 解析 Electron 可执行文件（不阻塞安装：提示用户先 ensure:electron）
const candidates = [
  process.env.DSH_PET_ELECTRON_PATH,
  process.env.ELECTRON_PATH,
  join(
    process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh'),
    'electron',
    electronRel,
  ),
];
const electron = candidates.find((value) => value && existsSync(value));
if (!electron) {
  console.error(
    '[start-standalone] Electron not found. Run `npm run ensure:electron` first or set DSH_PET_ELECTRON_PATH.',
  );
  process.exit(1);
}

// 前置检查：standalone-core.cjs 必须已构建（prepare / build:standalone-core 产物）
if (!existsSync(resolve(here, '..', 'runtime', 'electron-helper', 'standalone-core.cjs'))) {
  console.error('[start-standalone] standalone-core.cjs missing. Run `npm run build:standalone-core` first.');
  process.exit(1);
}

const env = {
  ...process.env,
  DSH_PET_STANDALONE: '1',
  DSH_PET_SCALE: process.env.DSH_PET_SCALE || '1',
};
// 删掉会劫持 Electron 启动模式的变量（issue #63）：同 start-desktop，必须**删键**不能设空串。
delete env.ELECTRON_RUN_AS_NODE;
// 独立模式不连外部宿主：config url 由主进程内的 mini-host 自己注入（见 mini-host.js initStandalone）。
delete env.DSH_PET_CONFIG_URL;
// 不注入宿主 PID：桌宠独立存活，本脚本退出（含终端关闭）后宠物照跑，托盘才是唯一出口。
delete env.DSH_PET_HOST_PID;
// 清理继承会话里的冒烟自退模式，避免污染日常启动。
delete env.DSH_PET_SMOKE;

console.log(`[start-standalone] electron: ${electron}`);
const child = spawn(electron, [helperMain], { env, stdio: 'inherit', windowsHide: false });
child.on('exit', (code, signal) => {
  console.log(`[start-standalone] helper exited (code=${String(code)}, signal=${String(signal)})`);
});

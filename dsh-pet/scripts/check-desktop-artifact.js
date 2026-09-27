#!/usr/bin/env node
/**
 * ============================================================================
 * check-desktop-artifact.js —— 桌面产物体检（dist:desktop 的收尾门禁）
 * ============================================================================
 *
 * 【为什么需要它】
 *   0.2.12 的便携版 exe 上线后「双击没反应 / 桌面看不见桌宠」：electron-builder
 *   26.15.3 在同一次构建里让 nsis 与 portable 共用同一份 app-64.7z 缓存，而默认
 *   nsis.preCompressedFileExtensions 会把 .webm 从该归档里排除、改由 NSIS File 指令
 *   另投——portable 分支恰好跳过这步投递，于是 106 个动画素材一个都没进便携版
 *   （exe 少 54MB，运行期所有 video 加载失败，透明窗口什么都不显示 = 隐形窗口）。
 *   构建成功、退出码 0、日志无异常——**坏产物是静默产出的**。本脚本把「素材数量」
 *   当成硬门禁：任何一项不齐直接非零退出，坏产物出不了 dist:desktop。
 *
 * 【检查项】
 *   1. win-unpacked 里的 assets/webm 数量 == 源目录 assets/webm 数量
 *      （extraResources 白名单漏抄/素材目录被清 → 这里先红）
 *   2. 便携版 exe 内部（7z payload）的 .webm 数量 == 源目录数量
 *      （本次事故的确切形态：只有这项能抓到）
 *   3. |便携版 − 安装包| 体积差 < 阈值（默认 20MB；素材整体缺失时差值≈素材体积，
 *      作为 2 的独立交叉验证——两条不同证据同时变红才放行发布的可能为 0）
 *
 * 【环境变量（排障/自检用）】
 *   DSH_DIST_DIR         产物目录（默认 <包根>/dist-desktop）——想验证本脚本真能
 *                        抓坏产物：指到一个空目录即可看到非零退出
 *   DSH_WEBM_SRC_DIR     源素材目录（默认 <包根>/assets/webm）
 *   DSH_7ZA              7za 可执行文件路径（默认自动探测 app-builder-bin 与
 *                        electron-builder 的 7zip 缓存）
 *   DSH_MAX_SIZE_GAP_MB  体积差阈值，MB（默认 20）
 * ============================================================================
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 包根目录（scripts/ 的上一级；与 prepack-check.js 同一口径）
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(process.env.DSH_DIST_DIR || join(ROOT, 'dist-desktop'));
const SRC_WEBM = resolve(process.env.DSH_WEBM_SRC_DIR || join(ROOT, 'assets', 'webm'));
const MAX_GAP_MB = Number(process.env.DSH_MAX_SIZE_GAP_MB || 20);
const TAG = '[check-desktop-artifact]';

const fail = (msg) => {
  console.error(`${TAG} FAIL: ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`${TAG} ok: ${msg}`);
const info = (msg) => console.log(`${TAG} note: ${msg}`);

// ---- 0. 产物目录与 exe 就位 ----
if (!existsSync(DIST)) {
  console.error(`${TAG} FAIL: 产物目录不存在：${DIST}（先跑 electron-builder --win）`);
  process.exit(1);
}
const exes = readdirSync(DIST).filter((n) => n.endsWith('.exe') && !n.includes('uninstaller'));
const portable = exes.find((n) => !/setup/i.test(n));
const setup = exes.find((n) => /setup/i.test(n));
if (!portable) fail(`没找到便携版 exe（dist-desktop 里除 Setup 外的 .exe）；现有：${exes.join(', ') || '（无）'}`);
if (!setup) info(`没找到安装包 exe，跳过体积差比对（现有：${exes.join(', ') || '（无）'}）`);

// ---- 1. 源素材数量（一切断言的基准） ----
const countWebm = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.webm')).length : -1);
const srcCount = countWebm(SRC_WEBM);
if (srcCount <= 0) {
  console.error(`${TAG} FAIL: 源素材目录 ${SRC_WEBM} 里没有 .webm（基准都没了，检查仓库是否完整/是否被清理脚本误删）`);
  process.exit(1);
}
ok(`源素材 assets/webm = ${srcCount} 个 .webm`);

// ---- 2. win-unpacked 的素材必须与源目录等量 ----
const unpackedWebm = join(DIST, 'win-unpacked', 'resources', 'dsh-pet-package', 'assets', 'webm');
const unpackedCount = countWebm(unpackedWebm);
if (unpackedCount < 0) fail(`win-unpacked 素材目录不存在：${unpackedWebm}（extraResources 白名单漏了 assets/webm？）`);
else if (unpackedCount !== srcCount)
  fail(
    `win-unpacked 素材不齐：${unpackedWebm} 只有 ${unpackedCount} 个 .webm，源目录有 ${srcCount} 个` +
      '（构建中途素材被占用/清理过？删掉 dist-desktop 重新 npm run dist:desktop）',
  );
else ok(`win-unpacked 素材齐：${unpackedCount}/${srcCount}`);

// ---- 3. 便携版 exe 内部（7z payload）的 .webm 数量：本次事故的直接判据 ----
/** 找 7za：显式指定 > app-builder-bin > electron-builder 的 7zip 缓存（本地/用户级） */
function find7za() {
  const candidates = [
    process.env.DSH_7ZA,
    join(ROOT, 'node_modules', 'app-builder-bin', 'win', 'x64', '7za.exe'),
    join(ROOT, '..', 'electron-builder-cache'),
    join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
  ].filter(Boolean);
  const hit = [];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (/7za(\.exe)?$/i.test(c)) {
      hit.push(c);
      continue;
    }
    // 缓存目录形如 7zip@1.0.0/7zip-win-x64-<hash>/bin/7za.exe（层级随版本变，故浅递归找）
    const walk = (dir, depth) => {
      if (depth > 3) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) {
          if (/^7za\.exe$/i.test(e.name)) hit.push(join(dir, e.name));
          continue;
        }
        walk(join(dir, e.name), depth + 1);
      }
    };
    walk(c, 0);
    if (hit.length) break;
  }
  return hit[0] || null;
}

/** 列 exe 内嵌归档，返回 { webm, files }（files = 归档里的文件总数） */
function inspectPayload(bin, exe) {
  let out;
  try {
    out = execFileSync(bin, ['l', exe], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // 7za 对「归档后还有数据」这类告警可能非零退出，但列表本身已打到 stdout：照用
    if (!e.stdout) throw e;
    out = String(e.stdout);
  }
  const lines = out.split(/\r?\n/);
  const webm = lines.filter((l) => /\.webm\s*$/i.test(l)).length;
  const summary = [...lines].reverse().find((l) => /\d+ files?(,|：)?/.test(l) && /folders?/.test(l));
  const files = summary ? Number((summary.match(/([\d,]+)\s+files/)?.[1] || '0').replace(/,/g, '')) : 0;
  return { webm, files };
}

const sevenZip = find7za();
if (!sevenZip) {
  fail(
    '找不到 7za（无法核对便携版内部素材）。用 DSH_7ZA 指定路径，' +
      '或先跑一次 npm run dist:desktop 让 electron-builder 下载 7zip 缓存',
  );
} else if (portable) {
  const exe = join(DIST, portable);
  info(`7za = ${sevenZip}`);
  const { webm, files } = inspectPayload(sevenZip, exe);
  if (webm !== srcCount)
    fail(
      `便携版 ${portable} 内部 .webm 数量与源目录不符（内部 ${webm}，源 ${srcCount}，payload 共 ${files} 个文件）——` +
        '内部为 0（或明显少于源）就是 0.2.12 隐形窗口的形态：素材没进 payload。' +
        '先确认 electron-builder.yml 里 nsis.preCompressedFileExtensions: null（portable 与 nsis 共用' +
        '归档缓存时，webm 一旦被排除出归档就彻底丢失），再删掉 dist-desktop 全量重建',
    );
  else ok(`便携版 ${portable} 内部素材齐：${webm}/${srcCount}（payload 共 ${files} 个文件）`);
}

// ---- 4. 体积差交叉验证（独立于 7za：素材整块缺失时差值≈素材体积） ----
if (portable && setup) {
  const pSize = statSync(join(DIST, portable)).size;
  const sSize = statSync(join(DIST, setup)).size;
  const gapMB = Math.abs(pSize - sSize) / 1024 / 1024;
  info(
    `体积：便携版 ${(pSize / 1024 / 1024).toFixed(1)}MB，安装包 ${(sSize / 1024 / 1024).toFixed(1)}MB，` +
      `差 ${gapMB.toFixed(1)}MB`,
  );
  if (gapMB >= MAX_GAP_MB)
    fail(
      `便携版与安装包体积差 ${gapMB.toFixed(1)}MB ≥ ${MAX_GAP_MB}MB —— 便携版大概率整块缺素材` +
        `（0.2.12 事故当时是 54.4MB）。核对第 3 项并全量重建`,
    );
  else ok(`体积差 ${gapMB.toFixed(1)}MB < ${MAX_GAP_MB}MB`);
}

// ---- 汇总 ----
if (process.exitCode) {
  console.error(`\n${TAG} 产物不合格，别发布、别分发。修好后重跑：npm run dist:desktop`);
  process.exit(1);
}
console.log(`\n${TAG} 全部通过 —— 便携版素材完整，产物可分发。`);

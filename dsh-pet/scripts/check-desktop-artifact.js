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
 *   0. 产物目录里只认「文件名含当前 package.json 版本」的 exe（构建失败的门禁本身）
 *      dist-desktop 不清旧产物：改完版本号重新构建后，目录里会同时躺着上一版的 exe。
 *      只看后缀 + mtime 挑，就可能把旧版 exe 当成本轮产物验一遍（全绿、却验错了对象）；
 *      一个同版本 exe 都没有时，必须直接 FAIL 并说清怎么修，而不是拿陈货充数。
 *   1. win-unpacked 里的 assets/webm 数量 == 源目录 assets/webm 数量
 *      （extraResources 白名单漏抄/素材目录被清 → 这里先红）
 *   2. 便携版 exe 内部（7z payload）的 .webm 数量 == 源目录数量
 *      （本次事故的确切形态：只有这项能抓到）
 *   3. |便携版 − 安装包| 体积差 < 阈值（默认 20MB；素材整体缺失时差值≈素材体积，
 *      作为 2 的独立交叉验证——两条不同证据同时变红才放行发布的可能为 0）
 *
 * 【环境变量（排障/自检用）】
 *   DSH_DIST_DIR         产物目录（默认 <包根>/dist-desktop）——想验证本脚本真能
 *                        抓坏产物：指到一个只躺着旧版本 exe 的目录（或空目录），
 *                        就能看到第 0 项直接非零退出
 *   DSH_WEBM_SRC_DIR     源素材目录（默认 <包根>/assets/webm）
 *   DSH_7ZA              7za 可执行文件路径（默认探测顺序：ELECTRON_BUILDER_CACHE →
 *                        用户级 electron-builder 缓存 → 仓库内缓存 → app-builder-bin）
 *   DSH_MAX_SIZE_GAP_MB  体积差阈值，MB（默认 20；非有限正数一律回落 20 并报一行）
 * ============================================================================
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 包根目录（scripts/ 的上一级；与 prepack-check.js 同一口径）
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(process.env.DSH_DIST_DIR || join(ROOT, 'dist-desktop'));
const SRC_WEBM = resolve(process.env.DSH_WEBM_SRC_DIR || join(ROOT, 'assets', 'webm'));
const TAG = '[check-desktop-artifact]';

const fail = (msg) => {
  console.error(`${TAG} FAIL: ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`${TAG} ok: ${msg}`);
const info = (msg) => console.log(`${TAG} note: ${msg}`);

// 本轮产物的版本身份证（第 0 项检查的依据）：package.json 是唯一来源
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// 阈值只认有限正数：Number('abc')=NaN 会把比较变成恒假（gap >= NaN 为 false，
// 于是门禁静默放行）；Number('0')=0 又会让任何非零差值都判红——两者都不是用户本意。
const GAP_ENV = process.env.DSH_MAX_SIZE_GAP_MB;
const GAP_RAW = Number(GAP_ENV);
const MAX_GAP_MB = Number.isFinite(GAP_RAW) && GAP_RAW > 0 ? GAP_RAW : 20;
if (GAP_ENV != null && GAP_RAW !== MAX_GAP_MB) {
  info(`DSH_MAX_SIZE_GAP_MB=${JSON.stringify(GAP_ENV)} 不是有效正数，已回落默认 ${MAX_GAP_MB}MB`);
}

// ---- 0. 产物目录与 exe 就位（只认当前版本名的 exe） ----
if (!existsSync(DIST)) {
  console.error(`${TAG} FAIL: 产物目录不存在：${DIST}（先跑 electron-builder --win）`);
  process.exit(1);
}
const allExes = readdirSync(DIST).filter((n) => n.endsWith('.exe') && !n.includes('uninstaller'));
// 版本过滤：文件名里不含当前版本的 exe 一律不认（它们是上一轮构建的遗留）
const exes = allExes.filter((n) => n.includes(VERSION));
const staleExes = allExes.filter((n) => !n.includes(VERSION));
if (staleExes.length) info(`忽略非本轮版本（${VERSION}）的遗留 exe：${staleExes.join(', ')}`);
if (!exes.length) {
  console.error(
    `${TAG} FAIL: ${DIST} 里没有文件名含当前版本 ${VERSION} 的 exe` +
      `（目录里的 exe：${allExes.join(', ') || '（一个都没有）'}）。\n` +
      `  多半是产物目录只躺着旧版本（改了版本号却没清目录，或本轮 electron-builder 根本没产出）——` +
      `门禁不验陈货：删掉 ${DIST} 后重跑 npm run dist:desktop`,
  );
  process.exit(1);
}
ok(`本轮版本 ${VERSION} 的 exe：${exes.join(', ')}`);
// 同类型多个（部分重建留下的同名不同时间文件）：取 mtime 最新的那个作为本轮产物
const newest = (list) => [...list].sort((a, b) => statSync(join(DIST, b)).mtimeMs - statSync(join(DIST, a)).mtimeMs)[0];
const portable = newest(exes.filter((n) => !/setup/i.test(n)));
const setup = newest(exes.filter((n) => /setup/i.test(n)));
if (!portable)
  fail(`没找到便携版 exe（文件名含 ${VERSION} 且不带 Setup 的 .exe）；候选：${exes.join(', ') || '（无）'}`);
if (!setup) info(`没找到安装包 exe，跳过体积差比对（候选：${exes.join(', ') || '（无）'}）`);

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
/**
 * 找 7za（按优先级逐个试，命中即返）：
 *   DSH_7ZA → ELECTRON_BUILDER_CACHE（本轮构建真在用的那份缓存，只有它不会指错地方）
 *   → 用户级默认缓存 → 仓库内缓存（ROOT/../electron-builder-cache 只在「包目录 = 工作区
 *   根下一层」这个布局里成立，当成唯一路径就是默认构建机永远保持这份本地布局）
 *   → app-builder-bin（electron-builder 26 已不随附它，本仓库里这个路径根本不存在：
 *   探不到是常态，故排到最末当兜底，不再占第一顺位）。
 */
function find7za() {
  const candidates = [
    process.env.DSH_7ZA,
    process.env.ELECTRON_BUILDER_CACHE && resolve(process.env.ELECTRON_BUILDER_CACHE),
    join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
    join(ROOT, '..', 'electron-builder-cache'),
    join(ROOT, 'node_modules', 'app-builder-bin', 'win', 'x64', '7za.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (/7za(\.exe)?$/i.test(c)) return c;
    // 缓存目录形如 7zip@1.0.0/7zip-win-x64-<hash>/bin/7za.exe（层级随版本变，故浅递归找）
    const hit = walkFor7za(c, 0);
    if (hit) return hit;
  }
  return null;
}

/**
 * 限深 3 层找 7za.exe。readdirSync 必须包 try/catch：缓存目录里常有半截解包的临时子树
 * 与无权限目录（NTFS 重解析点/被占用的文件），一个进不去的目录不该把整个门禁带崩。
 */
function walkFor7za(dir, depth) {
  if (depth > 3) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // 整层读不动：跳过这棵子树，回到调用方继续试下一个候选
  }
  for (const e of entries) {
    if (!e.isDirectory()) {
      if (/^7za\.exe$/i.test(e.name)) return join(dir, e.name);
      continue;
    }
    const hit = walkFor7za(join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
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

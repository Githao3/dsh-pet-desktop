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
const { homedir } = require('node:os');
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
const extOf = (p) => p.slice(p.lastIndexOf('.')).toLowerCase();
/** 整文件流式应答（与上游宿主一致：不支持 Range，素材为短小 webm） */
function sendFile(res, path) {
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
/** 根目录内安全解析：拼接后必须仍在 root 内（防 .. 穿越），普通文件存在才返回 */
function resolveExisting(root, rel) {
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : undefined;
}

/**
 * 起迷你宿主。
 * @param packageRoot:string, dshHome?:string, port?:number opts
 *   packageRoot = dsh-pet 包根（assets 所在）；dshHome 缺省 = env DSH_HOME || ~/.dsh
 * @returns {Promise<{server, url:string, close():Promise<void>}>}
 */
async function createMiniHost({ packageRoot, dshHome, port = 0 }) {
  const home = dshHome || process.env.DSH_HOME || join(homedir(), '.dsh');
  const paths = core.petPaths(packageRoot, home);
  const userRoot = join(home, 'dsh-pet');
  // 首次运行落初始用户配置（已存在绝不覆盖——用户手写文件优先）
  core.ensureStarterUserConfig(paths.userFile);
  // LLM 配置占位（规格 §2.2/§6）：第二阶段读它实装 /whisper /chat，第一阶段仅存默认禁用态
  const settingsFile = join(userRoot, 'standalone-settings.json');
  if (!existsSync(settingsFile)) {
    mkdirSync(userRoot, { recursive: true });
    writeFileSync(
      settingsFile,
      JSON.stringify({ llm: { enabled: false, apiBase: '', apiKey: '', model: '' } }, null, 2) + '\n',
      'utf8',
    );
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      if (!pathname.startsWith(PREFIX + '/')) return text(res, 404, 'mini-host: outside prefix');
      const rest = decodeURIComponent(pathname.slice(PREFIX.length + 1));
      const [scope, ...parts] = rest.split('/');

      if (scope === 'config') return json(res, 200, core.mergedConfig(packageRoot, home), true);
      if (scope === 'font') {
        const f = resolveExisting(join(packageRoot, 'assets', 'fonts'), parts.join('/'));
        return f ? sendFile(res, f) : text(res, 404, 'font not found');
      }
      if (scope === 'pic') {
        const isMeme = parts[0] === 'memes';
        const root = join(packageRoot, 'assets', isMeme ? 'memes' : 'pic');
        const f = resolveExisting(root, (isMeme ? parts.slice(1) : parts).join('/'));
        return f ? sendFile(res, f) : text(res, 404, 'pic not found');
      }
      if (scope === 'thumb') {
        const [petId, ...nameParts] = parts;
        const fileName = nameParts.join('/');
        if (!petId || !fileName || ID_FORBIDDEN.test(petId)) return text(res, 400, 'invalid pet id or path');
        const ext = extOf(fileName);
        if (ext !== '.webm' && ext !== '.mov') return text(res, 400, 'unsupported animation format');
        const packDir = join(userRoot, 'pet', petId + '-animation');
        const sub = ext === '.mov' ? 'mov' : 'webm';
        const from = existsSync(packDir)
          ? resolveExisting(packDir, fileName)
          : (resolveExisting(join(userRoot, 'main-animation', sub), fileName) ??
            resolveExisting(join(packageRoot, 'assets', sub), fileName));
        return from ? sendFile(res, from) : text(res, 404, 'asset not found');
      }
      if (scope === 'broadcast') return json(res, 200, { ok: true, text: '', ts: 0 }, true);
      if (scope === 'work-status') return json(res, 200, { ts: 0, state: null, task: null }, true);
      if (scope === 'notify') return json(res, 200, { ok: true, seq: 0, frames: [] }, true);
      if (scope === 'balance' || rest === 'balance/trigger' || scope === 'whisper' || scope === 'chat') {
        return json(res, 501, { error: 'dsh-pet standalone: not available in phase 1 (needs credentials / LLM)' });
      }
      return text(
        res,
        400,
        'mini-host: expected /config | /thumb/<id>/<f> | /font | /pic | /broadcast | /work-status | /notify',
      );
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const bound = server.address().port;
  return {
    server,
    url: `http://127.0.0.1:${bound}`,
    close: () =>
      new Promise((ok) => {
        server.close(ok);
        // 只靠 server.close() 会等 keep-alive 套接字自己超时（实测 ~3s 才回 close 事件，
        // 表现为退出应用时白等 3 秒）——客户端是本地渲染端，关停时无需保留任何连接
        server.closeAllConnections();
      }),
  };
}

/**
 * 独立模式总装：起宿主 + 注入 main.js 依赖的两个环境变量（DSH_PET_CONFIG_URL / DSH_PET_PETS）。
 * main.js 只 require 本文件并 await 这一个函数。配置损坏时异常上抛（由 main.js 弹错误框）。
 */
async function initStandalone({ packageRoot }) {
  const host = await createMiniHost({ packageRoot });
  process.env.DSH_PET_CONFIG_URL = host.url + PREFIX + '/config';
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const list = core.desktopPetList(packageRoot, home);
  if (list.length) process.env.DSH_PET_PETS = JSON.stringify(list);
  return host;
}

module.exports = { createMiniHost, initStandalone };

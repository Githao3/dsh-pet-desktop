/**
 * mini-host.js —— 独立桌面应用的"迷你宿主"：本地 127.0.0.1 HTTP 服务，
 * 按上游 /dsh-pet-7340/* 路由契约就地应答（渲染端零感知）。
 *
 * 端点策略（设计文档 §2/§3）：
 *   /config            readAllConfig 成品聚合 + 读时覆盖（balanceEnabled 强制关，见 applyStandaloneOverrides；
 *                      首次运行先写初始用户层：关余额/桌面显示）
 *   /thumb/<id>/<f>    素材：pet/<id>-animation 专属目录 → 用户 main-animation/webm → 包内 assets/webm
 *   /font/<f> /pic/<f> 包内静态图/字体（pic/memes/* 归 memes 目录，与上游同规则）
 *   /broadcast /work-status /notify   空转（"无事发生"形状，客户端轮询恒定不触发）
 *   /balance* /whisper(/trigger) /chat  501（第一阶段无凭据/无 LLM；第二阶段就地实装）
 *     精确到 GET /chat：上游 GET /chat 是读 memory.json（读端点，501 才是诚实答案）；
 *     POST /chat 是写端点，第一阶段先被下面的"非 GET/HEAD → 405"方法门拦下，不会走到 501
 *   非 GET/HEAD 一律 405；Host 非 127.0.0.1[:port] 一律 403（挡 DNS rebinding）
 *
 * 纯 Node（不 require electron）——可被 main.js 同进程调用，也可独立单测。
 */
'use strict';
const { createServer } = require('node:http');
const fs = require('node:fs');
const { createReadStream, existsSync, statSync, mkdirSync, writeFileSync } = require('node:fs');
const { join, normalize, sep } = require('node:path');
const { homedir } = require('node:os');
const core = require('./standalone-core.cjs');

const PREFIX = '/dsh-pet-7340';
/** 与上游 src/host/config.ts L42 的 ID_FORBIDDEN 同一对象（经 standalone-core 打包再导出，防镜像漂移） */
const { ID_FORBIDDEN } = core;
/** 渲染端是 file://（null 源）跨源取 127.0.0.1 宿主，与 main.js bridge 分支同一处理；
 *  实证 Task1 冒烟可跑，仍显式加头保 Electron 版本演进安全 */
const CORS = { 'access-control-allow-origin': '*' };
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
    ...CORS,
  });
  res.end(body);
};
const text = (res, status, msg) => {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(msg),
    ...CORS,
  });
  res.end(msg);
};
const extOf = (p) => p.slice(p.lastIndexOf('.')).toLowerCase();
/**
 * 整文件流式应答：与上游 index.ts sendFile 同源（含 issue #62 修复：stat/流尺寸不一致会
 * 永久 stall，客户端弃读时释放 fd）。长度取自正在读的 fd（open 事件里 fstat），不先 stat 再另开流。
 */
function sendFile(res, path) {
  const stream = createReadStream(path);
  stream.once('open', (fd) => {
    if (res.destroyed || res.writableEnded) {
      stream.destroy(); // 客户端在开流前就放弃了
      return;
    }
    try {
      res.writeHead(200, {
        'content-type': MIME[extOf(path)] ?? 'application/octet-stream',
        'content-length': fs.fstatSync(fd).size,
        'cache-control': 'public, max-age=3600',
        ...CORS,
      });
    } catch {
      // 极端情况下 fstat 拿不到：不发长度头，交给 Node 用 chunked 收尾（长度天然一致，只是没声明）
      res.writeHead(200, {
        'content-type': MIME[extOf(path)] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
        ...CORS,
      });
    }
    stream.pipe(res);
  });
  // 读失败（文件被删/权限/被占用）：头未发则 404，随后断连——让客户端立刻看到失败，而不是无限等待
  stream.on('error', () => {
    if (!res.headersSent) text(res, 404, 'file not readable');
    res.destroy();
  });
  // 客户端提前断开（快速切动画时高频发生）→ 停读释放 fd，别把整个文件读完
  res.on('close', () => stream.destroy());
}
/** 根目录内安全解析：拼接后必须仍在 root 内（防 .. 穿越），普通文件存在才返回 */
function resolveExisting(root, rel) {
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : undefined;
}

/**
 * 读时覆盖：对 mergedConfig 的成品聚合就地改写后返回（同一对象）。
 * 只对 /config 响应生效——用户磁盘上的 main-config.json 一个字节都不动（设计文档 §3.2：
 * 迷你宿主读配置时注入默认覆盖，不改包内 config.jsonc，更不回写用户文件）。
 * 必要性：存量用户文件里 balanceEnabled 可能是 true（上游 DSH 环境下的合法配置），
 * 只在首跑写 starter 拦不住它们；不覆盖的话右键仍出「查看余额」→ /balance 501 → 渲染端
 * getWithRetry 重试 3 次后抛错记日志，且每 30min（eventsRefreshSec.balance）递归再来一轮。
 */
function applyStandaloneOverrides(merged) {
  for (const entry of Object.values(merged)) {
    // 第一阶段无凭据管道，设计文档 §3.2 读时覆盖；第二阶段实装凭据后移除
    if (Array.isArray(entry?.pets)) {
      for (const pet of entry.pets) {
        if (pet && typeof pet === 'object') pet.balanceEnabled = false;
      }
    }
  }
  return merged;
}
// 覆盖为何不必落在 initStandalone 的 desktopPetList 上（保持此推导与代码同步）：
// standalone-entry.ts 的 desktopPetList = flattenPetList(...).filter(display).map(({id,size}))，
// 注入 env DSH_PET_PETS 的清单只有 id/size 两个字段，balanceEnabled 在其中不存在，
// 窗口开不开、开多大与余额无关；余额门控的唯一消费路径就是 /config → 覆盖只需挂在 /config。
// （未来若 desktopPetList 扩字段或菜单改读 env，须回头补这里。）

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
      // 挡 DNS rebinding 与 Host 伪造：服务只在 127.0.0.1 界面监听，这层是纵深防御
      const hostHeader = String(req.headers.host ?? '');
      if (!/^127\.0\.0\.1(?::\d+)?$/.test(hostHeader)) return text(res, 403, 'bad host');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      if (!pathname.startsWith(PREFIX + '/')) return text(res, 404, 'mini-host: outside prefix');
      // 第一阶段无写端点，405 是唯一诚实答案；第二阶段将在此放行 POST /chat、POST /balance/trigger 等
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      let rest;
      try {
        rest = decodeURIComponent(pathname.slice(PREFIX.length + 1));
      } catch {
        return text(res, 400, 'bad percent-encoding');
      }
      const [scope, ...parts] = rest.split('/');

      // 除 font/pic/thumb（前缀下还有子路径，只能按 scope 分流）外，一律整路径精确匹配：
      // /config/meta 这类画蛇添足的子路径落尾部 400，与上游路由表同样不静默受理
      if (rest === 'config')
        return json(res, 200, applyStandaloneOverrides(core.mergedConfig(packageRoot, home)), true);
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
      if (rest === 'broadcast') return json(res, 200, { ok: true, text: '', ts: 0 }, true);
      if (rest === 'work-status') return json(res, 200, { ts: 0, state: null, task: null }, true);
      // 与上游 /notify 路由同形状（seq/frames 契约镜像，客户端轮询恒空转）：桌面渲染端今天
      // 不消费它（系统通知是浏览器侧能力，main.js 走的是 Electron Notification），但保留应答以
      // 维持路由契约完整——未来渲染端对齐上游或浏览器组件复用 mini-host 时不必先补端点。
      if (rest === 'notify') return json(res, 200, { ok: true, seq: 0, frames: [] }, true);
      // whisper/trigger 与 balance/trigger 同语义：桌面渲染端右键菜单"碎碎念"手动触发走它，
      // 上游是精确路由（非前缀），这里也必须整段命中 501，否则被降级成尾部 400
      if (
        rest === 'balance' ||
        rest === 'balance/trigger' ||
        rest === 'whisper' ||
        rest === 'whisper/trigger' ||
        rest === 'chat'
      ) {
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

  // listen 失败（端口被占等）必须上抛——独立模式下静默失败 = 渲染端永远拿不到数据
  await new Promise((ok, err) => {
    server.once('error', err);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', err);
      ok();
    });
  });
  const bound = server.address().port;
  return {
    server,
    url: `http://127.0.0.1:${bound}`,
    close: () =>
      new Promise((ok, err) => {
        // 只靠 server.close() 会等 keep-alive 套接字自己超时（实测 ~3s 才回 close 事件，
        // 表现为退出应用时白等 3 秒）——客户端是本地渲染端，关停时无需保留任何连接
        server.closeAllConnections();
        server.close((e) => (e ? err(e) : ok()));
      }),
  };
}

/**
 * 独立模式总装：起宿主 + 注入 main.js 依赖的两个环境变量（DSH_PET_CONFIG_URL / DSH_PET_PETS）。
 * main.js 只 require 本文件并 await 这一个函数。配置损坏时异常上抛（由 main.js 弹错误框）。
 * @param packageRoot:string, dshHome?:string, port?:number opts（port 缺省 0 = 随机端口，显式传入只为可测）
 */
async function initStandalone({ packageRoot, dshHome, port = 0 }) {
  // home 只推导一次：createMiniHost 与 desktopPetList 必须看到同一个数据根
  const home = dshHome || process.env.DSH_HOME || join(homedir(), '.dsh');
  const host = await createMiniHost({ packageRoot, dshHome: home, port });
  // createMiniHost 返回时端口**已经占住**，而它后面第一个真正读配置的就是 desktopPetList
  // （createMiniHost 全程不碰 config，mergedConfig 只在请求里跑）——所以这条 listen 之后的窗口期里
  // 任何异常都必须先关服务再上抛：否则 host 随异常一起丢掉，调用方永远拿不到它，端口留在监听里
  // （主进程那边却是弹错误框退出，用户看到的是「报错窗 + 一个被白占的端口」）。
  try {
    process.env.DSH_PET_CONFIG_URL = host.url + PREFIX + '/config';
    const list = core.desktopPetList(packageRoot, home);
    if (list.length) process.env.DSH_PET_PETS = JSON.stringify(list);
  } catch (e) {
    await host.close().catch(() => {}); // 关不掉也不掩盖原始异常
    throw e;
  }
  return host;
}

module.exports = { createMiniHost, initStandalone, applyStandaloneOverrides };

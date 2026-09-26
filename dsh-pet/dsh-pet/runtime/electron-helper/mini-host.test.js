/**
 * mini-host 测试 —— 独立桌宠迷你宿主的端点契约（node:test + 真起 HTTP 服务）。
 * 前置：先 npm run build:standalone-core（本测试 require 其产物 standalone-core.cjs）。
 * 运行：npm run test:standalone
 */
'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createMiniHost } = require('./mini-host.js');

const dirs = [];
// 兜底登记：断言失败时测试体里的 host.close() 走不到，遗留的监听服务会挂住整个 runner
// （node --test 等子进程退出 → 永久卡死），故每个 host 都登记，afterEach 统一关
const live = [];
const track = (h) => {
  live.push(h);
  return h;
};
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'dshpet-mh-'));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  while (live.length)
    await live
      .pop()
      .close()
      .catch(() => {});
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** 造一个最小"包根 + 数据根"夹具，返回 {packageRoot, dshHome} */
function fixture() {
  const packageRoot = tmp();
  const dshHome = tmp();
  mkdirSync(join(packageRoot, 'assets', 'webm'), { recursive: true });
  mkdirSync(join(packageRoot, 'assets', 'fonts'), { recursive: true });
  mkdirSync(join(packageRoot, 'assets', 'pic'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'assets', 'config.jsonc'),
    JSON.stringify({
      pets: [
        {
          id: 'main',
          size: 462,
          balanceEnabled: false,
          display: 'desktop',
          position: { corner: 'top-right', marginX: 24, marginY: 100 },
        },
      ],
      animations: {
        idle: ['待机'],
        turn: [],
        clicks: [],
        moves: { default: { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 }, actions: [] },
        categories: [],
        events: {},
      },
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
  const host = track(await createMiniHost(f));
  return { f, host, base: host.url + '/dsh-pet-7340' };
}

/**
 * 直发未规范化的原始请求路径（fetch/undici 会先按 WHATWG URL 折叠点段、编码策略也
 * 不保证与字节一致，测不出服务端自己的防穿越/解码逻辑）——node:http 的 path 原样上线，才是攻击者可控的字节。
 * 返回 {status, headers}：headers 供 CORS 等断言用。
 */
function rawGet(host, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: new URL(host.url).port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('mini-host endpoints', () => {
  test('GET /config → 200 成品聚合（main 条目 + 初始用户层已写）', async () => {
    const { f, host, base } = await start();
    const res = await fetch(base + '/config');
    assert.equal(res.status, 200);
    // 渲染端是 file://（null 源）跨源取 127.0.0.1：所有响应（json/text/file）必须带 CORS 头
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
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
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(await res.text(), 'WEBMBYTES');
    await host.close();
  });

  test('thumb 防穿越与非法 id：精确码字（400=白名单/ID_FORBIDDEN 拦下，404=解析未命中）', async () => {
    const { host, base } = await start();
    // 字面 ..%2F 不被 URL 折叠（%2F 不是分隔符），decode 后命中扩展名白名单 → 400
    assert.equal((await fetch(base + '/thumb/main/..%2F..%2Fconfig.jsonc')).status, 400);
    // 非法 petId = 命中上游 ID_FORBIDDEN（\ / : 与控制字符）：%5C 解出的反斜杠在 Windows 上
    // 不会被 split('/') 切开，正是上游注释点名的逃逸向量，必须 400 而非静默回落素材池。
    // 与上游同源验证：mini-host 用的就是 standalone-core 再导出的同一个 ID_FORBIDDEN 对象
    // （const { ID_FORBIDDEN } = core，见 mini-host.js），故此处行为即上游行为，无需另测身份
    assert.equal((await fetch(base + '/thumb/bad%5Cid/x.webm')).status, 400);
    assert.equal((await fetch(base + '/thumb/bad%3Aid/x.webm')).status, 400);
    // `bad..id` 只含点号：按上游规则是合法 id（点不是保留字符），无对应素材 → 404，不是 400
    assert.equal((await fetch(base + '/thumb/bad..id/x.webm')).status, 404);
    // `bad|id` 同理是合法 id：ID_FORBIDDEN = /[\\/:\x00-\x1f]/ 不含 `|`，Node 的 http 解析器
    // 也接受原样 `|` 路径（实测 rawGet 直发与 fetch 的 %7C 版都能正常进路由），所以请求合法地
    // 走到 thumb 路由→ resolveExisting 未命中素材 → 404（不存在"parser 先拒"这回事）
    assert.equal((await fetch(base + '/thumb/bad%7Cid/x.webm')).status, 404);
    assert.equal((await rawGet(host, '/dsh-pet-7340/thumb/bad|id/x.webm')).status, 404);
    assert.equal((await fetch(base + '/thumb/main/%E4%B8%8D%E5%AD%98%E5%9C%A8.webm')).status, 404);
    // 原始路径直发（绕过客户端折叠）：三种穿越写法都不得命中 packageRoot/assets/config.jsonc。
    // 逐一实测钉死：%2F 编码版解码后 fileName='../../config.jsonc'，扩展名不合法 → 400；
    // 字面 ../.. 版：URL 已把点段折成 /dsh-pet-7340/config.jsonc，精确匹配不再受理子路径 → 400。
    for (const p of [
      '/dsh-pet-7340/thumb/main/..%2F..%2Fconfig.jsonc',
      '/dsh-pet-7340/thumb/main/../../config.jsonc',
      '/dsh-pet-7340/thumb/main/..%2f..%2fassets%2fconfig.jsonc',
    ]) {
      const { status } = await rawGet(host, p);
      assert.equal(status, 400, p);
    }
    // font/pic 的原始穿越：扩展名合法，但 resolveExisting 的 root 前缀检查拦下 → 404（不是 200）
    assert.equal((await rawGet(host, '/dsh-pet-7340/font/..%2F..%2Fconfig.jsonc')).status, 404);
    assert.equal((await rawGet(host, '/dsh-pet-7340/pic/..%2F..%2Fconfig.jsonc')).status, 404);
    // 折出前缀之外 → 404（前缀本身被折叠掉，不进入路由）
    assert.equal((await rawGet(host, '/dsh-pet-7340/../config.jsonc')).status, 404);
    await host.close();
  });

  test('font / pic 静态服务；错误响应也带 CORS；未知 scope 400', async () => {
    const { host, base } = await start();
    assert.equal((await fetch(base + '/font/f.ttf')).status, 200);
    assert.equal((await fetch(base + '/pic/cursor-grab.png')).status, 200);
    const unknown = await fetch(base + '/whatever/x');
    assert.equal(unknown.status, 400);
    assert.equal(unknown.headers.get('access-control-allow-origin'), '*');
    await host.close();
  });

  test('精确路由：已知 scope 的未知子路径 400（不再前缀误配）', async () => {
    const { host, base } = await start();
    // 旧版 scope==='config' 前缀判法会把 /config/meta 也当 config 返 200（错误形状），现落尾部 400
    assert.equal((await fetch(base + '/config/meta')).status, 400);
    assert.equal((await fetch(base + '/notify/extra')).status, 400);
    assert.equal((await fetch(base + '/balance/trigger/x')).status, 400);
    await host.close();
  });

  test('方法门：非 GET/HEAD → 405（第一阶段无写端点）', async () => {
    const { host, base } = await start();
    const res = await fetch(base + '/config', { method: 'PUT', body: '{}' });
    assert.equal(res.status, 405);
    assert.equal((await res.json()).error, 'method not allowed');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    await host.close();
  });

  test('坏百分号编码 → 400（rawGet 直发字节，浏览器/undici 编码策略不一致时也能复现）', async () => {
    const { host, base } = await start();
    // 服务端实收就是原始字节 '/dsh-pet-7340/%zz'：decodeURIComponent 抛 URIError → 400，不是 500
    const bad = await rawGet(host, '/dsh-pet-7340/%zz');
    assert.equal(bad.status, 400);
    assert.equal(bad.headers['access-control-allow-origin'], '*');
    // 实测本机 Node 的 undici fetch 对 %zz 不重编码、原样上线，故 fetch 版同样命中解码失败分支；
    // 但不同客户端编码策略不一致，rawGet 才是确定性验证，fetch 版只作旁证
    assert.equal((await fetch(base + '/%zz')).status, 400);
    await host.close();
  });

  test('Host 门：非 127.0.0.1 的 Host 头 → 403（DNS rebinding 纵深防御）', async () => {
    const { host, base } = await start();
    // node:http 允许 headers.host 覆盖伪 Host 直发（fetch/undici 做不到）
    const forged = await rawGet(host, '/dsh-pet-7340/config', { headers: { host: 'example.com' } });
    assert.equal(forged.status, 403);
    assert.equal(forged.headers['access-control-allow-origin'], '*');
    // 带端口的 127.0.0.1:port 是正常形态，必须放行（base 里就带端口）
    assert.equal((await fetch(base + '/config')).status, 200);
    await host.close();
  });

  test('事件类端点空转形状：broadcast / work-status / notify', async () => {
    const { host, base } = await start();
    const bc = await (await fetch(base + '/broadcast?pet=main')).json();
    assert.deepEqual({ ok: bc.ok, text: bc.text, ts: bc.ts }, { ok: true, text: '', ts: 0 });
    const ws = await (await fetch(base + '/work-status')).json();
    assert.equal(ws.ts, 0);
    const ntRes = await fetch(base + '/notify?since=0');
    assert.equal(ntRes.headers.get('access-control-allow-origin'), '*');
    const nt = await ntRes.json();
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

  test('精确路由补充：/whisper/trigger（菜单手动碎碎念）属 501 组，不被尾部 400 降级', async () => {
    const { host, base } = await start();
    // 上游 /whisper/trigger 是与 /whisper 并列的精确路由（GET，渲染端右键菜单"碎碎念"走它），
    // 实发带 ?pet=<id>；之前只列 whisper 会让它落到尾部 400（语义错：不是请求不合法，是没 LLM）
    for (const p of ['/whisper/trigger', '/whisper/trigger?pet=main']) {
      assert.equal((await fetch(base + p)).status, 501, p);
    }
    // 与其余 501 同形状：json body（客户端要 res.json()）+ CORS
    const res = await fetch(base + '/whisper/trigger?pet=main');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match((await res.json()).error, /not available in phase 1/);
    await host.close();
  });

  test('初始用户层与 settings 占位只在首跑生成、不覆盖已有', async () => {
    const f = fixture();
    const h1 = track(await createMiniHost(f));
    const userFile = join(f.dshHome, 'dsh-pet', 'main-config.json');
    const settingsFile = join(f.dshHome, 'dsh-pet', 'standalone-settings.json');
    assert.ok(require('node:fs').existsSync(userFile));
    assert.ok(require('node:fs').existsSync(settingsFile));
    writeFileSync(userFile, '{"marker":1}');
    const h2 = track(await createMiniHost(f));
    assert.equal(require('node:fs').readFileSync(userFile, 'utf8'), '{"marker":1}');
    await h1.close().catch(() => {});
    await h2.close();
  });
});

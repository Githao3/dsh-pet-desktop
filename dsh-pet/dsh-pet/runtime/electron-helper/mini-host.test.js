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
 * 直发未规范化的原始请求路径（fetch/undici 会先按 WHATWG URL 折叠点段，
 * 测不出服务端自己的防穿越逻辑）——node:http 的 path 原样上线，才是攻击者可控的字节。
 */
function rawGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: new URL(host.url).port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('mini-host endpoints', () => {
  test('GET /config → 200 成品聚合（main 条目 + 初始用户层已写）', async () => {
    const { f, host, base } = await start();
    const res = await fetch(base + '/config');
    assert.equal(res.status, 200);
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
    assert.equal(await res.text(), 'WEBMBYTES');
    await host.close();
  });

  test('thumb 防穿越与非法 id：路径穿越拒绝，非法 petId 400，未知文件 404', async () => {
    const { host, base } = await start();
    const traversal = await fetch(base + '/thumb/main/..%2F..%2Fconfig.jsonc');
    assert.ok(traversal.status === 400 || traversal.status === 404, 'traversal got ' + traversal.status);
    // 非法 petId = 命中上游 ID_FORBIDDEN（\ / : 与控制字符）：%5C 解出的反斜杠在 Windows 上
    // 不会被 split('/') 切开，正是上游注释点名的逃逸向量，必须 400 而非静默回落素材池
    assert.equal((await fetch(base + '/thumb/bad%5Cid/x.webm')).status, 400);
    assert.equal((await fetch(base + '/thumb/bad%3Aid/x.webm')).status, 400);
    // `bad..id` 只含点号：按上游规则是合法 id（点不是保留字符），无对应素材 → 404，不是 400
    assert.equal((await fetch(base + '/thumb/bad..id/x.webm')).status, 404);
    assert.equal((await fetch(base + '/thumb/main/%E4%B8%8D%E5%AD%98%E5%9C%A8.webm')).status, 404);
    // 原始路径直发（绕过客户端折叠）：三种穿越写法都不得命中 packageRoot/assets/config.jsonc
    // %2F 编码版：解码后 fileName='../../config.jsonc'，扩展名不合法 → 400；
    // 字面 ../.. 版：URL 已把点段折成 /dsh-pet-7340/config.jsonc，落到未知 scope → 400。
    // 两版共同点是没有一条能回到 200/读到前缀外文件（安全行为，非测试放宽）。
    for (const p of [
      '/dsh-pet-7340/thumb/main/..%2F..%2Fconfig.jsonc',
      '/dsh-pet-7340/thumb/main/../../config.jsonc',
      '/dsh-pet-7340/thumb/main/..%2f..%2fassets%2fconfig.jsonc',
    ]) {
      const s = await rawGet(host, p);
      assert.ok(s === 400 || s === 404, p + ' got ' + s);
    }
    // font/pic 的原始穿越：resolveExisting 的 root 前缀检查兜住 → 404（不是 200）
    assert.equal(await rawGet(host, '/dsh-pet-7340/font/..%2F..%2Fconfig.jsonc'), 404);
    assert.equal(await rawGet(host, '/dsh-pet-7340/pic/..%2F..%2Fconfig.jsonc'), 404);
    // 折出前缀之外 → 404（前缀本身被折叠掉，不进入路由）
    assert.equal(await rawGet(host, '/dsh-pet-7340/../config.jsonc'), 404);
    await host.close();
  });

  test('font / pic 静态服务；未知 scope 400', async () => {
    const { host, base } = await start();
    assert.equal((await fetch(base + '/font/f.ttf')).status, 200);
    assert.equal((await fetch(base + '/pic/cursor-grab.png')).status, 200);
    assert.equal((await fetch(base + '/whatever/x')).status, 400);
    await host.close();
  });

  test('事件类端点空转形状：broadcast / work-status / notify', async () => {
    const { host, base } = await start();
    const bc = await (await fetch(base + '/broadcast?pet=main')).json();
    assert.deepEqual({ ok: bc.ok, text: bc.text, ts: bc.ts }, { ok: true, text: '', ts: 0 });
    const ws = await (await fetch(base + '/work-status')).json();
    assert.equal(ws.ts, 0);
    const nt = await (await fetch(base + '/notify?since=0')).json();
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

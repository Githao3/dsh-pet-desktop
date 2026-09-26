/**
 * standalone-entry 测试 —— 独立桌面应用的宿主侧纯逻辑（配置路径组装 / 桌面宠物清单 /
 * 初始用户配置写入）。风格与 config.test.ts 一致：mkdtemp 临时目录做夹具，node:test。
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { petPaths, desktopPetList, ensureStarterUserConfig, mergedConfig } from './standalone-entry.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'dshpet-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** 最小合法默认配置（包内 config.jsonc 的最小子集：缺 animations/physics 等键时合并器对 base 条目不校验，能省则省） */
function writeDefault(pkgRoot: string, petsJson: string): void {
  mkdirSync(join(pkgRoot, 'assets'), { recursive: true });
  writeFileSync(
    join(pkgRoot, 'assets', 'config.jsonc'),
    `{ "pets": ${petsJson}, "whisperPrompt": "x", "chatMemoryRounds": 5, "whisperImageEnabled": false, "chatImageEnabled": false, "memes": {}, "notificationsEnabled": true, "eventsRefreshSec": { "balance": 1800, "whisper": 300 } }`,
  );
}

describe('petPaths', () => {
  test('组装三个路径：包内默认配置 / 用户 main-config / 用户 pet 目录', () => {
    // 第二个参数是 dataRoot（数据根目录，独立版默认 ~/.dsh），petPaths 内部再拼 'dsh-pet' 段，
    // 与上游 ~/.dsh/dsh-pet 布局逐字一致，也与下方 pet pack 用例 desktopPetList(pkg, userRoot) 语义一致。
    const p = petPaths('/pkg', '/user');
    assert.equal(p.defaultFile, join('/pkg', 'assets', 'config.jsonc'));
    assert.equal(p.userFile, join('/user', 'dsh-pet', 'main-config.json'));
    assert.equal(p.petDir, join('/user', 'dsh-pet', 'pet'));
  });
});

describe('desktopPetList', () => {
  test('只保留 display 含 desktop 的宠物，并透出 id/size', () => {
    const pkg = tmp();
    const user = tmp();
    writeDefault(
      pkg,
      JSON.stringify([
        {
          id: 'main',
          size: 462,
          balanceEnabled: true,
          display: 'desktop',
          position: { corner: 'top-right', marginX: 24, marginY: 100 },
        },
        {
          id: 'webby',
          size: 200,
          balanceEnabled: false,
          display: 'web',
          position: { corner: 'top-left', marginX: 24, marginY: 100 },
        },
      ]),
    );
    const list = desktopPetList(pkg, user);
    assert.deepEqual(list, [{ id: 'main', size: 462 }]);
  });

  test('pet pack（文件宠物）的 desktop 宠物也在清单里', () => {
    const pkg = tmp();
    const userRoot = tmp();
    const user = join(userRoot, 'dsh-pet');
    writeDefault(
      pkg,
      JSON.stringify([
        {
          id: 'main',
          size: 462,
          balanceEnabled: false,
          display: 'desktop',
          position: { corner: 'top-right', marginX: 24, marginY: 100 },
        },
      ]),
    );
    mkdirSync(join(user, 'pet'), { recursive: true });
    writeFileSync(
      join(user, 'pet', 'pig-config.json'),
      JSON.stringify({
        pets: [
          {
            id: 'pig1',
            size: 420,
            balanceEnabled: false,
            display: 'both',
            position: { corner: 'bottom-left', marginX: 24, marginY: 100 },
          },
        ],
        animations: {
          idle: ['a'],
          turn: [],
          drag: [],
          clicks: [],
          moves: { default: { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 }, actions: [] },
          categories: [],
          events: {},
        },
        animationWeights: { idle: 100, turn: 0, move: 0 },
      }),
    );
    mkdirSync(join(user, 'pet', 'pig-animation'), { recursive: true });
    writeFileSync(join(user, 'pet', 'pig-animation', 'a.webm'), 'x');
    const ids = desktopPetList(pkg, userRoot)
      .map((p) => p.id)
      .sort();
    assert.deepEqual(ids, ['main', 'pig1']);
  });
});

describe('ensureStarterUserConfig', () => {
  test('无用户配置时写入独立版初始配置（balanceEnabled=false, display=desktop）', () => {
    const dir = tmp();
    // 传深层路径，顺带覆盖 ensureStarterUserConfig 的递归 mkdir 分支
    const file = join(dir, '.dsh', 'dsh-pet', 'main-config.json');
    assert.equal(ensureStarterUserConfig(file), true);
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(obj.pets[0].balanceEnabled, false);
    assert.equal(obj.pets[0].display, 'desktop');
  });

  test('已有用户配置时绝不覆盖', () => {
    const dir = tmp();
    const file = join(dir, 'main-config.json');
    writeFileSync(file, JSON.stringify({ pets: [] }));
    assert.equal(ensureStarterUserConfig(file), false);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pets: [] });
  });
});

describe('mergedConfig', () => {
  test('返回 readAllConfig 成品聚合（含 main 条目且字段已填满）', () => {
    const pkg = tmp();
    const user = tmp();
    writeDefault(
      pkg,
      JSON.stringify([
        {
          id: 'main',
          size: 462,
          balanceEnabled: false,
          display: 'desktop',
          position: { corner: 'top-right', marginX: 24, marginY: 100 },
        },
      ]),
    );
    const merged = mergedConfig(pkg, user);
    assert.ok(merged.main);
    assert.ok(Array.isArray(merged.main.pets));
    // 条目级字段透传/填满：display 在合并结果中仍存在（mergePet 保证 display 已填）
    assert.equal((merged.main.pets[0] as { display: string }).display, 'desktop');
  });
});

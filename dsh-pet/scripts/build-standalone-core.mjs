#!/usr/bin/env node
/**
 * build-standalone-core.mjs —— 把 src/host/standalone-entry.ts 打成
 * runtime/electron-helper/standalone-core.cjs（CommonJS），供 Electron 主进程的
 * mini-host require（helper 无构建管线，经典 CJS 直载）。
 *
 * 用法：node scripts/build-standalone-core.mjs（npm run build:standalone-core；
 * 由 prepare.js 与本地开发调用）
 */
import { rolldown } from 'rolldown';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

try {
  const bundle = await rolldown({
    input: join(ROOT, 'src', 'host', 'standalone-entry.ts'),
    platform: 'node',
  });
  await bundle.write({ format: 'cjs', file: join(ROOT, 'runtime', 'electron-helper', 'standalone-core.cjs') });
  console.log('[build-standalone-core] ✓ runtime/electron-helper/standalone-core.cjs');
} catch (error) {
  console.error('[build-standalone-core] build failed:', error);
  process.exit(1);
}

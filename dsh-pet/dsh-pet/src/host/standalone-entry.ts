/**
 * standalone-entry —— 独立桌面应用（无 DSH）的宿主侧入口。
 *
 * 角色：把 src/host/config.ts 的纯逻辑（readAllConfig/flattenPetList）包装成
 * 迷你宿主可直接消费的 API：
 *   - petPaths(packageRoot, dshHome)：组装 ConfigPaths（与上游 ~/.dsh/dsh-pet 布局逐字一致）
 *   - mergedConfig / desktopPetList：成品配置聚合 / display 含 desktop 的 [{id,size}] 清单
 *   - ensureStarterUserConfig：首次运行写入独立版初始配置（关余额，桌面显示）
 *
 * 本文件由 scripts/build-standalone-core.mjs 打成 CJS（standalone-core.cjs）供
 * runtime/electron-helper（主进程）require；它同时是 TS 源，接受上游 typecheck/test 管辖。
 *
 * 用户配置语义（沿用上游）：main-config.json 是覆盖层，pets 字段整体替换内置默认；
 * 用户手写配置后本模块不再碰它（存在即跳过）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAllConfig, flattenPetList, type ConfigPaths } from './config';
import { isDesktopVisible } from '../shared/config';

/** 独立版初始用户配置：单宠、桌面显示、关余额/碎碎念/工作状态（第二阶段接 LLM 后再放开） */
const STARTER_USER_CONFIG = {
  pets: [
    {
      name: '蓝毛小女仆',
      id: 'main',
      size: 462,
      balanceEnabled: false,
      whisperEnabled: false,
      workStatusEnabled: false,
      display: 'desktop',
      position: { corner: 'top-right', marginX: 24, marginY: 100 },
    },
  ],
};

/** 三路径组装：包根 + 用户数据根（= $DSH_HOME 的值，独立版默认 ~/.dsh） */
export function petPaths(packageRoot: string, dshHome: string): ConfigPaths {
  const user = join(dshHome, 'dsh-pet');
  return {
    defaultFile: join(packageRoot, 'assets', 'config.jsonc'),
    userFile: join(user, 'main-config.json'),
    petDir: join(user, 'pet'),
  };
}

/** 成品配置聚合（{ main: {...}, <种类前缀>: {...} }，全部字段已填满） */
export function mergedConfig(packageRoot: string, dshHome: string): Record<string, Record<string, unknown>> {
  return readAllConfig(petPaths(packageRoot, dshHome));
}

/** 桌面窗口清单：display 含 desktop/both 的全部宠物（主配置 + pet pack） */
export function desktopPetList(packageRoot: string, dshHome: string): Array<{ id: string; size: number }> {
  try {
    return flattenPetList(mergedConfig(packageRoot, dshHome))
      .filter((p) => isDesktopVisible(String(p.display ?? 'both') as 'web' | 'desktop' | 'both' | 'none'))
      .map((p) => ({ id: String(p.id), size: Number(p.size) }));
  } catch (error) {
    console.error('[standalone] desktopPetList failed:', error);
    return [];
  }
}

/** 首次运行写初始配置；已存在（无论内容）→ 不碰。返回是否写入 */
export function ensureStarterUserConfig(userFile: string): boolean {
  if (existsSync(userFile)) return false;
  mkdirSync(join(userFile, '..'), { recursive: true });
  writeFileSync(userFile, JSON.stringify(STARTER_USER_CONFIG, null, 2) + '\n', 'utf8');
  return true;
}

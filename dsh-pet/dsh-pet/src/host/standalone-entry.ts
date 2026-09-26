/**
 * standalone-entry —— 独立桌面应用（无 DSH）的宿主侧入口。
 *
 * 角色：把 src/host/config.ts 的纯逻辑（readAllConfig/flattenPetList）包装成
 * 迷你宿主可直接消费的 API：
 *   - petPaths(packageRoot, dataRoot)：组装 ConfigPaths（与上游 ~/.dsh/dsh-pet 布局逐字一致）
 *   - mergedConfig / desktopPetList：成品配置聚合 / display 含 desktop 的 [{id,size}] 清单
 *   - ensureStarterUserConfig：首次运行写入独立版初始配置（关余额，桌面显示）
 *
 * 本文件将由 Task 3 的 scripts/build-standalone-core.mjs 打成 CJS（standalone-core.cjs）供
 * runtime/electron-helper（主进程）require；它同时是 TS 源，接受上游 typecheck/test 管辖。
 *
 * 用户配置语义（沿用上游）：main-config.json 是覆盖层，pets 字段整体替换内置默认；
 * 用户手写配置后本模块不再碰它（存在即跳过）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAllConfig, flattenPetList, type ConfigPaths } from './config';

// 供 mini-host 同源引用，防镜像漂移：thumb 路由的 petId 校验与配置加载器必须共用同一正则（config.ts L42）
export { ID_FORBIDDEN } from './config';

/** 桌面可见判定（与上游 host/index.ts 本地复制 isDesktopVisible 的既有做法一致：host 半侧不 import shared） */
const isDesktopDisplay = (display: unknown): boolean => display === 'desktop' || display === 'both';

/** 独立版初始用户配置（第一阶段：只开桌面、先不接 LLM） */
const STARTER_USER_CONFIG = {
  // 只写与包内默认的差异字段（+name：mergePet 对缺失 name 回退成 id 而非默认名，必须写）；
  // size/position 等由上游合并器填内置默认，上游调默认值时独立版自动跟随。
  pets: [{ id: 'main', name: '蓝毛小女仆', balanceEnabled: false, display: 'desktop' }],
};

/** 三路径组装：包根 + 数据根目录（独立版默认 ~/.dsh，兼容上游 DSH_HOME 布局） */
export function petPaths(packageRoot: string, dataRoot: string): ConfigPaths {
  // 'dsh-pet' 字面量与 host/index.ts L217 的单处拼接一致，上游收敛 DSH 路径 helper 后此处随之收敛
  const user = join(dataRoot, 'dsh-pet');
  return {
    defaultFile: join(packageRoot, 'assets', 'config.jsonc'),
    userFile: join(user, 'main-config.json'),
    petDir: join(user, 'pet'),
  };
}

/** 成品配置聚合（{ main: {...}, <种类前缀>: {...} }，全部字段已填满）；dataRoot=数据根目录（独立版默认 ~/.dsh，兼容上游 DSH_HOME 布局） */
export function mergedConfig(packageRoot: string, dataRoot: string): Record<string, Record<string, unknown>> {
  return readAllConfig(petPaths(packageRoot, dataRoot));
}

/** 桌面窗口清单：display 含 desktop/both 的全部宠物（主配置 + pet pack）。
 *  配置损坏时异常上抛（安装损坏属致命错误，不做静默兜底——与上游 config.jsonc 头注释同一原则） */
export function desktopPetList(packageRoot: string, dataRoot: string): Array<{ id: string; size: number }> {
  return flattenPetList(mergedConfig(packageRoot, dataRoot))
    .filter((p) => isDesktopDisplay(p.display))
    .map((p) => ({ id: String(p.id), size: Number(p.size) }));
}

/** 首次运行写初始配置；已存在（无论内容）→ 不碰。返回是否写入 */
export function ensureStarterUserConfig(userFile: string): boolean {
  if (existsSync(userFile)) return false;
  mkdirSync(join(userFile, '..'), { recursive: true });
  writeFileSync(userFile, JSON.stringify(STARTER_USER_CONFIG, null, 2) + '\n', 'utf8');
  return true;
}

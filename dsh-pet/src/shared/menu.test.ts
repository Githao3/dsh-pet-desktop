/**
 * menu 菜单树构建单元测试 —— 钉住三条语义：
 * ① 叶子展示 label 剥掉池名前缀（点击回应-/工作状态-/碎碎念-/余额-），
 *    anim 字段保留完整动画名（点播与素材文件名查找依赖它）；
 * ② events 数组槽位（档内随机候选）展平为逐个叶子，全部可手动点播预览；
 * ③ 事件分组 label 走 EVENT_LABELS 映射（workStatus→工作状态、feed→投喂），
 *    未知事件键原样展示。
 *
 * 跑法：node --experimental-strip-types --test src/shared/menu.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildMenuTree } from './menu.ts';
import type { MenuBranch, MenuNode } from './menu.ts';
import type { Animations } from './types.ts';

const anims: Animations = {
  idle: ['待机呼吸休闲'],
  turn: [],
  drag: ['被鼠标拖拽悬空反馈'],
  clicks: ['点击回应-开心跃动', '点击回应-害羞惊讶'],
  moves: { default: {}, actions: [{ name: '向左走动', from: 0, to: 1 } as never] },
  categories: [{ id: '文字', weight: 10, noMirror: true, actions: ['是啊，吃什么'] }],
  events: {
    balance: ['余额-开心'],
    workStatus: ['工作状态-思考冒泡', ['工作状态-忙碌点按', '托腮盘发']],
    feed: ['文件变米饭'],
    customEvent: ['某自定义动画'],
  },
};

const root = buildMenuTree(anims)[0] as MenuBranch;
const group = (label: string): MenuBranch =>
  root.children.find((n: MenuNode) => (n as MenuBranch).label === label) as MenuBranch;

describe('buildMenuTree —— label 前缀剥离', () => {
  test('带池名前缀的动画：label 去前缀，anim 保留全名', () => {
    const clicks = group('点击回应');
    assert.deepEqual(
      clicks.children.map((c) => [c.label, (c as { anim?: string }).anim]),
      [
        ['开心跃动', '点击回应-开心跃动'],
        ['害羞惊讶', '点击回应-害羞惊讶'],
      ],
    );
  });

  test('无前缀动画 label 原样（自制动作不受影响）', () => {
    assert.equal(group('待机').children[0].label, '待机呼吸休闲');
  });
});

describe('buildMenuTree —— 事件分组与数组槽展平', () => {
  test('workStatus 数组槽展平为逐个叶子，分组 label 走映射', () => {
    const ws = group('工作状态');
    assert.deepEqual(
      ws.children.map((c) => c.label),
      ['思考冒泡', '忙碌点按', '托腮盘发'],
    );
  });

  test('feed 事件分组 label 为「投喂」', () => {
    const feed = group('投喂');
    assert.equal(feed.children.length, 1);
    assert.deepEqual(
      [feed.children[0].label, (feed.children[0] as { anim?: string }).anim],
      ['文件变米饭', '文件变米饭'],
    );
  });

  test('未知事件键原样作为分组 label（前向兼容）', () => {
    assert.ok(group('customEvent'));
  });
});

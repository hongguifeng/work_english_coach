// T026 — 表达库测试
//
// 三层：
// 1. ExpressionRepository 扩展方法（listAll / delete / create NOT NULL 约束）—— 真实
//    node:sqlite 内存库 + 迁移。
// 2. expressionService 边界解析（Zod 校验，值域对齐 docs/03 §2.4，中文错误提示）。
//    —— service 的业务函数不做二次校验（由 handler 在 IPC 边界解析，纵深防御）。
// 3. expressionService 业务行为 —— 同步 fake 仓储（与真实仓储接口一致：方法返回
//    Result 而非 Promise；get 未找到 → ok(null)）。
import { describe, expect, it } from 'vitest';
import { err, ok } from '../src/shared/types/app';
import type { Result } from '../src/shared/types/app';
import type { SqlDb } from '../src/main/db/db';
import type { ExpressionRepository } from '../src/main/db/repositories/expressions';
import type { ExpressionRow } from '../src/main/db/schema';
import { createRepositories } from '../src/main/db/repositories';
import { createTestDb } from './db/testDb';
import * as svc from '../src/main/services/expressionService';
import type { ExpressionRecord, MasteryStatus } from '../src/shared/types/library';

// —— 同步 fake 仓储（接口与 ExpressionRepository 完全一致）——

function makeRow(
  over: Partial<ExpressionRow> & Pick<ExpressionRow, 'id' | 'title' | 'chineseMeaning'>,
  createdAt: string,
): ExpressionRow {
  return {
    id: over.id,
    title: over.title,
    chineseMeaning: over.chineseMeaning,
    pattern: over.pattern ?? null,
    example: over.example ?? null,
    scenario: over.scenario ?? null,
    notes: over.notes ?? null,
    sourceSampleId: over.sourceSampleId ?? null,
    masteryStatus: over.masteryStatus ?? 'new',
    nextReviewAt: over.nextReviewAt ?? null,
    status: over.status ?? 'active',
    createdAt,
    updatedAt: createdAt,
  };
}

function makeRepo(): {
  repo: ExpressionRepository;
  rows: Map<string, ExpressionRow>;
  updateCalls: { n: number };
} {
  const rows = new Map<string, ExpressionRow>();
  const updateCalls = { n: 0 };
  let idCounter = 0;

  const repo = {
    db: null as unknown as SqlDb,
    create: (input: {
      title: string;
      chineseMeaning: string;
      pattern?: string | null;
      example?: string | null;
      scenario?: string | null;
      notes?: string | null;
      sourceSampleId?: string | null;
      masteryStatus?: MasteryStatus;
      nextReviewAt?: string | null;
    }): Result<ExpressionRow> => {
      const now = '2026-07-25T10:00:00.000Z';
      const row = makeRow(
        {
          id: `fake-${++idCounter}`,
          title: input.title,
          chineseMeaning: input.chineseMeaning,
          pattern: input.pattern ?? null,
          example: input.example ?? null,
          scenario: input.scenario ?? null,
          notes: input.notes ?? null,
          sourceSampleId: input.sourceSampleId ?? null,
          masteryStatus: input.masteryStatus ?? 'new',
          nextReviewAt: input.nextReviewAt ?? null,
        },
        now,
      );
      rows.set(row.id, row);
      return ok(row);
    },
    update: (id: string, patch: Record<string, unknown>): Result<ExpressionRow> => {
      updateCalls.n++;
      const cur = rows.get(id);
      if (cur === undefined) return err('storage', `表达不存在: ${id}`);
      // 与真实仓储一致：`!== undefined` 判断（显式 null = 清空，absent = 保持原值）。
      const next: ExpressionRow = {
        ...cur,
        updatedAt: '2026-07-25T11:00:00.000Z',
      };
      if (patch.title !== undefined) next.title = patch.title as string;
      if (patch.chineseMeaning !== undefined) next.chineseMeaning = patch.chineseMeaning as string;
      if (patch.pattern !== undefined) next.pattern = patch.pattern as string | null;
      if (patch.example !== undefined) next.example = patch.example as string | null;
      if (patch.scenario !== undefined) next.scenario = patch.scenario as string | null;
      if (patch.notes !== undefined) next.notes = patch.notes as string | null;
      if (patch.masteryStatus !== undefined)
        next.masteryStatus = patch.masteryStatus as MasteryStatus;
      if (patch.status !== undefined) next.status = patch.status as ExpressionRecord['status'];
      rows.set(id, next);
      return ok(next);
    },
    get: (id: string): Result<ExpressionRow | null> => ok(rows.get(id) ?? null),
    listAll: (): Result<ExpressionRow[]> =>
      ok([...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    delete: (id: string): Result<boolean> => ok(rows.delete(id)),
    setMasteryStatus: (id: string, s: MasteryStatus) => repo.update(id, { masteryStatus: s }),
    setStatus: (id: string, s: ExpressionRecord['status']) => repo.update(id, { status: s }),
    list: (): Result<ExpressionRow[]> => ok([]),
    getBySourceSampleId: (): Result<ExpressionRow[]> => ok([]),
  } as unknown as ExpressionRepository;

  return { repo, rows, updateCalls };
}

// ============================================================
// 1. 仓储扩展方法（真实 DB）
// ============================================================

describe('ExpressionRepository 扩展方法（T026）', () => {
  it('listAll：按创建时间倒序，含归档', async () => {
    const t = createTestDb();
    try {
      const repo = createRepositories(t.db).expressions;
      const base = {
        chineseMeaning: '到三季度末',
        pattern: 'by 时间点',
        example: 'We ship by the end of Q3.',
        scenario: 'report',
      };
      const r1 = repo.create({ ...base, title: 'By the end of Q3' });
      const r2 = repo.create({ ...base, title: 'As of today' });
      const r3 = repo.create({ ...base, title: '归档的一条' });
      expect(r1.ok && r2.ok && r3.ok).toBe(true);
      if (!r1.ok || !r2.ok || !r3.ok) return;

      // 裸 SQL 控制 createdAt（CreateExpressionInput 不含时间字段）以验证排序。
      t.client.prepare('UPDATE expressions SET createdAt = ? WHERE id = ?').run(
        '2026-07-20T00:00:00.000Z',
        r1.data.id,
      );
      t.client.prepare('UPDATE expressions SET createdAt = ? WHERE id = ?').run(
        '2026-07-22T00:00:00.000Z',
        r2.data.id,
      );
      t.client.prepare('UPDATE expressions SET createdAt = ? WHERE id = ?').run(
        '2026-07-24T00:00:00.000Z',
        r3.data.id,
      );
      expect(repo.setStatus(r3.data.id, 'archived').ok).toBe(true);

      const all = repo.listAll();
      expect(all.ok).toBe(true);
      if (all.ok) {
        expect(all.data.map((r) => r.id)).toEqual([r3.data.id, r2.data.id, r1.data.id]);
        // 归档项也在全量列表里（页面侧按 status 筛选）。
        expect(all.data[0]!.status).toBe('archived');
      }
    } finally {
      t.close();
    }
  });

  it('delete：存在 → true；不存在 → false（非错误）', async () => {
    const t = createTestDb();
    try {
      const repo = createRepositories(t.db).expressions;
      const r = repo.create({
        title: 'ToDelete',
        chineseMeaning: '待删除',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(repo.delete(r.data.id).ok).toBe(true);
      const del = repo.delete(r.data.id);
      expect(del.ok).toBe(true);
      if (del.ok) expect(del.data).toBe(false);
      const missing = repo.delete('no-such-id');
      expect(missing.ok).toBe(true);
      if (missing.ok) expect(missing.data).toBe(false);
    } finally {
      t.close();
    }
  });

  it('create：违反 NOT NULL（chineseMeaning 缺失）→ 返回错误不抛异常', async () => {
    const t = createTestDb();
    try {
      const repo = createRepositories(t.db).expressions;
      // 绕过 TS 类型模拟“运行期脏数据”：仓储必须优雅失败（toResult 兜底）。
      const bad = { title: '只有标题' } as unknown as Parameters<typeof repo.create>[0];
      const r = repo.create(bad);
      expect(r.ok).toBe(false);
    } finally {
      t.close();
    }
  });
});

// ============================================================
// 2. 边界解析（Zod；值域对齐 docs/03 §2.4）
// ============================================================

describe('expressionService 边界解析', () => {
  it('parseExpressionCreate：合法输入通过（可选字段可省略）', () => {
    const r = svc.parseExpressionCreate({
      title: 'By the end of Q3',
      chineseMeaning: '到三季度末',
    });
    expect(r.ok).toBe(true);
  });

  it('parseExpressionCreate：title 超 50 字 → validation', () => {
    const bad = svc.parseExpressionCreate({
      title: 'a'.repeat(51),
      chineseMeaning: 'x'.repeat(51),
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('validation');
      expect(bad.error.message).toContain('title');
      expect(bad.error.message).toContain('50');
    }
  });

  it('parseExpressionCreate：chineseMeaning 缺失 → validation（提示字段名）', () => {
    const bad = svc.parseExpressionCreate({ title: 'By the end of Q3', pattern: 'by 时间点' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('validation');
      expect(bad.error.message).toContain('chineseMeaning');
    }
  });

  it('parseExpressionCreate：masteryStatus 非法值 → validation（列出合法值）', () => {
    const bad = svc.parseExpressionCreate({
      title: 'T',
      chineseMeaning: 'C',
      masteryStatus: 'bogus',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('validation');
      expect(bad.error.message).toContain('masteryStatus');
      expect(bad.error.message).toContain('new / learning / familiar');
    }
  });

  it('parseExpressionUpdate：空 patch → 合法（no-op，service 层短路）', () => {
    const r = svc.parseExpressionUpdate({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.data)).toHaveLength(0);
  });

  it('parseExpressionUpdate：nextReviewAt 不在允许字段 → validation（strict 拒绝未预期字段）', () => {
    const bad = svc.parseExpressionUpdate({ nextReviewAt: '2026-08-01T00:00:00.000Z' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('validation');
      expect(bad.error.message).toContain('nextReviewAt');
    }
  });

  it('parseExpressionUpdate：status 非法值 → validation（列出 active / archived）', () => {
    const bad = svc.parseExpressionUpdate({ status: 'purged' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('validation');
      expect(bad.error.message).toContain('active / archived');
    }
  });

  it('parseExpressionId：非字符串 → validation', () => {
    const bad = svc.parseExpressionId(123);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('validation');
  });

  it('parseExpressionStatus：只接受 active/archived', () => {
    expect(svc.parseExpressionStatus('active').ok).toBe(true);
    expect(svc.parseExpressionStatus('archived').ok).toBe(true);
    const bad = svc.parseExpressionStatus('purged');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('validation');
  });
});

// ============================================================
// 3. 业务行为（同步 fake 仓储）
// ============================================================

describe('expressionService 业务行为', () => {
  it('listExpressions：透传仓库结果（含归档全量，创建时间倒序）', () => {
    const { repo, rows } = makeRepo();
    rows.set(
      'e1',
      makeRow({ id: 'e1', title: 'A', chineseMeaning: '甲' }, '2026-07-20T00:00:00.000Z'),
    );
    rows.set(
      'e2',
      makeRow(
        { id: 'e2', title: 'B', chineseMeaning: '乙', status: 'archived' },
        '2026-07-24T00:00:00.000Z',
      ),
    );
    const r = svc.listExpressions(repo);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.map((x) => x.id)).toEqual(['e2', 'e1']);
      expect(r.data[0]!.status).toBe('archived');
    }
  });

  it('createExpression：合法 → 落库并返回完整记录', () => {
    const { repo, rows } = makeRepo();
    const r = svc.createExpression(repo, {
      title: 'As of today',
      chineseMeaning: '截至今天',
      pattern: 'as of + 时间点',
      example: 'As of today we have 12 accounts.',
      scenario: 'email',
      notes: 'client / neutral',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.title).toBe('As of today');
      expect(r.data.masteryStatus).toBe('new');
      expect(r.data.status).toBe('active');
      expect(rows.get(r.data.id)?.scenario).toBe('email');
    }
  });

  it('updateExpression：部分更新返回合并后的记录（未给字段保持原值）', () => {
    const { repo, rows } = makeRepo();
    const created = svc.createExpression(repo, {
      title: 'T',
      chineseMeaning: 'C',
      notes: '原备注',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = svc.updateExpression(repo, created.data.id, {
      masteryStatus: 'learning',
      notes: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.masteryStatus).toBe('learning');
      expect(r.data.notes).toBeNull();
      expect(r.data.title).toBe('T'); // 未更新字段保持
      expect(rows.get(r.data.id)?.masteryStatus).toBe('learning');
    }
  });

  it('updateExpression：id 不存在 → storage', () => {
    const { repo } = makeRepo();
    const r = svc.updateExpression(repo, 'nope', { masteryStatus: 'learning' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('storage');
  });

  it('updateExpression：空 patch → 返回当前记录，不调用 repo.update', () => {
    const { repo, rows, updateCalls } = makeRepo();
    rows.set('e1', makeRow({ id: 'e1', title: 'T', chineseMeaning: 'C' }, '2026-07-25T09:00:00.000Z'));
    const r = svc.updateExpression(repo, 'e1', {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.title).toBe('T');
      expect(r.data.masteryStatus).toBe('new');
    }
    expect(updateCalls.n).toBe(0);
  });

  it('deleteExpression：存在 → true；不存在 → false（非错误）', () => {
    const { repo, rows } = makeRepo();
    rows.set('e1', makeRow({ id: 'e1', title: 'T', chineseMeaning: 'C' }, '2026-07-25T09:00:00.000Z'));
    const del = svc.deleteExpression(repo, 'e1');
    expect(del.ok).toBe(true);
    if (del.ok) expect(del.data).toBe(true);
    const missing = svc.deleteExpression(repo, 'nope');
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.data).toBe(false);
  });

  it('setExpressionStatus：归档成功返回更新后的记录；id 不存在 → storage', () => {
    const { repo, rows } = makeRepo();
    rows.set('e1', makeRow({ id: 'e1', title: 'T', chineseMeaning: 'C' }, '2026-07-25T09:00:00.000Z'));
    const r = svc.setExpressionStatus(repo, 'e1', 'archived');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.status).toBe('archived');
      expect(rows.get('e1')?.status).toBe('archived');
    }
    const bad = svc.setExpressionStatus(repo, 'nope', 'archived');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('storage');
  });
});

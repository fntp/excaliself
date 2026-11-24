# D1 迁移进度（feat/cf-migration @ b1329f4）

## 已完成
- schema 全量转 sqlite-core、D1 驱动、R2 图片存储（3fcc2b6）
- 测试基建重建（b1329f4）：
  - `src/db/test-db.ts` 用 `drizzle/0000_init.sql` 建表，与 `wrangler d1 migrations apply` 同源
  - 拒绝 `BEGIN`，模拟 D1；`batch` 走真实 SQLite 事务
  - `vitest.config.ts` 把 `cloudflare:workers` 指向 `src/db/cloudflare-workers-stub.ts`
    （`bind(name, value)` 注入绑定，`fakeImages()` 是内存 R2）
  - 注意：`test-db.ts` 用 `process.cwd()` 找迁移，jsdom 下 `import.meta.url` 不是 file URL
- 去掉事务：`folders/create`、`drawings/create/update`、`shares/createShareLink`、`shares/setShareLinkAudience`
  - 手法：`insert().select()` 原子读父行；条件写把校验放进 `WHERE`；写后复查区分"不存在"和真错误
- PG 残留：`left()` → `substr()`，去掉 `count(*)::int`

## 待做（22 处 db.transaction，17 个文件）
优先级建议（低风险 → 高）：
1. `drawings/scene-write.ts`、`collab/scene-store.ts`（单条写，多半可直接去）
2. `password-resets/server.ts`、`folders/server.ts`、`admin/server.ts`（读+写两条）
3. `drawings/bulk.ts`（3 处）、`trash/destroy.ts`、`trash/trash.ts`、`trash/server.ts`（batch 替换候选）
4. `drawings/duplicate.ts`、`scene-import.ts`、`excalidraw-plus/import.ts`（批量插入，`db.batch`）
5. `trash/restore.ts`（2 处）、`trash/purge.ts`、`spaces/move-to-team.ts`（2 处）、`admin/delete-user.ts`（最后管理员的复核回滚）

替换手法：
- 多条独立的写 → `db.batch([...])`（非空元组，原子）
- 检查+写 → 条件写（`WHERE` 里校验）或用 `insert().select()`
- 必须"读全再决定"的（如 last-admin）→ 写后复核 + 补偿回滚

## 复查命令
```
npx tsc --noEmit -p tsconfig.json
npx vitest run
```

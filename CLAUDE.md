# CLAUDE.md

CoSheet 是一个云端表格协作平台。前端在仓库根目录 `src/`，真实后端在 `server/`，数据使用 MySQL + 分片 JSON 文件。

## 开发命令

```bash
pnpm dev                 # 前端 Vite，http://localhost:5173
pnpm server              # 后端 tsx watch，http://localhost:3000
pnpm dev:full            # 前后端同时启动

pnpm type-check          # vue-tsc --build
pnpm build               # 前端类型检查 + 构建
pnpm lint                # oxlint + eslint

pnpm --dir server dev
pnpm --dir server build
pnpm --dir server start
```

首次启动：

```bash
pnpm install
pnpm --dir server install
mysql -u root -p < server/sql/schema.sql
cp server/.env.example server/.env
pnpm dev:full
```

- `schema.sql` 创建 `cosheet` 数据库。
- `server/.env` 必须配置 `DB_*`、`JWT_SECRET`、`STORAGE_DIR`、`CORS_ORIGIN`，不要提交。
- Vite 代理 `/api` 和 `/ws` 到 `localhost:3000`。

## 技术栈

- 前端：Vue 3、Vite、TypeScript、Pinia、Element Plus、Vue Router
- 后端：Express 5、TypeScript、MySQL 8、`mysql2/promise`、JWT、bcryptjs、`ws`
- 文件：SheetJS (`xlsx`) + Web Worker 解析 Excel；分片 JSON 存储在 `server/storage/chunks/`
- 缓存：`idb`（IndexedDB）
- 导出：`xlsx`、`html2canvas`、`jsPDF`
- 无 AI、图表、ECharts、报告、TipTap

## 当前路由和页面

```text
/login                  LoginView
/register               LoginView（注册模式）
/workspaces             WorkspaceView
/workspaces/:workspaceId WorkspaceView
/files/:fileId          FileView
/                       → /workspaces
```

- `src/views/DataView.vue`、`src/views/Upload.vue`、`src/stores/data.ts`、`src/utils/datasetDB.ts` 是旧版遗留文件，不在当前路由和主流程中。
- `src/views/WorkspaceView.vue`：文件列表、上传首版、成员管理。
- `src/views/FileView.vue`：表格、评论、版本选择、保留/清除、导出、在线状态。

## 后端结构

```text
server/src/
├── index.ts                  # HTTP + WebSocket 启动
├── app.ts                    # Express 中间件和路由挂载
├── middleware/               # auth、asyncHandler、error
├── routes/
│   ├── auth.ts
│   ├── workspaces.ts
│   ├── members.ts
│   ├── files.ts
│   ├── fileDetail.ts         # 文件详情、版本列表
│   ├── versions.ts           # 分片、complete、rows、单元格、retain、clear
│   └── comments.ts
├── services/
│   ├── auth.ts
│   ├── workspaces.ts
│   ├── members.ts
│   ├── files.ts
│   ├── versions.ts
│   ├── versionRows.ts
│   ├── versionRetention.ts
│   ├── cellEdits.ts
│   ├── comments.ts
│   └── permissions.ts
├── realtime/ws.ts
├── storage/chunks.ts
└── utils/                    # jwt、password、validate、httpError
```

## 数据模型

- `users`
- `workspaces`
- `workspace_members`
- `files`：`latest_version_number`、`deleted_at`
- `file_versions`：`version_number`、`base_version_id`、`columns_json`、`row_count`、`chunk_count`、`status`
- `chunks`：版本分片元数据；实际 JSON 在 `server/storage/chunks/<versionId>/<index>.json`
- `comments`：按 `version_id` 隔离，行锚点使用原始 `rowIndex`
- `cell_edits`：`(version_id, row_index, column_key)` 唯一，存储草稿值和 `revision`
- `shares`：暂缓功能，表和 DDL 保留，但当前没有路由和页面

`reports` 表已删除，报告、快照、TipTap 依赖已清理。

## 权限

| 角色 | 查看 | 编辑单元格 | 评论 | 保留/清除版本 | 管理成员/文件 | 导出 |
|---|---|---|---|---|---|---|
| owner | 是 | 是 | 是 | 是 | 是 | 是 |
| editor | 是 | 是 | 是 | 否 | 否 | 是 |
| commenter | 是 | 否 | 是 | 否 | 否 | 有草稿时需 owner 处理 |
| viewer | 是 | 否 | 否 | 否 | 否 | 有草稿时需 owner 处理 |

- 首版上传：owner/editor。
- 任意 ready 版本都可编辑，包括旧版本。
- 保留版本和清除改动仅 owner。
- JWT 在 `Authorization: Bearer <token>`；WebSocket 用 `?token=`。
- 评论创建：owner/editor/commenter。

## 上传与行读取

1. 前端 Worker 解析 Excel/CSV 成 `ParsedSheet`。
2. 首版：`POST /api/workspaces/:id/files` 创建文件和 uploading v1。
3. 每 500 行一个 chunk，`PUT /api/versions/:versionId/chunks/:index`。
4. `POST /api/versions/:versionId/complete` 校验分片并置为 ready，更新 `files.latest_version_number`。
5. 行读取：`GET /api/versions/:versionId/rows`，读取需要的 chunk，再叠加该版本 `cell_edits`，最后搜索/排序/切片。
6. 前端 `useRemoteRows` 按 200 行分页加载，缓存到 IndexedDB `cosheet-row-cache`。

新版本不再通过上传创建；`POST /api/files/:id/versions` 已删除。

## 协同编辑

- 前端 `RemoteVirtualTable` 双击单元格编辑。
- `PATCH /api/versions/:versionId/cells/:rowIndex` 写入 `cell_edits`。
- 编辑使用事务 + 文件行锁 + 版本行锁，与保留版本串行。
- WebSocket 房间：`version:<versionId>`。
- 服务端消息：
  - `joined`、`presence`
  - `cursor`、`cursor:clear`
  - `cell:update`
  - `version:created`
  - `cells:cleared`
  - `error`
- 同一单元格 last-write-wins，revision 由服务端递增。
- 前端按版本缓存连接；切换/卸载时断开，旧回调通过 generation 丢弃。

## 保留版本

`POST /api/versions/:versionId/retain`，仅 owner。

1. 锁定文件行和源版本行。
2. 读取源版本 chunks + 该版本全部 `cell_edits`。
3. 逐片合并草稿，写入新版本的 chunk 文件。
4. 创建 vN+1（ready），记录 `base_version_id = 源版本`。
5. 更新 `files.latest_version_number`。
6. 清空源版本草稿。
7. 广播 `version:created`，源版本房间在线成员切到新版本。

- 源版本恢复基础数据，但仍可编辑；其他版本不受影响。
- 版本历史允许分叉。
- 评论不迁移到新版本。

## 清除改动

`DELETE /api/versions/:versionId/cells`，仅 owner。

- 锁定文件和版本，删除该版本全部 `cell_edits`。
- 广播 `cells:cleared`。
- 前端清空该版本行缓存并重新加载。
- 不影响其他版本和已保留的新版本。

## 导出

入口在 `FileView` 的“导出”按钮，使用 `src/utils/versionExport.ts`。

- 导出当前选中版本，按原始行顺序，包含已应用的修改。
- Excel：`xlsx`，完整版本。
- PDF：全部行，竖向 A4，多页；每页约 35 行，用 `html2canvas` 截图后写入 `jsPDF`。
- 有草稿时：
  - 无草稿：直接打开导出弹窗。
  - owner：先选择“保留版本并导出”或“清除改动并取消导出”；关闭弹窗不操作。
  - 保留成功后再打开导出弹窗，导出新版本。
  - 清除成功则不导出。
  - 非 owner：提示等待 owner 处理。

## 重要约束

- 不实现 AI、图表、ECharts、报告、快照、TipTap。
- 保留 `xlsx`、`html2canvas`、`jsPDF` 供版本导出。
- 真实 Express + MySQL，不使用 mock、ORM、NestJS。
- 不提交 `.env`、数据库文件、`server/storage/`。
- `noUncheckedIndexedAccess: true`，注意数组/对象空值。
- Element Plus 组件由自动导入提供；Vue API 需要显式 import。
- 测试数据必须清理；不要删除用户真实数据。
- 修改前先读相关代码；一次一格，先给出文件/职责表，再实现，最后报告实际改动和验证结果。
- 用户未明确要求时不要额外写代码。

## 当前状态

已完成：认证、工作空间、成员、首版上传、虚拟表格、评论、实时协同、任意版本编辑、保留/清除版本、Excel/PDF 导出。

暂缓：

- 只读分享链接
- 外链编辑（分享链接 + 登录/注册后加入工作空间）

未实现/可选：

- 版本 diff
- 回收站
- 文件重命名/移动
- 原文件下载
- 列表虚拟滚动
- 离线缓存提示
- E2E 测试

孤儿上传数据清理暂不处理。

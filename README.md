# CoSheet 云端表格协作平台

CoSheet 是一个多人协同的在线表格平台：上传 Excel/CSV 后，可以在浏览器中查看、搜索、排序、评论和编辑单元格；多人实时同步，owner 可以把当前修改保留为新版本，也可以将版本导出为 Excel 或 PDF。

## 功能

- 注册、登录、JWT 登录态、路由守卫
- 工作空间和个人工作空间
- 成员管理：owner / editor / commenter / viewer
- Excel/CSV 首版上传：Worker 解析、分片上传、断点续传
- 虚拟滚动表格：服务端分页、搜索、排序、IndexedDB 行缓存
- 任意 ready 版本可编辑，单元格草稿实时同步
- WebSocket 在线用户、远程光标、单元格更新
- owner 保留版本：把草稿物化为新版本，支持版本分叉
- owner 清除改动：回退当前版本
- 行级评论，评论按版本隔离
- 当前版本导出 Excel 或 PDF
- 可拖动调整左侧栏宽度

## 技术栈

**前端**

- Vue 3 + Vite + TypeScript
- Pinia
- Element Plus
- `xlsx`（Excel 解析和导出）
- `idb`（IndexedDB）
- `html2canvas` + `jsPDF`（PDF 导出）
- WebSocket 原生客户端

**后端**

- Node.js + Express + TypeScript
- MySQL 8 + `mysql2/promise`，不使用 ORM
- JWT + bcryptjs
- `ws` WebSocket
- 分片 JSON 文件存储在 `server/storage/chunks/`

## 目录结构

```text
src/
├── api/http.ts                 # fetch 封装、JWT、401 处理
├── components/
│   ├── AppSidebar.vue          # 工作空间侧栏
│   ├── CommentsPanel.vue       # 行评论
│   ├── ExportDialog.vue        # Excel/PDF 导出
│   ├── PendingVersionDialog.vue# 导出前保留/清除决策
│   ├── FileUploadDialog.vue    # 首版上传
│   ├── MembersDialog.vue       # 成员管理
│   ├── UnfinishedUploads.vue   # 未完成上传恢复
│   ├── VersionSelector.vue     # 版本切换
│   └── DataTable/
│       └── RemoteVirtualTable.vue
├── composables/
│   ├── useFileParse.ts         # Worker 解析
│   ├── useRealtime.ts          # WebSocket 状态
│   └── useRemoteRows.ts        # 远程行分页缓存
├── services/                   # auth/workspace/file/version/comment/realtime
├── stores/                     # auth/workspace
├── types/                      # 基础类型、API、实时消息
├── utils/                      # token、rowCache、上传恢复、导出、颜色
├── views/
│   ├── LoginView.vue
│   ├── WorkspaceView.vue       # 文件列表和成员入口
│   └── FileView.vue            # 表格、协同编辑、评论、版本、导出
└── workers/excel-parser.worker.ts

server/
├── sql/schema.sql              # MySQL 建表
├── src/
│   ├── routes/                 # auth/workspaces/files/versions/comments/members
│   ├── services/               # 业务逻辑和 SQL
│   ├── realtime/ws.ts          # WebSocket 房间、presence、光标、版本事件
│   ├── storage/chunks.ts       # chunk 文件读写
│   └── index.ts                # HTTP + WebSocket 启动
└── storage/                    # 运行时 chunk 文件，不提交
```

`src/views/DataView.vue`、`src/views/Upload.vue`、`src/stores/data.ts`、`src/utils/datasetDB.ts` 是旧版遗留文件，不在当前路由和主流程中。

## 本地启动

### 环境要求

- Node.js：`^20.19.0` 或 `>=22.12.0`
- pnpm
- MySQL 8

### 1. 安装依赖

```bash
pnpm install
pnpm --dir server install
```

### 2. 建库建表

```bash
mysql -u root -p < server/sql/schema.sql
```

`schema.sql` 会创建并使用 `cosheet` 数据库。

### 3. 配置后端环境变量

复制示例文件：

```bash
cp server/.env.example server/.env
```

需要配置：

```dotenv
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的密码
DB_NAME=cosheet
JWT_SECRET=足够长的随机字符串
STORAGE_DIR=./storage
CORS_ORIGIN=http://localhost:5173
```

`.env` 不提交到 Git。

### 4. 启动

```bash
pnpm dev:full
```

或者分别启动：

```bash
# 前端，http://localhost:5173
pnpm dev

# 后端，http://localhost:3000
pnpm server
```

前端通过 Vite 代理 `/api` 和 `/ws` 到后端。

## 使用流程

1. 注册并登录，系统自动创建个人工作空间。
2. owner 在成员管理中按邮箱添加已注册用户，设置 editor / commenter / viewer。
3. 在工作空间上传第一版 `.xlsx/.xls/.csv` 文件。
4. 打开文件，查看、搜索、排序表格；owner/editor 可以双击单元格编辑。
5. 修改会先作为当前版本的草稿，实时同步给同版本在线成员。
6. owner 点击“保留版本”，把当前版本草稿生成新版本；也可以点击“清除改动”回退。
7. 在文件页导出当前版本：Excel 导出全部数据；PDF 导出全部行、竖向 A4 多页。
8. 如果导出时有未保留修改，owner 需要先选择“保留版本并导出”或“清除改动并取消导出”。

## 版本规则

- 第一版通过 Excel/CSV 上传，之后不再手动上传新版本。
- 所有 ready 版本都可以编辑。
- 编辑先写入该版本的 `cell_edits` 草稿。
- owner 可以从任意版本保留版本，新版本以该版本和它的草稿为基础，并记录 `base_version_id`。
- 保留成功后源版本草稿清空，源版本恢复基础数据但仍可编辑。
- 版本历史允许分叉，例如已有 v1、v2，修改 v1 并保留会生成基于 v1 的 v3。
- 评论按版本隔离，新版本不继承旧评论。

## 权限

| 角色 | 查看 | 编辑单元格 | 评论 | 保留/清除版本 | 管理成员 | 导出 |
|---|---|---|---|---|---|---|
| owner | 是 | 是 | 是 | 是 | 是 | 是 |
| editor | 是 | 是 | 是 | 否 | 否 | 是 |
| commenter | 是 | 否 | 是 | 否 | 否 | 有草稿时需 owner 处理 |
| viewer | 是 | 否 | 否 | 否 | 否 | 有草稿时需 owner 处理 |

## 当前范围

已完成：认证、工作空间、成员、首版上传、虚拟表格、评论、实时协同、版本保留/清除、Excel/PDF 导出。

暂缓：只读分享链接、外链编辑。

未实现/可选：版本 diff、回收站、文件重命名/移动、原文件下载、列表虚拟滚动、离线提示、E2E 测试。

## 常用脚本

```bash
pnpm dev          # 前端
pnpm server       # 后端
pnpm dev:full     # 前后端同时启动
pnpm type-check   # vue-tsc 类型检查
pnpm build        # 前端类型检查 + 构建
pnpm lint         # oxlint + eslint
```

后端：

```bash
pnpm --dir server dev
pnpm --dir server build
pnpm --dir server start
```

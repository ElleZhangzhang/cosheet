# DataSheet 云端表格协作平台 — 改造 Handoff 文档

> 目标读者：负责实施改造的 Claude。
> 使用方式：先完整阅读本文，再通读现有代码，按第 9 节的阶段顺序实施。
> 核心约束：**删除所有 AI 与图表功能；使用真实 Node 后端（不用 mock）；保留 Web Worker 文件解析、IndexedDB 分片/缓存、虚拟滚动、版本导出 Excel/PDF。报告和表格快照不做。**

---

## 0. 一句话目标

把现有「浏览器本地 Excel 数据分析工具」改造成一个 **可登录、可上传、可分享、可评论、可协同编辑、可导出版本 Excel/PDF 的云端表格协作平台**：

- 前端：Vue 3 + Vite + TypeScript + Pinia + Element Plus
- 后端：Node.js + Express + MySQL（真实后端），后续可平移到 Java / Spring Boot
- 文件数据：前端 Worker 解析 Excel → 分片上传 → 服务端持久化 → 虚拟表格按需拉取 → IndexedDB 缓存
- 协作：工作空间、成员角色、行级评论、真实分享链接、版本历史、单元格实时协同、owner 保留版本、版本导出 Excel/PDF

**最终形态**：类似「轻量版腾讯文档/飞书表格」的数据表格协作平台，而不是 AI 图表生成器。

---

# 第一部分：原项目总结

## 1. 当前产品形态

当前项目是纯前端的本地数据工具，没有账号、没有后端、没有数据库服务器，所有数据都在浏览器里。

现有闭环：

1. 用户在 `DataView.vue` 左侧点击「添加新档案」，选择 Excel 文件
2. `useFileParse` 启动 Web Worker，用 SheetJS 解析第一个工作表
3. 解析出的 `Dataset` 同时进入 Pinia（内存）和 IndexedDB（持久化）
4. `VirtualTable` 用虚拟滚动展示行数据
5. AI 推荐/手动创建 ECharts 图表，图表可拖拽
6. TipTap 报告编辑器可嵌入图表，AI 生成报告，导出 PDF

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Vue 3.5（Composition API + `<script setup>`） |
| 构建 | Vite 7 |
| 语言 | TypeScript 5.9（`noUncheckedIndexedAccess: true`） |
| 状态 | Pinia 3 + `pinia-plugin-persistedstate` |
| UI | Element Plus（自动导入） |
| 表格 | 自研虚拟滚动（非 Element Plus Table） |
| 文件解析 | `xlsx`（SheetJS）+ Web Worker |
| 本地存储 | `idb`（IndexedDB） |
| 图表 | ECharts 6（**将删除**） |
| 路由 | vue-router 5 |
| AI | DashScope / 通义千问，经 Vite 代理 `/api` 调用（**将删除**） |

开发命令（`package.json`）：

```bash
pnpm dev          # Vite
pnpm build        # type-check + build
pnpm type-check   # vue-tsc --build
pnpm lint         # oxlint + eslint --fix
```

Vite 当前把 `/api` 代理到 `https://dashscope.aliyuncs.com`，`.env` 中有 `VITE_DEEPSEEK_KEY`。改造后这两个都要删除/替换。

## 3. 现有功能与实现细节

### 3.1 文件上传与 Worker 解析

关键文件：`src/composables/useFileParse.ts`、`src/workers/excel-parser.worker.ts`

- `useFileParse().parseFile(file)` 每次创建新的 module Worker：
  ```ts
  new Worker(new URL('@/workers/excel-parser.worker.ts', import.meta.url), { type: 'module' })
  ```
- Worker 内使用 `FileReaderSync.readAsArrayBuffer` + `XLSX.read` + `XLSX.utils.sheet_to_json`，**只解析第一个 sheet**。
- 行被加上 `id: 'row-${index}'`。
- 列类型推断只采样前 100 行：全都能转 number → `number`；全都能 `Date.parse` → `date`；否则 `string`。
- 返回完整 `Dataset`（含全部 rows）给主线程。
- 主线程解析成功后直接 `dataStore.addDataset(payload.dataset)` 并持久化。

**保留价值**：这是项目最有技术含量的部分之一。改造后仍由 Worker 解析，主线程只负责上传和展示。

### 3.2 IndexedDB 分片存储

关键文件：`src/utils/datasetDB.ts`

- 数据库名 `data-platform`，版本 2。
- 两个 store：
  - `datasets`：元数据（id、name、columns、createAt、rowCount、columnCount），keyPath `id`
  - `rows`：行数据，key 为 `[datasetId, chunkIndex]`，每 500 行一个 chunk
- `upgrade` 中处理 v1 → v2：把旧版内嵌在 Dataset 里的 rows 拆成 chunk 写入 `rows` store。
- 提供：
  - `getAllDatasetsFromDB()`：只读元数据，补 `rows: []`
  - `getDatasetFromDB(id)`：并行读取全部 chunk，合并成完整 Dataset
  - `getDatasetRowsFromDB(id, start, count)`：按范围并行读取涉及的 chunk（**目前未被调用**）
  - `upsertDatasetToDB(dataset)`：事务内写元数据 + 分块写 rows
  - `deleteDatasetFromDB(id)`：删除元数据和所有 chunk
- 每 chunk 500 行；`getDatasetFromDB` 用 `Promise.all` 并行读取所有 chunk。

**问题**：`data.ts` 中选中数据集时会一次性加载全部 chunk，10 万行数据全部进内存；`getDatasetRowsFromDB` 已经写好但没有接入虚拟滚动。

**改造后**：IndexedDB 不再是唯一数据源，而是**服务端数据的本地缓存**。分片概念保留：上传按 500 行分片，服务端也按 chunk 存储，前端缓存分页/chunk。

### 3.3 Pinia 数据 store

关键文件：`src/stores/data.ts`

- `datasets: shallowRef<Dataset[]>`，`currentDataset: shallowRef<Dataset | null>`
- `hydrateDatasets()` 初始化时从 IndexedDB 读元数据；尝试用 `localStorage.lastDatasetId` 恢复上次数据集。
- `setCurrentDataset(id)`：先设置元数据（rows 为空），再 `loadDatasetRows(id)` 异步加载全部行。
- `loadDatasetRows` 有 in-flight 去重（`Map<string, Promise<void>>`）和失败提示。
- 删除数据集时同步清理 IndexedDB、当前选中和 localStorage 残留 ID。
- 已知问题：`hydrateDatasets` 恢复上次数据集时，如果 `currentDataset` 为 null，`loadDatasetRows` 的守卫 `currentDataset.value?.id === id` 不通过，刷新恢复会失效。改造后整个 store 会被替换，不需要修复。

### 3.4 虚拟滚动表格

关键文件：`src/components/DataTable/useVirtualScroll.ts`、`VirtualTable.vue`

- 固定行高 51px，容器高度 592px，上下缓冲 5 行。
- `useVirtualScroll(getData, itemHeight, containerHeight)`：
  - 用 getter 注入数据，避免 `props.data` 解构后失去响应式
  - 计算 `startIndex`、`endIndex`、`visibleData`、`totalHeight`、`offsetY`
  - 用 `transform: translateY(offsetY)` 定位可见行
  - 数据变化时把 `scrollTop` 重置为 0
- `VirtualTable` 渲染 `visibleData`，用 `Object.entries(obj).filter(([key]) => key !== 'id')` 取值，**没有使用 columns 定义**。
- 表头是 `DataView.vue` 里单独写的一个 mock 表头，不是表格组件的一部分。
- 每格用 `el-tooltip` 展示完整值。

**改造点**：改成“远程行 + 稀疏数组”的虚拟表格；使用 columns 定义渲染；表头固定；行数来自服务端 `total`；滚动时按可见范围请求数据，而不是一次性拿全部 rows。

### 3.5 ECharts 图表与 AI 推荐（全部删除）

- `BaseChart.vue`：ECharts 实例、4 种类型（bar/line/pie/scatter）、分箱（3–20 箱，默认 8）、LTTB 采样、rAF 延迟初始化、拖拽定位。
- `ChartConfigDialog.vue`：手动创建图表。
- `ChartRecommendDialog.vue` + `src/apis/qianwen.ts`：
  - 把字段统计（唯一值数量、min/max、样本值）发给通义千问
  - 四层校验：类型白名单、字段归一化、组合去重、最多 3 条
  - 规则引擎兜底、指数退避重试（429/5xx，2^n 延迟封顶 8s）
- `dashboard` store 持久化 charts 和报告内容到 localStorage。
- `ChartEmbedExtension` / `ChartEmbedNodeView`：TipTap 中嵌入实时 ECharts 图表，用 `VueNodeViewRenderer`。

**结论**：这些模块整体删除，不要在新平台中保留任何 AI、ECharts 或图表相关代码/依赖/UI。

### 3.6 TipTap 报告与 PDF

关键文件：`src/views/ReportEditor.vue`、`src/components/ReportEditor/ChartEmbedExtension.ts`、`ChartEmbedNodeView.vue`

- 编辑器扩展：StarterKit（标题 1–3）、Placeholder、Table/TableRow/TableCell/TableHeader、ChartEmbedExtension。
- 报告内容在 `dashboard` store 中按 datasetId 缓存，防抖 2 秒保存到 localStorage。
- AI 生成报告：`generateReport` 生成 HTML，其中 `data-chart-id="c0"` 等占位符被替换成真实 chart UUID，再用 `setContent` 写入 TipTap。
- `ChartEmbedExtension` 是 `atom: true`、`draggable: true` 的块级节点：
  - 属性：`chartId`、`chartTitle`、`chartType`
  - `parseHTML` 匹配 `div[data-chart-id]`
  - `renderHTML` 输出带 `data-*` 属性的 div
  - `addNodeView` 返回 `VueNodeViewRenderer(ChartEmbedNodeView)`
- `ChartEmbedNodeView` 通过 `NodeViewProps` 拿 `node`、`selected`、`deleteNode` 等，用 `chartId` 反查 dashboard store，渲染实时 ECharts，并用 ResizeObserver 自适应。
- PDF 导出（`ReportEditor.vue:185-247`）：
  1. 选取 `.ProseMirror`
  2. 动态 import `html2canvas` / `jspdf`
  3. `scale: 2` 截图，白底
  4. `toDataURL('image/png')`
  5. A4 210×297mm，左右各 8mm，图片宽 194mm，高度等比
  6. `while (heightLeft > 0)` 逐页 `addPage` + `addImage`
  7. `pdf.save('..._分析报告.pdf')`

**改造后**：报告、TipTap 报告内容和旧报告 PDF 导出删除；版本导出 Excel/PDF 使用新实现，见第 30 节。

### 3.7 路由与类型

- `src/router/index.ts`：`/` → DataView；`/report-editor` → ReportEditor；没有登录和守卫。
- `src/types/index.ts`：`DataRow`、`ColumnDef`、`Dataset`、`ChartConfig`、`ChartTransform`。`ColumnDef.type` 目前是 `any`。
- `App.vue` 只有 `<router-view />`。
- `main.ts` 注册 Pinia（含持久化插件）和 router。

### 3.8 现有文件清单与处理建议

实际 `src/` 目录只有以下文件（`CLAUDE.md` / `README.md` 中提到的 `Upload.vue`、`Dashboard.vue`、`components/Dashboard/*`、`AIAnalysis/*` 已经不存在，文档已过期）：

| 文件 | 处理 |
|---|---|
| `src/apis/qianwen.ts` | **删除** |
| `src/components/Charts/BaseChart.vue` | **删除** |
| `src/components/Charts/ChartConfigDialog.vue` | **删除** |
| `src/components/Charts/ChartRecommendDialog.vue` | **删除** |
| `src/components/DataTable/useVirtualScroll.ts` | **保留并改造**（支持远程行数、可见范围回调） |
| `src/components/DataTable/VirtualTable.vue` | **保留并改造**（远程行、columns 驱动、固定表头） |
| `src/components/ReportEditor/ChartEmbedExtension.ts` | **删除**：报告和图表均取消 |
| `src/components/ReportEditor/ChartEmbedNodeView.vue` | **删除** |
| `src/composables/useDrag.ts` | 可删除（仅图表拖拽使用）；如要做列宽拖拽再保留 |
| `src/composables/useFileParse.ts` | **保留并改造**：只解析，不直接写 store；配合上传流程 |
| `src/stores/data.ts` | **替换**为 workspace/auth/file 相关 store |
| `src/stores/dashboard.ts` | **删除**（charts、report 本地缓存都移走） |
| `src/types/index.ts` | **重构**：保留 DataRow/ColumnDef 基础类型，删除 ChartConfig/ChartTransform |
| `src/utils/datasetDB.ts` | **替换**为 `rowCache.ts`（IndexedDB 缓存）；旧 DB 可不迁移 |
| `src/views/DataView.vue` | **重写/拆分为平台页面** |
| `src/views/ReportEditor.vue` | **删除**：报告和 PDF 功能均取消 |
| `src/workers/excel-parser.worker.ts` | **保留并改造**：输出 ParsedSheet，不生成服务端 ID；修复类型 |
| `src/App.vue` | 保留 `<router-view />` |
| `src/main.ts` | 保留 Pinia + router 初始化 |
| `src/router/index.ts` | **重写**：登录、工作空间、文件、分享路由 + 守卫 |
| `src/assets`、全局样式 | 按新页面调整 |
| `.history/` | 忽略，不要修改或提交 |
| `.env` | 删除 `VITE_DEEPSEEK_KEY`；新增后端环境变量说明 |
| `vite.config.ts` | **修改代理**：`/api` → `http://localhost:3000`，去掉 rewrite 和 dashscope |
| `package.json` | 删除 `echarts` 和不再使用的 TipTap；保留 xlsx/idb/html2canvas/jsPDF 供版本导出 |
| `CLAUDE.md` / `README.md` | **重写**为新架构说明 |

### 3.9 已知问题 / 技术债

1. `pnpm type-check` 存在若干既存错误（Worker 的 `FileReaderSync`、类型导入、`noUncheckedIndexedAccess` 等）。改造时应一并清理，至少不新增错误。
2. `dataStore` 选中数据集时一次性加载所有 chunk；新平台必须改为按需加载。
3. `VirtualTable` 不使用 columns，依赖对象键顺序；新表格必须按 columns 渲染。
4. `useVirtualScroll` 在数据变化时重置滚动位置；远程分页填充数据时不应重置。
5. `hydrateDatasets` 的刷新恢复 bug（见 3.3）；新架构直接替换。
6. `BaseChart` 与 `ChartEmbedNodeView` 各写一套图表构建逻辑；全部删除，不再重复。
7. 客户端 `Date.now()` 生成 dataset ID，存在碰撞风险；服务端统一用 `crypto.randomUUID()`。
8. `.history` 目录里有大量历史快照，git status 显示已删除；不要碰。
9. 当前项目没有测试。

---

# 第二部分：目标产品

## 4. 产品定位

**DataSheet — 团队数据表格协作平台**

一句话：团队把 Excel/CSV 上传到工作空间，在线查看、搜索、排序、评论和协同编辑数据；owner 可把当前修改保留为新版本，通过分享链接把某张表只读展示给外部。

### 4.1 角色与权限

工作空间角色：

| 角色 | 查看 | 编辑单元格 | 评论 | 保留版本 | 管理成员/文件 |
|---|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| editor | ✅ | ✅ | ✅ | ❌ | ❌ |
| commenter | ✅ | ❌ | ✅ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

- 首次上传文件版本：owner/editor。
- 所有 ready 版本都可编辑。
- 只有 owner 可以从任意版本点击“保留版本”生成新版本。
- 保留成功后，源版本的草稿清空，源版本恢复为基础数据；新版本记录 `baseVersionId`。

分享链接角色（v1）：

- `viewer`：匿名只读，可看表格，不能评论、不能编辑。
- 后续可扩展 `commenter`（需登录）。

注册时自动创建一个个人工作空间，用户是 owner。

### 4.2 v1 功能范围

1. **认证**：注册、登录、登出、JWT、路由守卫、401 自动跳登录。
2. **工作空间**：列出/创建；成员管理（按邮箱添加已注册用户、设置角色、移除）。
3. **文件管理**：上传 `.xlsx/.xls/.csv`；列表、按名称搜索；打开表格；软删除（回收站 UI 可后置）。
4. **上传**：前端 Worker 解析 → 创建文件/版本 → 分片上传 → 完成；显示进度、失败重试。
5. **在线表格**：
   - 远程分页 + 虚拟滚动（固定行高）
   - 固定表头、按 columns 渲染、类型格式化
   - 服务端搜索（关键字）与按列排序
   - 单元格编辑（owner/editor）
   - WebSocket 实时同步、在线用户与光标
   - 版本选择；所有 ready 版本可编辑
   - 行级评论入口
6. **评论**：对某行创建评论、列表、标记解决；按版本隔离；侧边栏展示。
7. **分享（暂缓）**：为文件创建只读分享链接（可设过期天数）；公开路由 `/s/:token` 跨设备可访问；服务端校验 token 和过期时间。和外链编辑一起做。
8. **版本历史**：第一版通过 Excel 上传；所有 ready 版本可编辑；owner 可从任意版本点击“保留版本”把该版本的草稿提交为新版本；版本历史允许分叉并记录 `baseVersionId`；版本 diff 放 Phase 4。
9. **版本导出**：把当前版本导出为 Excel（完整版本）或 PDF（竖向 A4、多页、全部行）；包含草稿值。
10. **基础运营**：种子账号、示例工作空间、错误提示、加载态。

### 4.3 明确不做（v1 非目标）

- ❌ AI 推荐图表、AI 生成报告、任何 LLM 调用
- ❌ ECharts / 图表 / 仪表盘 / 图表拖拽
- ❌ 字符级 OT/CRDT 合并（v1 采用单元格级 last-write-wins）
- ❌ Excel 公式引擎、行列插入/删除（暂不做）
- ❌ 复杂 RBAC / 审批流 / 组织架构
- ❌ 微服务、Redis、消息队列
- ❌ 完整回收站、标签、活动日志、通知（可后续）
- ❌ 分享链接匿名评论（v1 只读）
- ❌ 报告列表/报告 CRUD/TipTap 报告编辑器
- ❌ 表格快照预览、报告式 PDF
- ❌ 后端解析 Excel（v1 保持前端 Worker 解析）

---

# 第三部分：目标架构

## 5. 技术选型

### 前端

沿用现有栈：

- Vue 3 + Vite 7 + TypeScript
- Pinia（auth 可持久化 token；业务数据不持久化）
- Element Plus（自动导入）
- `xlsx` + Web Worker
- `idb`（缓存）
- vue-router

删除：`echarts`、AI 相关代码。

### 后端（真实，不用 mock）

- **Node.js + Express + TypeScript**（不用 NestJS、不用 Prisma）
- **MySQL 8.0+**（真实数据库；用 `mysql2/promise` 连接池 + 参数化 SQL，不引入 ORM）
- **jsonwebtoken + bcryptjs**（纯 JS 密码哈希，避免 Windows 下 bcrypt 原生编译问题；哈希与 Java BCrypt 兼容）
- **手写校验函数 + 统一错误处理中间件**（不引入 Nest 的 DTO/Guard；用 Express middleware 实现认证和角色校验）
- 分片 JSON 存本地文件系统 `server/storage/`；文件/版本/评论/分享元数据存 MySQL
- 端口 3000；所有接口前缀 `/api`

> 数据库是必需的：账号、工作空间、成员、文件版本、评论、分享链接都需要跨设备持久化，不能放浏览器。
> 选择 Express + 原生 SQL 是为了匹配你已有的 Node/Express 基础，同时保持表结构简单，方便之后用 Java/JDBC/MyBatis 重写。
> 开发期可以用本机 MySQL、XAMPP/WAMP 的 MySQL，或者 Docker 起一个 MySQL 8 容器。

### 目录结构（目标）

```
/
├── src/                     # Vue 前端
│   ├── api/http.ts          # fetch 封装：baseURL、JWT、错误归一化、401 处理
│   ├── services/            # auth/workspace/file/comment/share
│   ├── stores/              # auth.ts、workspace.ts（业务状态）
│   ├── views/
│   │   ├── LoginView.vue
│   │   ├── WorkspaceView.vue      # 文件列表 + 侧边栏
│   │   ├── FileView.vue           # 表格 + 评论 + 分享 + 版本 + 保留版本
│   │   └── SharedFileView.vue     # /s/:token 公开只读页
│   ├── components/
│   │   ├── AppSidebar.vue
│   │   ├── FileUploadDialog.vue
│   │   ├── RemoteVirtualTable.vue # 或改造 VirtualTable.vue
│   │   ├── CommentsPanel.vue
│   │   ├── ShareDialog.vue
│   │   ├── MembersDialog.vue
│   │   └── VersionSelector.vue
│   ├── workers/excel-parser.worker.ts
│   ├── utils/rowCache.ts    # IndexedDB 缓存
│   ├── types/api.ts         # 或 shared/api.ts
│   ├── router/index.ts
│   ├── App.vue
│   └── main.ts
├── server/                  # Express 后端
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── sql/
│   │   └── schema.sql       # MySQL 建库建表 DDL
│   ├── scripts/
│   │   ├── seed.ts          # 种子账号 + 示例工作空间
│   │   └── init-db.ts       # 可选：执行 schema.sql
│   ├── src/
│   │   ├── index.ts         # 启动 HTTP server
│   │   ├── app.ts           # Express app、中间件、路由挂载
│   │   ├── db/pool.ts       # mysql2/promise 连接池
│   │   ├── middleware/      # auth、roles、error、asyncHandler
│   │   ├── routes/          # auth/workspaces/files/comments/shares
│   │   ├── services/        # 业务逻辑 + SQL（每个领域一个 service）
│   │   ├── storage/         # chunk 文件读写
│   │   └── utils/           # jwt、password、validate、httpError
│   └── storage/             # 运行时生成，gitignore
├── shared/                  # 可选：前后端共享 DTO 类型
├── REFACTOR_PLAN.md
├── vite.config.ts
└── package.json
```

> 共享类型可建 `shared/api.ts`（纯 TS 接口），前后端各自引用。若 pnpm workspace 配置成本高，前后端各保存一份类型也可以，但字段必须严格一致。

## 6. 核心数据流

### 6.1 上传

```
选择文件
 → Web Worker 解析（第一个 sheet）
 → 得到 ParsedSheet { name, columns, rows, rowCount, columnCount }
 → POST /api/workspaces/:workspaceId/files  （创建 file + 第 1 个 version，status=uploading）
 → 每 500 行一个 chunk，并发 3 个 PUT /api/versions/:versionId/chunks/:index
 → POST /api/versions/:versionId/complete
 → 服务端校验 chunk 完整性、更新 status=ready、更新 file.latestVersionNumber
 → 跳转 FileView
```

- 行 `id` 使用 `row-${index}`；服务端同时记录原始 `rowIndex`。
- 前端可把上传成功的 chunk 顺手写入 IndexedDB 缓存，进入表格时更快。
- 上传失败：保留已完成 chunk 索引，允许重试；支持取消（删除 uploading version）。
- 原始 Excel 文件 v1 不强制保存（表格数据已持久化）；后续可加原文件下载。

### 6.2 表格读取

```
GET /api/files/:fileId
 → 返回 file + latest ready version（columns、rowCount、chunkCount）

GET /api/versions/:versionId/rows?offset=&limit=&q=&sortBy=&sortDir=
 → 服务端读取 chunk 文件
 → 无搜索/排序：只读相关 chunk，切片
 → 有搜索/排序：合并全部 chunk，过滤/排序后切片
 → 返回 { rows, total, offset, limit }
 → 前端写入 IndexedDB 分页缓存
 → RemoteVirtualTable 按可见范围请求缺失页
```

每行返回：

```json
{
  "id": "row-123",
  "rowIndex": 123,
  "Name": "Alice",
  "Salary": 12000
}
```

`rowIndex` 是**原始版本中的行号**，评论锚点用它；排序/搜索改变显示顺序时也不受影响。

### 6.3 分享（暂缓）

> 只读分享和外链编辑一起暂缓，用户有空时再做。

```
POST /api/files/:fileId/shares { role: "viewer", expiresInDays: 7 }
 → 生成随机 token，存 DB
 → 返回 { token, url }

外部用户打开 /s/:token
 → GET /api/shares/:token         （公开，无 JWT）
 → 返回文件、最新 ready 版本、列、行数、权限
 → GET /api/shares/:token/rows?...（公开）
 → 只读表格
```

- token 用 `crypto.randomBytes(24).toString('hex')`。
- 服务端校验过期时间；过期返回 410 或 404。
- v1 不允许匿名评论。

### 6.4 版本保留

- 第一版仍通过 Excel 上传创建 v1。
- v1 ready 后，不再手动上传新版本。
- owner/editor 可以编辑任意 ready 版本；修改先写入该版本的 `cell_edits`，作为草稿。
- owner 在任意版本点击“保留版本”：
  1. 校验 owner、文件未删除、版本 ready、该版本 `pendingEditCount > 0`。
  2. 对文件加锁；提交期间任何版本的新的编辑和再次保留返回 409。
  3. 读取该版本所有 chunk rows，并叠加该版本的 `cell_edits`。
  4. 把合并后的数据写成新版本的 chunk 文件，创建 vN+1（直接 ready）和 chunks 记录。
  5. 记录 `base_version_id = 源版本 id`，更新 `files.latest_version_number`。
  6. 清空源版本的 `cell_edits`，修改已进入新版本。
  7. 向源版本房间广播 `version:created`；源版本房间的在线成员自动切到新版本。
- 新版本的基础数据已包含草稿值，新版本自身没有 `cell_edits`。
- 源版本恢复为基础数据，但仍可再次编辑；其他版本完全不受影响。
- 版本历史允许分叉：
  - 例如已有 v1、v2，修改 v1 并保留，会生成基于 v1 的 v3；v2 保留。
  - 之后修改 v2 并保留，会生成基于 v2 的新版本。
- owner 不点保留时，修改继续作为草稿，不产生新版本。
- owner 可以点击“清除改动”：
  1. 文件加锁，删除该版本全部 `cell_edits`。
  2. 版本恢复为基础数据，但仍是 ready、仍可编辑。
  3. 广播 `cells:cleared`，所有查看该版本的客户端清空行缓存并重新加载。
  4. 清除只影响当前版本，不影响其他版本和已保留的新版本。
- 评论按版本隔离，新版本不继承旧版本评论。
- 只有 owner 能保留版本；editor 只能编辑草稿。
- 文件详情/版本列表返回每个版本的 `pendingEditCount`。

## 7. 本地缓存（IndexedDB）

关键文件（新）：`src/utils/rowCache.ts`

- 新 DB 名，例如 `datasheet-cache`，避免与旧 `data-platform` 冲突。
- store `row-pages`：
  - key：`[versionId, queryKey, pageIndex]`
  - value：`{ rows, total, fetchedAt }`
  - `queryKey = ${q}|${sortBy}|${sortDir}`（对 query 做稳定编码）
- store `meta`（可选）：版本元数据缓存。
- 页面大小 200 或 500 行；TTL 5 分钟；版本切换/新版本视为不同 key。
- IndexedDB 是缓存，不是数据源：清空缓存仅影响首屏速度，不影响正确性。
- 旧 `datasetDB.ts` 可删除或保留为历史代码；不要让它继续承担业务。

## 8. 数据模型（MySQL）

MySQL 8.0+，数据库 `datasheet`，字符集 `utf8mb4`。完整建表脚本放 `server/sql/schema.sql`：

```bash
mysql -u root -p < server/sql/schema.sql
```

> 说明：ID 由 Node 的 `crypto.randomUUID()` 生成；列定义用 MySQL `JSON` 类型；报告 TipTap JSON 用 `LONGTEXT`；时间统一 `DATETIME(3)`。

```sql
CREATE DATABASE IF NOT EXISTS datasheet
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE datasheet;

CREATE TABLE users (
  id            VARCHAR(36)  PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workspaces (
  id         VARCHAR(36)  PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  owner_id   VARCHAR(36)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_workspaces_owner (owner_id),
  CONSTRAINT fk_workspaces_owner
    FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workspace_members (
  id           VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL,
  user_id      VARCHAR(36) NOT NULL,
  role         VARCHAR(20) NOT NULL DEFAULT 'viewer', -- owner|editor|commenter|viewer
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_workspace_member (workspace_id, user_id),
  KEY idx_members_user (user_id),
  CONSTRAINT fk_members_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE files (
  id                    VARCHAR(36)  PRIMARY KEY,
  workspace_id          VARCHAR(36)  NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  latest_version_number INT          NOT NULL DEFAULT 0,
  created_by_id         VARCHAR(36)  NOT NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at            DATETIME(3)  NULL,
  KEY idx_files_workspace (workspace_id, deleted_at),
  CONSTRAINT fk_files_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_files_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE file_versions (
  id             VARCHAR(36) PRIMARY KEY,
  file_id        VARCHAR(36) NOT NULL,
  version_number INT         NOT NULL,
  base_version_id VARCHAR(36) NULL, -- 保留版本的来源版本；首版为 NULL
  columns_json   JSON        NOT NULL,
  row_count      INT         NOT NULL,
  chunk_count    INT         NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'uploading', -- uploading|ready
  created_by_id  VARCHAR(36) NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_file_version (file_id, version_number),
  KEY idx_versions_file (file_id),
  KEY idx_versions_base (base_version_id),
  CONSTRAINT fk_versions_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_versions_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chunks (
  id          VARCHAR(36)  PRIMARY KEY,
  version_id  VARCHAR(36)  NOT NULL,
  chunk_index INT          NOT NULL,
  row_count   INT          NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_version_chunk (version_id, chunk_index),
  CONSTRAINT fk_chunks_version
    FOREIGN KEY (version_id) REFERENCES file_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comments (
  id         VARCHAR(36)  PRIMARY KEY,
  file_id    VARCHAR(36)  NOT NULL,
  version_id VARCHAR(36)  NOT NULL,
  row_index  INT          NOT NULL,
  column_key VARCHAR(255) NULL,
  content    TEXT         NOT NULL,
  resolved   TINYINT(1)   NOT NULL DEFAULT 0,
  author_id  VARCHAR(36)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_comments_row (file_id, version_id, row_index),
  CONSTRAINT fk_comments_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_version
    FOREIGN KEY (version_id) REFERENCES file_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_author
    FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE shares (
  id            VARCHAR(36) PRIMARY KEY,
  token         VARCHAR(96) NOT NULL,
  file_id       VARCHAR(36) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'viewer',
  expires_at    DATETIME(3) NULL,
  created_by_id VARCHAR(36) NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_shares_token (token),
  CONSTRAINT fk_shares_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

```

说明：

- ID 在 Node 端用 `crypto.randomUUID()` 生成，写入 `VARCHAR(36)`。
- `columns_json` 用 MySQL `JSON`；`mysql2` 默认会把 JSON 列解析成 JS 对象，读取时仍建议做一次 `typeof === 'string' ? JSON.parse(...) : ...` 兼容处理。
- `files.latest_version_number` 是冗余字段，首版 `complete` 或 owner 保留版本时更新；读取最新版本时按 fileId + versionNumber 查询。
- 删除文件采用 `deletedAt` 软删除；v1 列表过滤掉已删除。
- 评论按 `versionId` 隔离；新版本旧评论不会自动迁移。
- 角色/状态用 `VARCHAR(20)` 而非 ENUM，方便以后加角色，校验放在应用层。

---

# 第四部分：API 契约

统一前缀 `/api`。除公开分享接口外，均需：

```
Authorization: Bearer <JWT>
```

统一错误格式（Express error middleware 输出）：

```json
{ "statusCode": 400, "message": "..." }
```

分页/查询约定：

- `offset` 从 0 开始
- `limit` 默认 200，最大 500
- `sortDir` 为 `asc` / `desc`
- `sortBy` 必须是该版本 columns 中的 key
- `q` 最长 100 字符

## 9.1 Auth

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | `{ email, password, name }` → `{ token, user }`；自动创建个人工作空间 |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | 当前用户 |

用户对象：`{ id, email, name, createdAt }`。密码最少 8 位，bcryptjs 哈希。JWT 建议 7 天过期，payload `{ sub, email }`。

## 9.2 Workspaces / Members

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workspaces` | 当前用户的工作空间列表（含 role） |
| POST | `/workspaces` | `{ name }`，创建者为 owner |
| GET | `/workspaces/:id/members` | 成员列表 |
| POST | `/workspaces/:id/members` | `{ email, role }`，owner 才能操作 |
| PATCH | `/workspaces/:id/members/:userId` | `{ role }`，owner |
| DELETE | `/workspaces/:id/members/:userId` | owner；不能移除 owner |

## 9.3 Files / Versions / Chunks / Rows

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workspaces/:id/files?q=` | 文件列表（未删除），包含最新版本摘要 |
| POST | `/workspaces/:id/files` | 创建文件 + 第一个版本（uploading） |
| GET | `/files/:id` | 文件详情 + 最新 ready 版本 + 版本列表；每个版本含 `baseVersionId` 和 `pendingEditCount` |
| PATCH | `/files/:id` | `{ name }`；owner/editor |
| DELETE | `/files/:id` | 软删除；owner |
| GET | `/files/:id/versions` | 版本列表 |
| PUT | `/versions/:id/chunks/:index` | `{ rows }`，每片最多 500 行；仅首版上传 |
| POST | `/versions/:id/complete` | `{ rowCount, chunkCount }`，校验后置 ready；仅首版上传 |
| DELETE | `/versions/:id` | 取消上传中的版本 |
| POST | `/versions/:id/retain` | owner；把任意 ready 版本 + 该版本草稿物化为新的 ready 版本，并清空源版本草稿 |
| GET | `/versions/:id/rows` | 表格分页查询（含 cell_edits 覆盖） |
| GET | `/versions/:id/meta` | 版本元数据（可选） |

> `POST /files/:id/versions` 取消：首版之后不再手动上传新版本。`POST /versions/:id/retain` 是唯一的新版本入口。

创建文件/版本请求：

```json
{
  "name": "sales.xlsx",
  "columns": [
    { "keyName": "Name", "label": "Name", "type": "string", "width": 150 }
  ],
  "rowCount": 100000
}
```

返回：

```json
{
  "file": { "id": "...", "name": "sales.xlsx", "latestVersionNumber": 0 },
  "version": { "id": "...", "versionNumber": 1, "status": "uploading", "chunkCount": 200 }
}
```

complete 时服务端校验：

- version 必须是 uploading
- chunkCount === ceil(rowCount / 500)
- 所有 chunk 文件/记录存在
- 每片 rowCount 之和 === rowCount

校验通过：`status = ready`，更新 `file.latestVersionNumber`。

保留版本返回：

```json
{
  "version": {
    "id": "...",
    "versionNumber": 2,
    "baseVersionId": "源版本 id",
    "status": "ready",
    "rowCount": 100000,
    "chunkCount": 200
  },
  "file": { "id": "...", "latestVersionNumber": 2 }
}
```

- 仅 owner 可调用；任意 ready 版本都可以作为源版本。
- 源版本必须有草稿；没有草稿返回 400/409。
- 提交期间文件加锁；任何版本的新的单元格编辑/再次保留返回 409。
- 新版本基础数据为“源版本 chunks + 源版本 cell_edits”。
- 提交成功后清空源版本草稿，记录 `base_version_id`。
- 成功后向源版本房间广播 `version:created`。

行查询返回：

```json
{
  "rows": [
    { "id": "row-0", "rowIndex": 0, "Name": "Alice", "Salary": 12000 }
  ],
  "total": 100000,
  "offset": 0,
  "limit": 200
}
```

## 9.4 Comments

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/files/:id/comments?versionId=` | 评论列表（含作者名） |
| POST | `/files/:id/comments` | `{ versionId, rowIndex, columnKey?, content }` |
| PATCH | `/comments/:id` | `{ resolved }` |
| DELETE | `/comments/:id` | 作者或 owner |

权限：owner/editor/commenter 可创建评论；viewer 只读。

## 9.5 Shares（暂缓）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/files/:id/shares` | `{ role: "viewer", expiresInDays?: number }` → `{ token, url }` |
| GET | `/files/:id/shares` | 已有分享（owner/editor） |
| DELETE | `/shares/:id` | 取消分享 |
| GET | `/shares/:token` | **公开**：文件 + 最新 ready 版本 + 列 + rowCount + 权限 |
| GET | `/shares/:token/rows` | **公开**：同 rows 查询参数 |

公开接口不要求 JWT，但要校验 token 存在、未过期、文件未删除。

## 9.6 Reports（已取消）

> 2026-10-25 决定：不做报告，以下接口不实现；表格快照取消。版本导出见第 30 节，版本工作流见 6.4 和第 29 节。

---

# 第五部分：前端改造

## 10. 路由

建议：

```ts
/login                      LoginView        （公开）
/register                   LoginView（注册模式）或 RegisterView（公开）
/workspaces/:workspaceId    WorkspaceView    （需登录）
/files/:fileId              FileView         （需登录）
/s/:token                   SharedFileView   （公开）
/                           → 登录后跳转第一个工作空间；未登录跳 /login
```

路由守卫：

- 需登录页面：无 token → `/login?redirect=...`
- 已登录访问 `/login`：跳转工作空间
- 公开分享页不挂侧边栏，不请求 `/auth/me`

## 11. HTTP 层与 stores

### `src/api/http.ts`

- `BASE = '/api'`（Vite 代理到 `http://localhost:3000`）
- `request(path, { method, body, auth = true })`
- 自动附加 `Authorization`
- 统一抛 `ApiError { status, message }`
- 401：清除 auth、跳转 `/login`（分享页除外）
- 支持 `AbortSignal`（切换文件/搜索时取消旧请求）

### `src/services/*`

按领域拆分：auth、workspace、file、comment、share。不要直接在页面里写 `fetch`。

### `src/stores/auth.ts`

- `token`、`user`、`isReady`
- `login()`、`register()`、`logout()`、`fetchMe()`
- token 持久化到 localStorage（或 pinia persistedstate）
- 初始化时若有 token，先 `/auth/me` 验证

### `src/stores/workspace.ts`

- `workspaces`、`currentWorkspace`、`members`
- 加载工作空间/成员；切换工作空间时清理文件状态

> 文件列表、表格查询等页面级状态可以放视图内，不必全部塞 Pinia。

## 12. 页面与组件

### LoginView / Register

- 邮箱、密码、姓名
- 登录/注册切换
- 成功后拉取工作空间并跳转
- 错误提示（401/409/网络错误）

### WorkspaceView

- `AppSidebar`：工作空间切换、文件列表、成员入口、上传按钮
- 主区域：文件卡片/表格列表（名称、行数、列数、最新版本、更新时间、分享按钮）
- 搜索框（按名称）
- 成员管理弹窗（owner）：添加已注册用户、角色下拉、移除
- 上传按钮打开 `FileUploadDialog`

### FileView

- 头部：文件名、当前版本、行数/列数、分享、评论开关
- `VersionSelector`：切换版本；旧版本不再标记「只读」；保留版本显示它的 `baseVersionId` 来源
- owner 在任意有草稿的版本看到“保留版本”按钮；editor 不显示
- `FileUploadDialog` 只用于创建文件的第一版；首版 ready 后不再手动上传新版本
- `RemoteVirtualTable`：
  - 固定表头
  - 按 columns 渲染
  - 行高 51px
  - 点击表头排序（服务端）
  - 搜索框 300ms 防抖（服务端）
  - 加载/空/错误状态
  - 行 hover 显示评论按钮和评论数
- `CommentsPanel`：当前行/全部评论、创建、解决
- `ShareDialog`（暂缓）：角色（v1 仅 viewer）、过期天数、生成链接、复制
- 版本列表可放侧边或下拉

### SharedFileView

- `/s/:token`
- 调公开分享 API
- 只读虚拟表格 + 文件信息
- 不显示评论输入、上传、版本切换
- token 失效/过期显示友好错误页

### ReportEditorView（已取消）

> 2026-10-25 决定：不做报告编辑器。`src/views/ReportEditor.vue` 作为遗留文件待清理；版本导出见第 30 节，版本工作流见 6.4 和第 29 节。

## 13. 远程虚拟表格改造

建议拆成：

- `useRemoteRows(versionId, { pageSize = 200 })`
  - 状态：`rowCount`、`rows`（稀疏数组或 `Map<number, DataRow>`）、`loading`、`error`、`query { q, sortBy, sortDir }`
  - `loadRange(start, end)`：计算缺失页，去重请求，写入缓存与 rows
  - `setQuery()`：清空 rows、重置 scrollTop 到 0、重新请求第一页
  - `refresh()`：清缓存、重新拉取
- `useVirtualScroll`
  - 入参改为 `getRowCount()`，不再依赖数据数组长度
  - 返回 `startIndex`、`endIndex`、`totalHeight`、`offsetY`、`handleScroll`
  - 通过 watch 或回调通知父组件「可见范围变化」
  - 不要因为分页数据填充而重置 scrollTop
- `VirtualTable` / `RemoteVirtualTable`
  - props：`columns`、`rowCount`、`getRow(index)`、`loading`
  - 可见区域渲染真实行；未加载行渲染占位（骨架）
  - 固定表头，使用 columns 顺序
  - 不再通过 `Object.entries` 猜测列

缓存：

- `src/utils/rowCache.ts`
- key：`[versionId, queryKey, pageIndex]`
- 写入前检查 `fetchedAt` TTL（5 分钟）
- 版本/查询变化时使用不同 key，不主动清空旧版本缓存（可后续加 LRU）

## 14. 上传流程

`src/composables/useFileParse.ts` 改造：

- 不再调用 `dataStore.addDataset`
- 返回 `ParsedSheet { name, columns, rowCount, columnCount, rows }`
- Worker 输出类型同步修改，去掉 `dataset-${Date.now()}` 的服务端 ID
- 行仍保留 `id: 'row-${index}'`

新增 `FileUploadDialog.vue` / `useUpload`：

1. 解析文件（Worker）
2. 校验：至少一列、至少一行、行列数合理
3. `POST /workspaces/:id/files`（或新版本接口）
4. 按 500 行切片；并发 3 上传
5. 显示 `已上传 x / y 片`
6. 全部成功后 `complete`；失败可重试未完成片；支持取消
7. 成功后 emit 事件，刷新文件列表并跳转
8. 上传期间禁止关闭弹窗或提示确认

> 大文件建议：不要一次性把 10 万行全部 `JSON.stringify` 成一个请求，分片是为了控制内存和失败重试成本。

## 15. 评论

- 行 hover 显示评论图标；有评论的行显示数量 badge
- 点击行打开 `CommentsPanel`，显示该行（versionId + rowIndex）的评论
- 创建评论：`{ versionId, rowIndex, content }`
- 支持解决/取消解决
- 侧边栏显示作者、时间、内容
- 切换版本时评论列表按新 versionId 重新加载
- 过滤/排序改变显示顺序时，仍用原始 `rowIndex` 关联评论

## 16. 分享（暂缓）

> 只读分享和外链编辑一起暂缓。

- `ShareDialog`：选择过期天数（7/30/永久）、生成
- 生成后展示完整 URL + 复制按钮
- 已有链接列表（可选）
- 公开页不加载 auth store；HTTP 层用 `auth: false`
- 服务端负责权限和过期校验，前端只展示错误

## 17. 报告快照节点（已取消）

> **2026-10-25 决定：不做报告和快照，也不实现 `tableSnapshot` 自定义节点。** 直接版本导出见第 30 节，版本工作流见 6.4 和第 29 节。

## 18. 清理项与依赖

- 删除 `src/apis/qianwen.ts`
- 删除 `src/components/Charts/*`
- 删除 `src/stores/dashboard.ts`
- 删除 `src/components/ReportEditor/ChartEmbed*`
- 删除图表相关 CSS、按钮、弹窗、imports
- 删除 `echarts` 依赖（`pnpm remove echarts`）
- 删除 `.env` 中的 `VITE_DEEPSEEK_KEY`
- 修改 `vite.config.ts`：
  ```ts
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
  ```
- `src/types/index.ts`：
  - `ColumnDef.type` 改为 `'string' | 'number' | 'date'`
  - 删除 ChartConfig / ChartTransform
  - 新增 API 类型（或放 `types/api.ts`）
- `package.json` 名称可改为 `datasheet-platform`（可选）
- 重写 `README.md` / `CLAUDE.md`，去掉 AI/图表描述，补充前后端启动方式

---

# 第六部分：后端实现

## 19. 路由与服务划分

```
server/src/
├── index.ts
├── app.ts
├── db/pool.ts
├── middleware/
│   ├── auth.ts            # Bearer JWT → req.userId
│   ├── require-role.ts    # 工作空间角色校验
│   ├── async-handler.ts   # 包装 async route，统一转 next(err)
│   └── error-handler.ts   # HttpError → JSON
├── routes/
│   ├── auth.routes.ts
│   ├── workspaces.routes.ts
│   ├── files.routes.ts    # files / versions / chunks / rows
│   ├── comments.routes.ts
│   └── shares.routes.ts   # 私有创建 + 公开 token 读取
├── services/
│   ├── auth.service.ts
│   ├── workspaces.service.ts
│   ├── files.service.ts
│   ├── comments.service.ts
│   └── shares.service.ts
├── storage/chunks.ts
└── utils/
    ├── jwt.ts
    ├── password.ts
    ├── validate.ts
    └── http-error.ts
```

- 路由只做参数解析、调用 service、返回 JSON。
- service 里写 SQL 和业务规则，使用 `mysql2/promise` 的参数化查询（`?` 占位符），不要拼接 SQL。
- 统一的 `HttpError`（status + message）由 error-handler 转成 `{ statusCode, message }`。
- 异步路由统一用 `asyncHandler` 包装，避免每个 try/catch。

### 认证

- `POST /api/auth/register`
  - 校验 email 格式、密码至少 8 位、name 非空
  - 查邮箱是否已存在（409）
  - `bcryptjs.hash(password, 10)`
  - 事务：插入 user → 插入个人 workspace → 插入 owner membership
  - `jsonwebtoken.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' })`
  - 返回 `{ token, user }`
- `POST /api/auth/login`
  - 按 email 查 user，`bcrypt.compare`
  - 错误统一 401「邮箱或密码错误」
  - 返回 `{ token, user }`
- `GET /api/auth/me` 需要 `authRequired`
- `authRequired` 中间件：
  ```ts
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw new HttpError(401, '未登录');
  const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  req.userId = payload.sub;
  ```
- 公开分享路由（`GET /api/shares/:token` 等）**不要挂** `authRequired`。
- 其他所有 `/api` 路由默认挂 `authRequired`；在 `app.ts` 中按路由挂载，避免遗漏。

### 权限

用普通函数实现，不用守卫/装饰器：

```ts
async function getMembership(userId: string, workspaceId: string) {
  // SELECT role FROM workspace_members WHERE user_id=? AND workspace_id=?
}

async function assertFileAccess(userId: string, fileId: string, allowedRoles?: Role[]) {
  // 先查 file.workspace_id，再查 membership
  // 无权限抛 HttpError(403/404)
}
```

- 所有文件/版本/评论/分享接口先校验 workspace membership。
- 首版上传：owner/editor
- 保留版本：仅 owner
- 成员管理：owner
- 评论创建：owner/editor/commenter
- 分享创建：owner/editor；编辑分享链接仅 owner
- 读取：任意成员
- 公开分享：share token 校验，不需要 JWT

### 分片存储

- `server/src/storage/chunks.ts`：
  - `chunkPath(versionId, index)`
  - `writeChunk(versionId, index, rows)`
  - `readChunk(versionId, index)`
  - `deleteVersionChunks(versionId)`
- 目录：`server/storage/chunks/<versionId>/<index>.json`
- 路径拼接要防目录穿越（versionId 来自数据库，index 校验为非负整数）。
- `PUT /api/versions/:id/chunks/:index`：
  - version 必须存在且 status=uploading
  - index 在 `[0, chunkCount-1]`
  - rows 是数组，长度 ≤ 500，不能为空
  - 写入文件 + 用 MySQL upsert 写 Chunk 记录（幂等，支持重试覆盖）：
    ```sql
    INSERT INTO chunks (id, version_id, chunk_index, row_count, storage_key)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE row_count = VALUES(row_count),
                            storage_key = VALUES(storage_key)
    ```
- `complete`：
  - 统计 Chunk 记录；校验数量和 rowCount
  - 校验文件是否存在
  - 事务：更新 version.status='ready'、file.latest_version_number
- 读取行：
  - 校验 status=ready
  - 无 q/sort：根据 offset/limit 计算涉及 chunk，只读这些文件
  - 有 q/sort：读全部 chunk，合并、过滤、排序、切片
  - 返回 rowIndex
  - 对 100k 行以内可接受；可后续加内存排序索引缓存
- Express 默认 JSON body 限制约 100kb，必须在 `app.ts` 提高：
  ```ts
  app.use(express.json({ limit: '10mb' }));
  ```
- 删除 uploading version 时清理文件与 DB 记录（先删文件，再删 DB 行）。

### 查询参数校验

- `offset >= 0`
- `1 <= limit <= 500`
- `sortBy` 属于 columns
- `sortDir in ['asc','desc']`
- `q` 截断到 100 字符
- 数字列按数值排序，日期列按时间排序，其他按字符串；空值放最后
- 搜索为不区分大小写的字符串包含匹配

### 分享

- token：`crypto.randomBytes(24).toString('hex')`
- 创建时校验文件的 workspace 权限
- `GET /shares/:token`：
  - 找 share；检查 expiresAt
  - 找 file（deletedAt 为空）
  - 找最新 ready version
  - 返回 `{ file: {id,name}, version: {id,versionNumber,columns,rowCount}, permissions: { role: 'viewer' } }`
- `GET /shares/:token/rows` 复用行查询逻辑，但只能读该文件最新版本
- v1 不允许匿名写操作

### 种子数据

`server/scripts/seed.ts`（用 `mysql2/promise` + `bcryptjs`）：

- 创建两个用户：
  - `alice@example.com` / `demo1234`
  - `bob@example.com` / `demo1234`
- Alice 创建共享工作空间 "Demo Workspace"，Bob 为 editor
- 可选：生成一个 1000 行示例数据集（可以直接插入 files/file_versions/chunks，或者用脚本模拟上传）
- 控制台打印账号，方便测试
- 用 `crypto.randomUUID()` 生成 ID；密码用 `bcryptjs.hash(..., 10)`
- 可重复执行：先按 email 查重，已存在则跳过用户创建

### 环境变量

`server/.env`（不要提交）：

```bash
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=datasheet
JWT_SECRET=replace-with-a-long-random-string
STORAGE_DIR=./storage
CORS_ORIGIN=http://localhost:5173
```

提供 `server/.env.example`。根目录 `.env` 只保留前端需要的变量（如果需要）。

MySQL 可以用本机安装，也可以 Docker：

```bash
docker run --name datasheet-mysql \
  -e MYSQL_ROOT_PASSWORD=your-password \
  -e MYSQL_DATABASE=datasheet \
  -p 3306:3306 -d mysql:8.0
```

### 脚本

根 `package.json` 增加（示例）：

```json
{
  "scripts": {
    "dev": "vite",
    "server": "pnpm --dir server dev",
    "dev:full": "run-p dev server",
    "server:db:init": "pnpm --dir server db:init",
    "server:db:seed": "pnpm --dir server db:seed"
  }
}
```

`server/package.json`（Express + TS）：

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "db:init": "tsx scripts/init-db.ts",
    "db:seed": "tsx scripts/seed.ts"
  }
}
```

依赖建议：

```bash
express mysql2 jsonwebtoken bcryptjs cors dotenv
# dev: typescript tsx @types/express @types/node @types/jsonwebtoken @types/cors
```

`scripts/init-db.ts` 读取并执行 `sql/schema.sql`（初始化连接用 `multipleStatements: true`，仅限这个脚本），避免依赖本机 `mysql` 命令。也可以手动执行：

```bash
mysql -u root -p < server/sql/schema.sql
```

---

# 第七部分：实施顺序与验收

## 20. 分阶段实施

### Phase 0：清理与地基（必须最先做）

1. 删除 AI / ECharts / dashboard / chart embed 代码、依赖、路由、UI、环境变量、代理。
2. 重写类型定义（DataRow/ColumnDef 等），删除 Chart 类型。
3. 新建 `server/`（Express + MySQL），执行 `schema.sql`、配置数据库、seed。
4. 实现 auth（注册/登录/me/JWT），前端登录页、auth store、HTTP 层、路由守卫。
5. 工作空间列表 + 个人工作空间；基础布局。
6. 确保前端/后端都能启动；`pnpm type-check` 不因改造出现新错误。

**验收**：能注册登录；刷新后仍登录；未登录访问业务页跳登录；AI/图表入口完全消失。

### Phase 1：上传与表格

1. 文件列表、上传弹窗、Worker 解析改造。
2. 后端 files/versions/chunks/complete/rows。
3. 上传分片、并发、进度、失败重试。
4. 远程虚拟表格、IndexedDB 缓存、搜索、排序、固定表头。
5. 版本列表 / 打开指定版本。

**验收**：上传 1 万行以上 Excel；表格可滚动、搜索、排序；刷新页面后数据从服务端恢复；切换到旧版本可查看。

### Phase 2：协作

1. 成员管理（owner 添加已注册用户、角色）。
2. 评论 CRUD + 侧边栏 + 行评论 badge。
3. 分享链接创建、公开分享页、过期校验（暂缓，和外链编辑一起做）。
4. 权限校验（owner/editor/commenter/viewer）。

**验收**：两个账号在同一工作空间；commenter 能评论不能上传；viewer 只读。分享链接验收暂缓。

> **方向修正（2026-10-24）**：实时协同编辑优先于分享。先完成 Phase 2.5，再继续分享。

### Phase 2.5：可编辑表格与实时协同（新增，优先）

1. `cell_edits` 表 + 行查询覆盖层。
2. `PATCH /api/versions/:versionId/cells/:rowIndex`，owner/editor，类型校验。
3. WebSocket 鉴权、版本房间、单元格更新广播、在线用户/光标。
4. 前端可编辑虚拟表格：双击编辑、乐观更新、防抖保存、远程更新合并。
5. 评论/版本读取覆盖后的数据；旧版本在 Phase 2.6 改为可编辑。分享功能暂缓。

**验收**：两个账号打开同一版本，编辑不同单元格后实时互相可见；同一单元格后写覆盖；viewer/commenter 不能编辑。分享页验收暂缓。

### Phase 2.6：保留版本（新增，优先于分享）

1. 第一版仍通过 Excel 上传；首版 ready 后不再手动上传新版本。
2. 所有 ready 版本都可编辑；修改写入该版本的 `cell_edits` 草稿。
3. owner 从任意版本点击“保留版本”：文件加锁，读取该版本 chunks + 它的 `cell_edits`，物化写入新版本 chunk 文件，创建 vN+1（ready），记录 `base_version_id`，更新 `latest_version_number`。
4. 新版本基础数据包含该版本的草稿值；提交成功后清空源版本草稿，源版本恢复为基础数据但仍可编辑；其他版本不受影响。
5. 未保留的修改继续作为草稿；owner 也可点击“清除改动”回退到基础数据。
6. 提交期间拒绝任何版本的新编辑和再次保留；成功后向源版本房间广播 `version:created`，源版本房间的在线成员自动切到新版本。
7. 清除改动时删除当前版本草稿，广播 `cells:cleared`，客户端清缓存并重新加载。

**验收**：第一版只能上传；所有版本可编辑；owner 可从任意版本保留草稿生成新版本；owner 可清除当前版本草稿；editor 只能编辑不能保留或清除；保留成功后源版本草稿清空但可继续编辑；版本历史允许分叉；评论仍按版本隔离。

### Phase 2.7：分享链接（只读 + 外链编辑，暂缓 / Backlog）

> 暂不实现，用户有空时一起做：先做只读分享，再做外链编辑。

只读分享：

1. owner/editor 创建 share token，支持过期和撤销。
2. 公开 `/s/:token` 页面，匿名只读，不接评论、编辑和 WebSocket。
3. 公开接口只返回文件、最新 ready 版本、列和行数据，不泄露工作空间其他数据。

外链编辑：

1. `shares.role` 支持 `editor`；仅 owner 可创建编辑链接，支持过期和撤销。
2. `POST /api/shares/:token/join`：登录用户校验 token 后加入工作空间为 editor。
3. `/s/:token`：匿名可只读预览；登录/注册后回跳并加入，成功跳转文件页。
4. 加入后编辑和 WebSocket 复用现有成员权限，不做匿名写。

**验收**：只读链接在无痕窗口可访问且过期失效；新账号通过编辑链接注册并加入工作空间后可编辑；已有成员角色不被链接修改；过期/撤销链接不能加入；加入后在线用户、光标、单元格更新正常。

### Phase 3：版本导出、清理与收尾

1. 版本导出 Excel/PDF；PDF 竖向 A4、多页、导出全部行。
2. 删除报告、TipTap、快照相关遗留文件、路由、依赖；保留 xlsx/html2canvas/jsPDF 供版本导出。
3. 文档、测试、边界处理。
4. 真实数据量和权限回归验证。

> 2026-10-25：`ReportEditor.vue`、TipTap 依赖、`reports` 表已清理；剩余文档和最终回归。

**验收**：版本 Excel/PDF 可导出；无报告/快照入口和依赖；现有上传、版本、评论、实时协同、保留版本正常。

### Phase 4（可选）

- 版本 diff（Worker 或服务端）
- 标签、回收站、活动日志
- 分享 commenter 角色
- 原文件下载
- 文件重命名/移动
- 列表虚拟滚动
- 离线只读缓存提示
- 测试完善、E2E

## 21. 验收清单

### 功能

- [ ] 注册、登录、登出、401 跳转
- [ ] 刷新后登录态保持
- [ ] 个人工作空间自动创建
- [ ] owner 添加成员、设置角色、移除成员
- [ ] 上传 xlsx/xls/csv，显示解析/上传进度
- [ ] 10 万行以内表格可滚动，滚动不一次性加载全部数据
- [ ] 搜索、排序结果正确，分页 total 正确
- [ ] 刷新页面后表格数据来自服务端
- [ ] 第一版通过 Excel 上传；首版 ready 后不能手动上传新版本
- [ ] owner 点击“保留版本”生成新版本；editor 不能保留
- [ ] owner 点击“清除改动”回退到基础数据；editor 不能清除
- [ ] 清除后当前版本行缓存失效并重新加载
- [ ] 任意 ready 版本都可编辑，包括旧版本
- [ ] 保留成功后源版本草稿清空、恢复为基础数据，但仍可继续编辑
- [ ] 新版本基础数据包含源版本 + 源版本草稿；版本历史允许分叉并记录 baseVersionId
- [ ] 未保留的修改继续作为草稿
- [ ] 保留期间新的编辑被拒绝；成功后在线成员切到新版本
- [ ] 行评论创建/展示/解决；切换版本评论隔离
- [ ] 版本可导出 Excel（完整版本）和 PDF（全部行、竖向 A4 多页）
- [ ] 有草稿时导出先询问保留/清除；非 owner 不能继续
- [ ] 导出包含草稿值、表头、中文、PDF 分页正常
- [ ] （暂缓/Backlog）只读分享链接：跨设备/无痕可访问；过期失效；只读
- [ ] （暂缓/Backlog）编辑分享链接：登录/注册后加入工作空间并可实时编辑
- [ ] 无报告、快照入口、API 和持久化
- [ ] 无 AI、无图表、无 ECharts 依赖与入口

### 技术

- [ ] `pnpm type-check` 通过（或仅剩与本次改动无关的既存问题，并记录）
- [ ] `pnpm lint` 不新增错误
- [ ] 后端无 mock 服务；真实数据库、真实文件存储、真实 JWT
- [ ] JWT 密钥/数据库连接在环境变量，不提交
- [ ] 分片上传可重试；complete 校验完整性
- [ ] 公开分享接口不泄露工作空间其他数据
- [ ] 权限校验覆盖文件/版本/评论/分享
- [ ] 保留版本写入新 chunk 文件；失败时清理临时文件
- [ ] README/CLAUDE.md 更新

---

# 第八部分：实现约束与注意事项

## 22. 给实现 Claude 的硬性要求

1. **不要实现 AI、图表、ECharts、AI 报告。** 发现残留引用要全部清理。
2. **不要用 mock 后端。** 必须真实启动 Express + MySQL，真实读写数据；种子数据可以，但不能用假接口替代业务逻辑。
3. **保留并强化以下技术点**：
   - Web Worker 解析 Excel（不能改回主线程）
   - 分片上传 + 服务端 chunk 存储
   - 虚拟滚动（远程数据）
   - IndexedDB 本地缓存
   - 单元格实时协同
   - owner 保留版本（草稿物化为新版本）
4. **API 契约优先**：前端只通过 `src/api/http.ts` + `services/` 访问后端；不要在组件里散落 `fetch`。
5. **Java 迁移友好**：
   - RESTful，不使用 GraphQL/tRPC
   - JWT 标准 HS256，payload 只放 `sub/email`
   - 密码 bcrypt，Java BCrypt 可校验
   - 主键用 UUID 字符串（`crypto.randomUUID()`）
   - 时间用 ISO 字符串
   - JSON 字段用 MySQL JSON / LONGTEXT，Java 可读写
   - 文件 chunk 用中性 JSON 格式
6. **不要碰 `.history/`**；不要提交数据库文件、storage 文件、`.env`。
7. **代码风格**：沿用现有英文标识符 + 中文注释；TypeScript 严格模式；`noUncheckedIndexedAccess` 下注意可空值。
8. **每个阶段结束都要能运行**；先保证主流程，再优化样式。
9. **不要过度设计**：v1 做单元格级实时同步（WebSocket + last-write-wins），不做字符级 OT/CRDT、Excel 公式、行列插入/删除、微服务、队列、Redis。
10. **完成后更新 `README.md` 和 `CLAUDE.md`**，写明前后端启动、环境变量、端口、种子账号。

## 23. 关键边界情况

- 空 Excel / 无列 / 无行：Worker 或上传流程给出明确错误
- 行数不是 500 的整数倍：最后一片行数较小
- chunk 重传：服务端 upsert，幂等
- 上传中断：允许重试未完成片；取消时删除 uploading version
- 版本未完成时读取 rows：409
- 重复邮箱注册：409
- 错误密码：401，不区分“用户不存在”
- 无权限访问文件：403 或 404
- 分享过期：410 或 404，前端友好提示
- 搜索/排序参数非法：400
- CSV 编码/日期：沿用 SheetJS 输出，不做额外转换
- 删除文件后分享链接：不可访问（deletedAt 过滤）
- 没有草稿时点击“保留版本”：400/409
- 非 owner 保留版本：403
- 源版本不是 ready：409
- 保留进行中：新的单元格编辑/再次保留 409
- 保留写盘失败：清理新版本目录和临时记录
- 切换版本时清空评论/表格缓存状态
- 组件卸载时取消未完成请求（AbortController）
- 并发上传时避免重复创建 version

## 24. 建议的本地开发流程

```bash
# 0. 确保 MySQL 已启动（本机服务或 Docker）

# 1. 根目录安装前端依赖
pnpm install

# 2. server 安装依赖、建表、种子
cd server
pnpm install
pnpm db:init         # 执行 sql/schema.sql
pnpm db:seed         # 创建 alice/bob 和 Demo Workspace
pnpm dev             # http://localhost:3000/api

# 3. 回到根目录
cd ..
pnpm dev             # http://localhost:5173，/api 代理到 3000
```

测试账号（seed 后）：

- `alice@example.com` / `demo1234`（Demo Workspace owner）
- `bob@example.com` / `demo1234`（Demo Workspace editor）

---

## 25. 一句话给实现 Claude

> 先读 `REFACTOR_PLAN.md` 和现有代码。删除所有 AI/图表/报告/快照功能；保留 Worker 解析、分片、虚拟滚动、IndexedDB 缓存、版本导出 Excel/PDF；用 Express + MySQL（`mysql2` 参数化 SQL，不用 ORM）实现真实后端；按 Phase 0 → 3 逐步交付一个可登录、可上传、可分享、可评论、可实时协同编辑、owner 可保留版本并可导出的云端表格协作平台。每个阶段结束运行 `pnpm type-check`，不要提交 `.env`、数据库和 `storage` 文件。

## 26. 协作与验收约定（用户要求，最高优先级）

1. **引导时只罗列要做的步骤（1. 2. 3.），不要解释原因。** 用户主动问“为什么”时才解释；用户明确说“讨论”某个方案时，可以正常展开论述。
2. **一次一格。** 先给规格让用户自己写，卡住才补全；只有用户明确说“帮我写 / 补全 / 改改”时才代写。
3. **每格验收。** 前端在仓库根目录运行 `pnpm type-check`（若后续拆分为 `client/`，则在 `client/` 运行 `npx tsc --noEmit`）；后端在 `server/` 运行 `npx tsc --noEmit`。每格都必须通过验收。
4. **curl 验证语句必须使用 Git Bash 可用语法。** 不要使用 PowerShell 或 cmd 专属语法；JSON 使用单引号。提取登录 token 使用以下命令（已在该环境验证）：
   ```bash
   TOKEN=$(curl -sS --noproxy '*' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"auth-test@example.com","password":"demo1234"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
   ```
   不要使用 `node -e` 解析 token；在该环境下未成功。
5. **测试数据必须清理。** 因测试新建的账号、工作空间、文件、评论、分享等，测试完成后必须删除；只有后续开发确实需要的才保留。测试账号统一使用 `auth-test@example.com`，测试后用 SQL 删除对应工作空间和用户。
6. **输出格式固定为：开工前先列文件清单和职责，完成后逐文件说明实际改动。** 格式见第 27 节。

## 27. 每格输出格式（固定）

每格分两次输出：开工前只给「文件清单 + 职责 + 验收」，不写代码；用户写完或明确要求代写并验收通过后，再输出「已实现文件 + 实际内容 + 验证结果」。

### 27.1 开工前格式

```
第 N 格：<格名称>

| 文件 | 要做的事 |
|---|---|
| `path/to/file` | ... |
| `path/to/file` | ... |

验收：
1. ...
2. ...
```

示例：

```
第 3 格：后端 auth

| 文件 | 要做的事 |
|---|---|
| `server/src/utils/httpError.ts` | 定义带 statusCode 的 HttpError |
| `server/src/services/auth.ts` | 注册事务：user + 个人 workspace + owner membership |
| `server/src/routes/auth.ts` | register / login / me 三个接口 |

验收：
1. `cd server && npx tsc --noEmit` 通过
2. 注册 201、重复注册 409、登录 200、无 token 访问 me 为 401
```

### 27.2 完成后格式

```
第 N 格完成。

**已实现**
- `path/to/file`：实际做了什么
- `path/to/file`：实际做了什么

**验证结果**
- ...
- ...

**测试数据**
- 新建：...
- 清理：...
```

示例：

```
第 3 格完成。

**已实现**
- `server/src/utils/httpError.ts`：新增 HttpError，包含 statusCode
- `server/src/services/auth.ts`：注册时事务写入用户、个人工作空间和 owner 成员
- `server/src/routes/auth.ts`：新增 register / login / me

**验证结果**
- `npx tsc --noEmit`：通过
- 注册 201、重复注册 409、登录 200、无 token 访问 me 为 401

**测试数据**
- 新建：auth-test@example.com、Auth Test 的工作空间
- 清理：已删除测试用户和对应工作空间
```

## 28. 方向修正：实时协同编辑（2026-10-24）

原第 4.3 节把实时协作和单元格编辑列为非目标。用户确认项目核心是**多人同时编辑同一张表**，因此调整为：

> 可编辑表格 + 单元格级实时同步 + 在线用户/光标，保留现有上传、版本、评论、分享能力。

### 28.1 v1 范围

- owner/editor 可编辑**任意 ready 版本**的单元格（Phase 2.6 起）。
- commenter/viewer 只读。
- WebSocket 实时同步；同一单元格采用 last-write-wins。
- 不做字符级 OT/CRDT、公式、行列插入/删除（暂缓）。

### 28.2 数据模型

原始 chunk rows 保持只读；新增 `cell_edits` 覆盖层：

```sql
CREATE TABLE cell_edits (
  id            VARCHAR(36)  PRIMARY KEY,
  version_id    VARCHAR(36)  NOT NULL,
  row_index     INT          NOT NULL,
  column_key    VARCHAR(255) NOT NULL,
  value_json    JSON         NOT NULL,
  revision      BIGINT       NOT NULL DEFAULT 1,
  updated_by_id VARCHAR(36)  NOT NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cell_edit (version_id, row_index, column_key),
  KEY idx_cell_edits_version (version_id),
  CONSTRAINT fk_cell_edits_version
    FOREIGN KEY (version_id) REFERENCES file_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_cell_edits_user
    FOREIGN KEY (updated_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

读取行时：

1. 读取基础 chunk rows。
2. 查询该版本对应的 `cell_edits`。
3. 用 edits 覆盖基础行。
4. 再做搜索、排序、切片。

搜索/排序必须基于覆盖后的值。

### 28.3 编辑接口

```http
PATCH /api/versions/:versionId/cells/:rowIndex
```

Body：

```json
{ "columnKey": "Salary", "value": 12000 }
```

规则：

- owner/editor。
- 版本必须是 ready；任意版本都可以编辑，不要求是最新版本。
- 文件未软删除。
- rowIndex 在 `[0, row_count - 1]`。
- columnKey 在版本 columns 中。
- value 按列类型校验；空值允许。
- upsert `cell_edits`，revision + 1，记录 updated_by。
- 返回 `{ cell: { rowIndex, columnKey, value, revision, updatedAt } }`。
- 成功更新后通过 WebSocket 广播 `cell:update`。

### 28.4 WebSocket

- 使用 `ws`，复用现有 HTTP server。
- 连接时 JWT 鉴权。
- 房间：`version:<versionId>`。
- 校验用户对版本所属工作空间有访问权限。
- 事件：
  - `cell:update`：广播单元格新值、revision、编辑者。
  - `version:created`：owner 保留版本后，通知源版本房间成员切换到新版本；其他版本房间不受影响。
  - `cells:cleared`：owner 清除草稿后，通知版本房间成员回退并重新加载。
  - `presence:join` / `presence:leave`
  - `presence:cursor`：在线用户当前行/列。
  - `cursor:clear`：用户结束编辑后，其他人移除该用户光标。
- 同一单元格同时编辑按 last-write-wins；前端以服务端返回的 revision 为准。

### 28.5 与现有功能

- 评论仍锚定原始 `rowIndex`，单元格编辑不改变行号。
- 分享功能暂缓；实现后分享页读取覆盖后的最新版本数据。
- 保留版本会把草稿物化为新的基础数据，并清空源版本草稿；源版本恢复为基础数据但仍可编辑。
- 前端 IndexedDB 行缓存需要按编辑更新或失效。
- 可编辑表格仍使用虚拟滚动；只渲染可见行。

### 28.6 优先级

先完成 Phase 2.5 的“可编辑表格 + WebSocket 实时同步”并做双浏览器验收，再完成 Phase 2.6 保留版本，最后做 Phase 3 清理与收尾。Phase 2.7 分享链接（只读 + 外链编辑）暂缓，不排期。

### 28.7 分享链接方案（Phase 2.7，只读 + 外链编辑，暂缓 / Backlog）

确定方案：**分享链接 + 登录/注册后加入工作空间**，不做匿名可写。

规则：

- 只读链接保持匿名只读。
- 编辑链接 `role = editor`；仅 owner 可创建，支持过期和撤销。
- 匿名打开编辑链接：显示文件只读预览和登录/注册入口。
- 登录/注册后携带 token 调用 join；服务端校验 token、过期时间、文件未删除，将用户加入工作空间为 editor，返回 `fileId`。
- 已是成员时保持原角色；角色不足则提示联系 owner，不通过链接自动升降级。
- 加入后编辑和 WebSocket 使用现有成员权限，share token 不进入 PATCH / WS。
- `cell_edits.updated_by_id` 仍是真实用户，不做匿名身份。
- 注意：加入工作空间意味着能访问该工作空间全部文件。编辑链接只适合工作空间级外部协作；单文件外部协作仍用只读分享。

接口：

```http
POST /api/shares/:token/join   （需要登录）
→ { workspaceId, fileId, role }
```

前端：

- `/s/:token` 区分只读链接和编辑链接。
- 登录/注册页保留 `redirect=/s/:token`。
- join 成功后跳转 `/files/:fileId`。

## 29. 方向修正：取消报告/快照，新增保留版本与版本导出（2026-10-25）

本节取代此前所有报告、快照相关设计（6.4 旧内容、9.6、12 的 ReportEditorView、17、Phase 3 旧条目）。

### 29.1 取消的功能

- 不做报告列表、报告 CRUD、TipTap 报告编辑器、服务端报告保存。
- 不做表格快照预览。
- 不做 `tableSnapshot` 自定义节点和 NodeView。
- `reports` 表已删除，报告相关代码和 TipTap 依赖已清理。
- 保留直接版本导出 Excel/PDF；保留 xlsx/html2canvas/jsPDF 依赖。
- Phase 3 删除 `ReportEditor.vue` 和 TipTap 依赖，保留导出依赖。

### 29.2 新版本工作流

- 第一版仍通过 Excel 上传创建 v1。
- v1 ready 后，不再手动上传新版本。
- 所有 ready 版本都可编辑；owner/editor 的修改写入该版本的 `cell_edits`，作为草稿。
- owner 从任意版本点击“保留版本”：
  1. 校验 owner、文件未删除、源版本 ready、源版本有草稿。
  2. 文件加锁；提交期间任何版本的新的编辑/再次保留返回 409。
  3. 读取源版本 chunks + 该版本的 `cell_edits`，按行覆盖。
  4. 写入新版本 chunk 文件，创建 vN+1（ready），记录 `base_version_id`，更新 `latest_version_number`。
  5. 清空源版本草稿；源版本恢复为基础数据但仍可编辑，其他版本不受影响。
  6. 向源版本房间广播 `version:created`；源版本房间的在线成员自动切到新版本。
- 新版本基础数据包含草稿值，新版本自身没有 `cell_edits`。
- 版本历史允许分叉：v1、v2 后修改 v1 并保留，生成基于 v1 的 v3；v2 保留。
- 未保留的修改继续作为草稿。
- owner 可以点击“清除改动”：删除当前版本草稿，广播 `cells:cleared`，客户端清空行缓存并重新加载；editor 不能清除。
- 评论按版本隔离，新版本不继承旧评论。
- 只有 owner 可以保留版本；editor 只能编辑草稿。
- 版本列表返回每个版本的 `baseVersionId` 和 `pendingEditCount`。
- 接口：
  - `POST /api/versions/:versionId/retain`
  - `DELETE /api/versions/:versionId/cells`

### 29.3 验收

1. 第一版只能通过上传创建；首版后无“上传新版本”入口。
2. owner 能把草稿保留为 v2；editor 不能保留。
3. 保留成功后源版本草稿清空并恢复为基础数据，但仍可继续编辑；新版本基础数据包含源版本 + 草稿。
4. 未保留的修改继续作为草稿。
5. 保留期间新的编辑被拒绝；成功后在线成员自动切到新版本。
6. 无报告/快照入口、API 和依赖；版本导出 Excel/PDF 正常。

## 30. 版本导出（2026-10-25）

- 导出当前选中的 ready 版本，包含 `cell_edits` 草稿值。
- 按原始行顺序导出，不应用当前搜索/排序。
- Excel：完整版本，使用 `xlsx`。
- PDF：导出全部行，使用 `html2canvas` + `jsPDF`，竖向 A4、多页，保证中文正常。
- 所有能查看该版本的成员都可以导出。
- 有草稿时，导出前先处理版本：
  - 无草稿：直接打开导出弹窗。
  - owner 有草稿：弹窗选择“保留版本并导出”或“清除改动并取消导出”；关闭弹窗不操作。
  - 选择保留：先保留版本，成功后打开导出弹窗，导出新版本。
  - 选择清除：执行清除改动，关闭导出流程，不生成文件。
  - 非 owner 有草稿：提示等待 owner 处理，不导出。
- 相关文件：
  - `src/utils/versionExport.ts`
  - `src/components/ExportDialog.vue`
  - `src/components/PendingVersionDialog.vue`
  - `src/views/FileView.vue`
- 不做报告、快照或服务端导出，不修改版本数据。
- Phase 3 清理时保留 xlsx/html2canvas/jsPDF，删除报告和 TipTap 遗留。

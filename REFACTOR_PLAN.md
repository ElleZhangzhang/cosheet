# DataSheet 云端表格协作平台 — 改造 Handoff 文档

> 目标读者：负责实施改造的 Claude。
> 使用方式：先完整阅读本文，再通读现有代码，按第 9 节的阶段顺序实施。
> 核心约束：**删除所有 AI 与图表功能；使用真实 Node 后端（不用 mock）；保留 Web Worker 文件解析、IndexedDB 分片/缓存、虚拟滚动、TipTap 富文本 + 自定义 Extension、PDF 导出。**

---

## 0. 一句话目标

把现有「浏览器本地 Excel 数据分析工具」改造成一个 **可登录、可上传、可分享、可评论、可写报告的云端表格协作平台**：

- 前端：Vue 3 + Vite + TypeScript + Pinia + Element Plus + TipTap
- 后端：Node.js + Express + MySQL（真实后端），后续可平移到 Java / Spring Boot
- 文件数据：前端 Worker 解析 Excel → 分片上传 → 服务端持久化 → 虚拟表格按需拉取 → IndexedDB 缓存
- 协作：工作空间、成员角色、行级评论、真实分享链接、版本历史、分析报告 + 数据快照 + PDF

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
| 富文本 | TipTap 3（StarterKit、Placeholder、Table 系列、自定义 Node） |
| PDF | `html2canvas` + `jsPDF`（动态 import） |
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

**改造后**：TipTap 和 PDF 保留；`chartEmbed` 换成 `tableSnapshot` 数据快照节点；报告保存到服务端；删除 AI 生成。

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
| `src/components/ReportEditor/ChartEmbedExtension.ts` | **替换**为 `TableSnapshotExtension.ts` |
| `src/components/ReportEditor/ChartEmbedNodeView.vue` | **替换**为 `TableSnapshotNodeView.vue` |
| `src/composables/useDrag.ts` | 可删除（仅图表拖拽使用）；如要做列宽拖拽再保留 |
| `src/composables/useFileParse.ts` | **保留并改造**：只解析，不直接写 store；配合上传流程 |
| `src/stores/data.ts` | **替换**为 workspace/auth/file 相关 store |
| `src/stores/dashboard.ts` | **删除**（charts、report 本地缓存都移走） |
| `src/types/index.ts` | **重构**：保留 DataRow/ColumnDef 基础类型，删除 ChartConfig/ChartTransform |
| `src/utils/datasetDB.ts` | **替换**为 `rowCache.ts`（IndexedDB 缓存）；旧 DB 可不迁移 |
| `src/views/DataView.vue` | **重写/拆分为平台页面** |
| `src/views/ReportEditor.vue` | **保留并改造**：删除 AI/图表侧栏，改服务端保存 + 表格快照 |
| `src/workers/excel-parser.worker.ts` | **保留并改造**：输出 ParsedSheet，不生成服务端 ID；修复类型 |
| `src/App.vue` | 保留 `<router-view />` |
| `src/main.ts` | 保留 Pinia + router 初始化 |
| `src/router/index.ts` | **重写**：登录、工作空间、文件、报告、分享路由 + 守卫 |
| `src/assets`、全局样式 | 按新页面调整 |
| `.history/` | 忽略，不要修改或提交 |
| `.env` | 删除 `VITE_DEEPSEEK_KEY`；新增后端环境变量说明 |
| `vite.config.ts` | **修改代理**：`/api` → `http://localhost:3000`，去掉 rewrite 和 dashscope |
| `package.json` | 删除 `echarts`；保留 xlsx/idb/TipTap/html2canvas/jsPDF 等 |
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

一句话：团队把 Excel/CSV 上传到工作空间，在线查看、搜索、排序和评论数据；通过分享链接把某张表只读展示给外部；基于表格数据撰写带「数据快照」的分析报告并导出 PDF。

### 4.1 角色与权限

工作空间角色：

| 角色 | 查看 | 编辑单元格 | 评论 | 上传新版本 | 管理成员/文件 |
|---|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| editor | ✅ | ✅ | ✅ | ✅ | ❌ |
| commenter | ✅ | ❌ | ✅ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

分享链接角色（v1）：

- `viewer`：匿名只读，可看表格，不能评论、不能上传。
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
   - 版本选择；旧版本只读
   - 行级评论入口
6. **评论**：对某行创建评论、列表、标记解决；按版本隔离；侧边栏展示。
7. **分享**：为文件创建只读分享链接（可设过期天数）；公开路由 `/s/:token` 跨设备可访问；服务端校验 token 和过期时间。
8. **版本历史**：上传新版本；版本列表；查看旧版本表格；版本 diff 放 Phase 4。
9. **报告**：
   - 工作空间/文件下创建、编辑、删除报告
   - TipTap 富文本编辑（标题、列表、引用、表格等）
   - 插入「表格快照」节点：从当前版本取前 10/20/50 行 + 列 + 排序信息，冻结进报告
   - 防抖自动保存到服务端
   - 导出 PDF（沿用 html2canvas + jsPDF，多页）
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
- ❌ 后端解析 Excel（v1 保持前端 Worker 解析）

---

# 第三部分：目标架构

## 5. 技术选型

### 前端

沿用现有栈：

- Vue 3 + Vite 7 + TypeScript
- Pinia（auth 可持久化 token；业务数据不持久化）
- Element Plus（自动导入）
- TipTap 3
- `xlsx` + Web Worker
- `idb`（缓存）
- `html2canvas` + `jsPDF`
- vue-router

删除：`echarts`、AI 相关代码。

### 后端（真实，不用 mock）

- **Node.js + Express + TypeScript**（不用 NestJS、不用 Prisma）
- **MySQL 8.0+**（真实数据库；用 `mysql2/promise` 连接池 + 参数化 SQL，不引入 ORM）
- **jsonwebtoken + bcryptjs**（纯 JS 密码哈希，避免 Windows 下 bcrypt 原生编译问题；哈希与 Java BCrypt 兼容）
- **手写校验函数 + 统一错误处理中间件**（不引入 Nest 的 DTO/Guard；用 Express middleware 实现认证和角色校验）
- 分片 JSON 存本地文件系统 `server/storage/`；文件/版本/评论/分享/报告元数据存 MySQL
- 端口 3000；所有接口前缀 `/api`

> 数据库是必需的：账号、工作空间、成员、文件版本、评论、分享链接、报告都需要跨设备持久化，不能放浏览器。
> 选择 Express + 原生 SQL 是为了匹配你已有的 Node/Express 基础，同时保持表结构简单，方便之后用 Java/JDBC/MyBatis 重写。
> 开发期可以用本机 MySQL、XAMPP/WAMP 的 MySQL，或者 Docker 起一个 MySQL 8 容器。

### 目录结构（目标）

```
/
├── src/                     # Vue 前端
│   ├── api/http.ts          # fetch 封装：baseURL、JWT、错误归一化、401 处理
│   ├── services/            # auth/workspace/file/comment/share/report
│   ├── stores/              # auth.ts、workspace.ts（业务状态）
│   ├── views/
│   │   ├── LoginView.vue
│   │   ├── WorkspaceView.vue      # 文件/报告列表 + 侧边栏
│   │   ├── FileView.vue           # 表格 + 评论 + 分享 + 版本
│   │   ├── ReportEditorView.vue   # TipTap 报告编辑器
│   │   └── SharedFileView.vue     # /s/:token 公开只读页
│   ├── components/
│   │   ├── AppSidebar.vue
│   │   ├── FileUploadDialog.vue
│   │   ├── RemoteVirtualTable.vue # 或改造 VirtualTable.vue
│   │   ├── CommentsPanel.vue
│   │   ├── ShareDialog.vue
│   │   ├── MembersDialog.vue
│   │   ├── VersionSelector.vue
│   │   └── ReportEditor/
│   │       ├── TableSnapshotExtension.ts
│   │       ├── TableSnapshotNodeView.vue
│   │       └── SnapshotInsertDialog.vue
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
│   │   ├── routes/          # auth/workspaces/files/comments/shares/reports
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

### 6.3 分享

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

### 6.4 报告与快照

- 报告内容以 TipTap JSON 存服务端（`Report.content` 字符串）。
- 编辑器 2 秒防抖 `PATCH /api/reports/:id`。
- 插入快照流程：
  1. 打开 `SnapshotInsertDialog`
  2. 选择当前文件/版本、列、排序、行数上限（10/20/50）
  3. 调 rows API 取数据
  4. 插入 `tableSnapshot` 节点，attrs 保存：`fileId`、`versionId`、`title`、`columns`、`sortBy`、`sortDir`、`limit`、`rows`、`totalRows`、`capturedAt`
- 快照行数上限 50；**绝不嵌入整张表**。
- NodeView 渲染紧凑表格 + 元信息（总行数、当前显示行数、版本、生成时间）+ 刷新/删除按钮。
- 报告更新后数据变化时显示「数据已更新」提示，用户可点击刷新快照（重新请求并 `updateAttributes`）。
- PDF 导出沿用现有 html2canvas + jsPDF；快照行数受限，全部在 DOM 中，不能使用虚拟滚动（否则 html2canvas 截不到屏幕外内容）。

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
  columns_json   JSON        NOT NULL,
  row_count      INT         NOT NULL,
  chunk_count    INT         NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'uploading', -- uploading|ready
  created_by_id  VARCHAR(36) NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_file_version (file_id, version_number),
  KEY idx_versions_file (file_id),
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

CREATE TABLE reports (
  id            VARCHAR(36)  PRIMARY KEY,
  workspace_id  VARCHAR(36)  NOT NULL,
  file_id       VARCHAR(36)  NULL,
  title         VARCHAR(255) NOT NULL,
  content       LONGTEXT     NOT NULL,
  created_by_id VARCHAR(36)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                  ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_reports_workspace (workspace_id),
  CONSTRAINT fk_reports_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- ID 在 Node 端用 `crypto.randomUUID()` 生成，写入 `VARCHAR(36)`。
- `columns_json` 用 MySQL `JSON`；`mysql2` 默认会把 JSON 列解析成 JS 对象，读取时仍建议做一次 `typeof === 'string' ? JSON.parse(...) : ...` 兼容处理。
- 报告 `content` 存 TipTap JSON 字符串，用 `LONGTEXT`。
- `files.latest_version_number` 是冗余字段，`complete` 时更新；读取最新版本时按 fileId + versionNumber 查询。
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
| GET | `/files/:id` | 文件详情 + 最新 ready 版本 + 版本列表 |
| PATCH | `/files/:id` | `{ name }`；owner/editor |
| DELETE | `/files/:id` | 软删除；owner |
| GET | `/files/:id/versions` | 版本列表 |
| POST | `/files/:id/versions` | 创建新版本（uploading） |
| PUT | `/versions/:id/chunks/:index` | `{ rows }`，每片最多 500 行 |
| POST | `/versions/:id/complete` | `{ rowCount, chunkCount }`，校验后置 ready |
| DELETE | `/versions/:id` | 取消上传中的版本 |
| GET | `/versions/:id/rows` | 表格分页查询 |
| GET | `/versions/:id/meta` | 版本元数据（可选） |

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

## 9.5 Shares

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/files/:id/shares` | `{ role: "viewer", expiresInDays?: number }` → `{ token, url }` |
| GET | `/files/:id/shares` | 已有分享（owner/editor） |
| DELETE | `/shares/:id` | 取消分享 |
| GET | `/shares/:token` | **公开**：文件 + 最新 ready 版本 + 列 + rowCount + 权限 |
| GET | `/shares/:token/rows` | **公开**：同 rows 查询参数 |

公开接口不要求 JWT，但要校验 token 存在、未过期、文件未删除。

## 9.6 Reports

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workspaces/:id/reports` | 报告列表 |
| POST | `/workspaces/:id/reports` | `{ title, fileId? }` |
| GET | `/reports/:id` | 报告详情（含 TipTap JSON） |
| PATCH | `/reports/:id` | `{ title?, content? }` |
| DELETE | `/reports/:id` | 删除 |

权限：owner/editor/commenter 可编辑；viewer 只读。

---

# 第五部分：前端改造

## 10. 路由

建议：

```ts
/login                      LoginView        （公开）
/register                   LoginView（注册模式）或 RegisterView（公开）
/workspaces/:workspaceId    WorkspaceView    （需登录）
/files/:fileId              FileView         （需登录）
/reports/:reportId          ReportEditorView （需登录）
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

按领域拆分：auth、workspace、file、comment、share、report。不要直接在页面里写 `fetch`。

### `src/stores/auth.ts`

- `token`、`user`、`isReady`
- `login()`、`register()`、`logout()`、`fetchMe()`
- token 持久化到 localStorage（或 pinia persistedstate）
- 初始化时若有 token，先 `/auth/me` 验证

### `src/stores/workspace.ts`

- `workspaces`、`currentWorkspace`、`members`
- 加载工作空间/成员；切换工作空间时清理文件/报告状态

> 文件列表、表格查询等页面级状态可以放视图内，不必全部塞 Pinia。

## 12. 页面与组件

### LoginView / Register

- 邮箱、密码、姓名
- 登录/注册切换
- 成功后拉取工作空间并跳转
- 错误提示（401/409/网络错误）

### WorkspaceView

- `AppSidebar`：工作空间切换、文件列表、报告列表、成员入口、上传按钮
- 主区域：文件卡片/表格列表（名称、行数、列数、最新版本、更新时间、分享按钮）
- 搜索框（按名称）
- 创建报告入口
- 成员管理弹窗（owner）：添加已注册用户、角色下拉、移除
- 上传按钮打开 `FileUploadDialog`

### FileView

- 头部：文件名、当前版本、行数/列数、分享、评论开关、报告入口
- `VersionSelector`：切换版本；上传新版本；旧版本显示「只读」
- `RemoteVirtualTable`：
  - 固定表头
  - 按 columns 渲染
  - 行高 51px
  - 点击表头排序（服务端）
  - 搜索框 300ms 防抖（服务端）
  - 加载/空/错误状态
  - 行 hover 显示评论按钮和评论数
- `CommentsPanel`：当前行/全部评论、创建、解决
- `ShareDialog`：角色（v1 仅 viewer）、过期天数、生成链接、复制
- 版本列表可放侧边或下拉

### SharedFileView

- `/s/:token`
- 调公开分享 API
- 只读虚拟表格 + 文件信息
- 不显示评论输入、上传、版本切换
- token 失效/过期显示友好错误页

### ReportEditorView

- 复用现有 TipTap 配置：StarterKit、Placeholder、Table 系列、TableSnapshotExtension
- 左侧不再是图表列表，改为：
  - 报告信息
  - 「插入数据快照」按钮（打开 SnapshotInsertDialog）
  - 当前文件/版本摘要
- 工具栏保留现有按钮（加粗、斜体、标题、列表、引用、分割线、撤销/重做）
- 保存：
  - `editor.on('update')` 防抖 2 秒 `PATCH /reports/:id`
  - 显示「保存中/已保存/保存失败」
- PDF 导出：沿用现有 `exportPDF`，把选择器改成报告内容容器；快照行数受限，确保 DOM 完整
- 删除 AI 生成、重新生成、图表侧栏、loading overlay 中的 AI 文案

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

## 16. 分享

- `ShareDialog`：选择过期天数（7/30/永久）、生成
- 生成后展示完整 URL + 复制按钮
- 已有链接列表（可选）
- 公开页不加载 auth store；HTTP 层用 `auth: false`
- 服务端负责权限和过期校验，前端只展示错误

## 17. 报告快照节点

> **v1 决策（2026-10-24）：采用方案 A。** 报告内插入普通 TipTap 表格作为数据快照，不实现自定义 Extension；以下 `TableSnapshotExtension` + NodeView + 刷新快照设计延后到项目收尾后，作为可选增强。

实现 `TableSnapshotExtension`，参考现有 `ChartEmbedExtension` 的写法：

```ts
Node.create({
  name: 'tableSnapshot',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() { /* fileId, versionId, title, columns, sortBy, sortDir, limit, rows, totalRows, capturedAt */ },
  parseHTML() { return [{ tag: 'div[data-table-snapshot]' }]; },
  renderHTML({ HTMLAttributes }) { /* 静态占位表格 + data-* */ },
  addNodeView() { return VueNodeViewRenderer(TableSnapshotNodeView); },
})
```

- `rows` 是小数组（≤50 行），直接存进节点 attrs，保证报告可复现。
- NodeView 用 `node.attrs.rows` 渲染小表格；`updateAttributes` 刷新快照；`deleteNode` 删除。
- 头部显示：标题、版本、总行数、显示行数、生成时间。
- 插入弹窗最多 50 行，默认 20；超过提示「只插入前 N 行，完整数据请查看表格」。
- PDF 截图时所有快照行都在 DOM 中，不能对快照使用虚拟滚动。
- 删除旧 `ChartEmbed*` 文件与相关 CSS/imports。

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
│   ├── shares.routes.ts   # 私有创建 + 公开 token 读取
│   └── reports.routes.ts
├── services/
│   ├── auth.service.ts
│   ├── workspaces.service.ts
│   ├── files.service.ts
│   ├── comments.service.ts
│   ├── shares.service.ts
│   └── reports.service.ts
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

- 所有文件/版本/评论/报告接口先校验 workspace membership。
- 上传新版本：owner/editor
- 成员管理：owner
- 评论创建：owner/editor/commenter
- 报告编辑：owner/editor/commenter
- 分享创建：owner/editor
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
5. 版本列表 / 打开指定版本（只读）。

**验收**：上传 1 万行以上 Excel；表格可滚动、搜索、排序；刷新页面后数据从服务端恢复；切换到旧版本可查看。

### Phase 2：协作

1. 成员管理（owner 添加已注册用户、角色）。
2. 评论 CRUD + 侧边栏 + 行评论 badge。
3. 分享链接创建、公开分享页、过期校验。
4. 权限校验（owner/editor/commenter/viewer）。

**验收**：两个账号在同一工作空间；commenter 能评论不能上传；viewer 只读；分享链接在无痕窗口可打开；过期链接失效。

> **方向修正（2026-10-24）**：实时协同编辑优先于分享。先完成 Phase 2.5，再继续分享。

### Phase 2.5：可编辑表格与实时协同（新增，优先）

1. `cell_edits` 表 + 行查询覆盖层。
2. `PATCH /api/versions/:versionId/cells/:rowIndex`，owner/editor，类型校验。
3. WebSocket 鉴权、版本房间、单元格更新广播、在线用户/光标。
4. 前端可编辑虚拟表格：双击编辑、乐观更新、防抖保存、远程更新合并。
5. 评论/分享/版本读取覆盖后的数据；旧版本只读。

**验收**：两个账号打开同一版本，编辑不同单元格后实时互相可见；同一单元格后写覆盖；viewer/commenter 不能编辑；分享页显示编辑后的数据。

### Phase 3：报告与版本

1. 报告列表/创建/编辑/删除；TipTap 保存到服务端。
2. 报告内插入普通 TipTap 表格快照（方案 A）；`tableSnapshot` 自定义节点、NodeView、刷新快照暂缓（见第 17 节）。
3. PDF 导出改造。
4. 版本上传（新版本）+ 版本切换；diff 可放到 Phase 4。
5. 文档、测试、边界处理。

**验收**：报告自动保存；快照只显示限定行数；PDF 中快照完整；新版本上传后旧版本仍可查看；分享页显示最新 ready 版本。

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
- [ ] 上传新版本，版本列表正确，旧版本只读
- [ ] 行评论创建/展示/解决；切换版本评论隔离
- [ ] 分享链接跨设备/无痕可访问；过期失效；只读
- [ ] 报告创建/编辑/自动保存/重新打开
- [ ] 插入 10/20/50 行快照，PDF 完整显示
- [ ] 无 AI、无图表、无 ECharts 依赖与入口

### 技术

- [ ] `pnpm type-check` 通过（或仅剩与本次改动无关的既存问题，并记录）
- [ ] `pnpm lint` 不新增错误
- [ ] 后端无 mock 服务；真实数据库、真实文件存储、真实 JWT
- [ ] JWT 密钥/数据库连接在环境变量，不提交
- [ ] 分片上传可重试；complete 校验完整性
- [ ] 公开分享接口不泄露工作空间其他数据
- [ ] 权限校验覆盖文件/版本/评论/分享/报告
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
   - TipTap 自定义 atom 节点 + NodeView
   - html2canvas + jsPDF 动态导入、多页导出
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
- 报告 JSON 过大：限制请求体大小
- CSV 编码/日期：沿用 SheetJS 输出，不做额外转换
- 删除文件后分享链接：不可访问（deletedAt 过滤）
- 删除文件后报告快照：仍可显示（快照行已存在节点 attrs）
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

> 先读 `REFACTOR_PLAN.md` 和现有代码。删除所有 AI/图表功能；保留 Worker 解析、分片、虚拟滚动、IndexedDB 缓存、TipTap 自定义节点、PDF 导出；用 Express + MySQL（`mysql2` 参数化 SQL，不用 ORM）实现真实后端；按 Phase 0 → 3 逐步交付一个可登录、可上传、可分享、可评论、可写报告的云端表格协作平台。每个阶段结束运行 `pnpm type-check`，不要提交 `.env`、数据库和 `storage` 文件。

## 26. 协作与验收约定（用户要求，最高优先级）

1. **引导时只罗列要做的步骤（1. 2. 3.），不要解释原因。** 用户主动问“为什么”时才解释；用户明确说“讨论”某个方案时，可以正常展开论述。
2. **一次一格。** 先给规格让用户自己写，卡住才补全；只有用户明确说“帮我写 / 补全 / 改改”时才代写。
3. **每格验收。** 前端在仓库根目录运行 `pnpm type-check`（若后续拆分为 `client/`，则在 `client/` 运行 `npx tsc --noEmit`）；后端在 `server/` 运行 `npx tsc --noEmit`。每格都必须通过验收。
4. **curl 验证语句必须使用 Git Bash 可用语法。** 不要使用 PowerShell 或 cmd 专属语法；JSON 使用单引号。提取登录 token 使用以下命令（已在该环境验证）：
   ```bash
   TOKEN=$(curl -sS --noproxy '*' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"auth-test@example.com","password":"demo1234"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
   ```
   不要使用 `node -e` 解析 token；在该环境下未成功。
5. **测试数据必须清理。** 因测试新建的账号、工作空间、文件、评论、分享、报告等，测试完成后必须删除；只有后续开发确实需要的才保留。测试账号统一使用 `auth-test@example.com`，测试后用 SQL 删除对应工作空间和用户。
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

- owner/editor 可编辑**最新 ready 版本**的单元格。
- commenter/viewer 只读。
- 旧版本只读。
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
- 版本必须是文件最新的 ready 版本；旧版本 409。
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
  - `presence:join` / `presence:leave`
  - `presence:cursor`：在线用户当前行/列。
- 同一单元格同时编辑按 last-write-wins；前端以服务端返回的 revision 为准。

### 28.5 与现有功能

- 评论仍锚定原始 `rowIndex`，单元格编辑不改变行号。
- 分享页、报告快照读取覆盖后的最新版本数据。
- 新版本上传会建立新的基础数据；旧版本编辑冻结。
- 前端 IndexedDB 行缓存需要按编辑更新或失效。
- 可编辑表格仍使用虚拟滚动；只渲染可见行。

### 28.6 优先级

先完成 Phase 2.5 的“可编辑表格 + WebSocket 实时同步”，再继续分享和 Phase 3 报告。

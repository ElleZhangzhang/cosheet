<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ApiError } from "@/api/http";
import { useFileParser } from "@/composables/useFileParse";
import { createFile } from "@/services/files";
import {
  cancelVersion,
  completeVersion,
  getVersionChunks,
  uploadChunk,
} from "@/services/versions";
import type { ParsedSheet } from "@/types";
import type { UploadTaskMeta } from "@/types/uploadTask";
import {
  ROWS_PER_CHUNK,
  computeMissingChunks,
  isCompatibleSheet,
  isSameStoredFile,
} from "@/utils/uploadResume";
import {
  getUploadTaskFile,
  removeUploadTask,
  saveUploadTask,
} from "@/utils/uploadTaskStorage";

type Phase =
  | "idle"
  | "resuming"
  | "creating"
  | "uploading"
  | "completing"
  | "cancelling";

type ChunkUploadResult =
  | { ok: true }
  | { ok: false; fatal: boolean; message: string };

interface PoolResult {
  failed: number[];
  fatalMessage: string | null;
}

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;

const props = defineProps<{
  open: boolean;
  workspaceId: string;
  resumeTask?: UploadTaskMeta | null;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created"): void;
  (e: "cancelled"): void;
}>();

const { parseFile } = useFileParser();

const fileInput = ref<HTMLInputElement>();
const sheet = ref<ParsedSheet | null>(null);
const sourceFile = ref<File | null>(null);
const parsing = ref(false);
const error = ref("");

const phase = ref<Phase>("idle");
const versionId = ref<string | null>(null);
const totalChunks = ref(0);
const completedChunks = ref(0);
const failedChunks = ref<number[]>([]);
const fatalError = ref(false);
const cancelRequested = ref(false);

const busy = computed(() => phase.value !== "idle");

// 如果在上传中要unload，那么阻止默认行为
function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!busy.value) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
}

onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
});

const progressPercent = computed(() =>
  totalChunks.value === 0
    ? 0
    : Math.round((completedChunks.value / totalChunks.value) * 100)
);

const canRetryComplete = computed(
  () =>
    versionId.value !== null &&
    totalChunks.value > 0 &&
    completedChunks.value >= totalChunks.value &&
    failedChunks.value.length === 0 &&
    phase.value === "idle" &&
    error.value !== ""
);

const primaryDisabled = computed(() => {
  if (!sheet.value || busy.value || fatalError.value) {
    return true;
  }
  if (failedChunks.value.length > 0 || canRetryComplete.value) {
    return false;
  }

  return versionId.value !== null;
});

// #region 状态机的按钮文字
const primaryLabel = computed(() => {
  if (phase.value === "resuming") {
    return "恢复中...";
  }
  if (phase.value === "creating") {
    return "创建中...";
  }
  if (phase.value === "uploading") {
    return "上传中...";
  }
  if (phase.value === "completing") {
    return "完成中...";
  }
  if (phase.value === "cancelling") {
    return "取消中...";
  }
  if (fatalError.value) {
    return "上传失败";
  }
  if (failedChunks.value.length > 0) {
    return "重试失败分片";
  }
  if (canRetryComplete.value) {
    return "重试完成";
  }

  return "开始上传";
});

const cancelLabel = computed(() => {
  if (phase.value === "resuming") {
    return "准备中...";
  }
  if (phase.value === "cancelling") {
    return "取消中...";
  }
  if (phase.value === "completing") {
    return "完成中...";
  }
  if (phase.value === "creating" || phase.value === "uploading") {
    return "取消上传";
  }
  if (versionId.value !== null) {
    return "放弃上传";
  }

  return "取消";
});

const cancelDisabled = computed(
  () =>
    phase.value === "resuming" ||
    phase.value === "completing" ||
    phase.value === "cancelling"
);

const phaseText = computed(() => {
  switch (phase.value) {
    case "resuming":
      return "正在读取本地文件和服务器分片状态...";
    case "creating":
      return "正在创建文件和版本...";
    case "uploading":
      return "正在上传分片...";
    case "completing":
      return "正在完成版本...";
    case "cancelling":
      return "正在取消...";
    default:
      return "";
  }
});
//#endregion

const columnPreview = computed(() => {
  if (!sheet.value) {
    return "";
  }

  const labels = sheet.value.columns.slice(0, 8).map((column) => column.label);

  return labels.join("、") + (sheet.value.columns.length > 8 ? "…" : "");
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// 文件上传完毕 → 重置相关值，等待下一个文件的上传
function resetDialog(): void {
  sheet.value = null;
  sourceFile.value = null;
  parsing.value = false;
  error.value = "";
  phase.value = "idle"; // 空闲的、待机的
  versionId.value = null;
  totalChunks.value = 0;
  completedChunks.value = 0;
  failedChunks.value = [];
  fatalError.value = false;
  cancelRequested.value = false;
}

async function performCancel(): Promise<void> {
  const currentVersionId = versionId.value;
  phase.value = "cancelling";
  error.value = "";

  try {
    if (currentVersionId) {
      await cancelVersion(currentVersionId);
      await removeUploadTask(currentVersionId);
    }

    emit("cancelled");
    emit("update:open", false);
    resetDialog();
  } catch (err) {
    phase.value = "idle";
    cancelRequested.value = false;
    error.value = `取消失败：${err instanceof Error ? err.message : "请重试"}`;
  }
}

// 右上角 × / 点击遮罩：关闭弹窗，但保留未完成的任务
function closeDialog(): void {
  if (busy.value) {
    return;
  }

  emit("update:open", false);
  resetDialog();
}

function handleCancel(): void {
  if (phase.value === "creating" || phase.value === "uploading") {
    cancelRequested.value = true;
    phase.value = "cancelling";
  }
}

function handleCancelClick(): void {
  if (phase.value === "creating" || phase.value === "uploading") {
    handleCancel();
    return;
  }

  if (versionId.value) {
    void performCancel();
    return;
  }

  closeDialog();
}

function triggerFileInput(): void {
  fileInput.value?.click();
}

// 解析文件
async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";

  if (!file) {
    return;
  }

  sourceFile.value = file;
  sheet.value = null;
  error.value = "";
  parsing.value = true;

  try {
    sheet.value = await parseFile(file);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "文件解析失败";
  } finally {
    parsing.value = false;
  }
}

// LIGHT
// 1. 单块上传 + 重试机制
// 2. return boolean
async function uploadChunkWithRetry(index: number): Promise<ChunkUploadResult> {
  const parsed = sheet.value;
  const currentVersionId = versionId.value;

  if (!parsed || !currentVersionId) {
    return {
      ok: false,
      fatal: true,
      message: "上传状态已丢失，请重新上传",
    };
  }

  const start = index * ROWS_PER_CHUNK;
  const rows = parsed.rows.slice(start, start + ROWS_PER_CHUNK);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (cancelRequested.value) {
      return { ok: false, fatal: false, message: "上传已取消" };
    }

    try {
      await uploadChunk(currentVersionId, index, rows);
      return { ok: true };
    } catch (err) {
      // 4xx 是致命错误：继续传其他分片也不会成功
      const clientError =
        err instanceof ApiError && err.status >= 400 && err.status < 500;

      if (clientError) {
        return {
          ok: false,
          fatal: true,
          message: getErrorMessage(err, "分片上传失败"),
        };
      }

      if (attempt === MAX_ATTEMPTS) {
        return {
          ok: false,
          fatal: false,
          message: getErrorMessage(err, "分片上传失败"),
        };
      }

      // 三次尝试机会，第一次后等0.5s，第二次后等1s
      await delay(attempt === 1 ? 500 : 1000);
    }
  }

  return { ok: false, fatal: false, message: "分片上传失败" };
}

// LIGHT 并发控制池（这块有JS手撕实现欧）
async function runPool(indices: number[]): Promise<PoolResult> {
  const failed: number[] = [];
  let fatalMessage: string | null = null;
  let cursor = 0;

  // 并发器
  async function worker(): Promise<void> {
    while (true) {
      // 主动取消，或已经出现致命错误
      if (cancelRequested.value || fatalMessage !== null) {
        return;
      }

      const position = cursor;
      cursor += 1;

      // 所有请求都发送完了
      if (position >= indices.length) {
        return;
      }

      const index = indices[position];
      if (index === undefined) {
        return;
      }

      // await 请求 → 交出CPU控制权，执行下一个worker
      const result = await uploadChunkWithRetry(index);

      if (result.ok) {
        completedChunks.value += 1;
      } else if (!cancelRequested.value && fatalMessage === null) {
        if (result.fatal) {
          fatalMessage = result.message;
          return;
        }

        // 非致命失败先记录下来，其他分片继续上传；完成后只需重试这部分
        failed.push(index);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, indices.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { failed, fatalMessage };
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// 文件上传完成后的最后的兜底校验
async function finishVersion(): Promise<void> {
  const parsed = sheet.value;
  const currentVersionId = versionId.value;

  if (!parsed || !currentVersionId) {
    return;
  }

  phase.value = "completing";
  error.value = "";

  try {
    await completeVersion(currentVersionId, parsed.rowCount, totalChunks.value);
    await removeUploadTask(currentVersionId);

    emit("created");
    emit("update:open", false);
    resetDialog();
  } catch (err) {
    phase.value = "idle";
    error.value = `完成失败：${err instanceof Error ? err.message : "请重试"}`;
  }
}

async function uploadChunks(indices: number[]): Promise<void> {
  if (!versionId.value || !sheet.value) {
    return;
  }

  phase.value = "uploading";
  error.value = "";

  const { failed, fatalMessage } = await runPool(indices);

  if (cancelRequested.value) {
    await performCancel();
    return;
  }

  failedChunks.value = failed;

  if (fatalMessage) {
    fatalError.value = true;
    phase.value = "idle";
    error.value = fatalMessage;
    return;
  }

  if (failed.length > 0) {
    phase.value = "idle";
    error.value = `${failed.length} 个分片上传失败，请重试`;
    return;
  }

  if (completedChunks.value < totalChunks.value) {
    phase.value = "idle";
    error.value = "仍有分片未上传";
    return;
  }

  await finishVersion();
}

async function startResume(task: UploadTaskMeta): Promise<void> {
  phase.value = "resuming";
  error.value = "";
  fatalError.value = false;
  failedChunks.value = [];
  completedChunks.value = 0;
  totalChunks.value = 0;
  cancelRequested.value = false;

  try {
    // 读IndexedDB
    const file = await getUploadTaskFile(task.versionId);

    //#region  一堆校验
    if (!file) {
      throw new Error("原文件已丢失，请重新选择文件");
    }
    if (!isSameStoredFile(file, task)) {
      throw new Error("保存的文件与任务不一致，请重新选择文件");
    }

    sourceFile.value = file;
    const parsed = await parseFile(file);
    if (!isCompatibleSheet(parsed, task.rowCount)) {
      throw new Error("文件行数与任务不一致，请重新选择文件");
    }
    sheet.value = parsed;

    // 读mysql
    const server = await getVersionChunks(task.versionId);
    if (
      server.rowCount !== task.rowCount ||
      server.chunkCount !== task.chunkCount
    ) {
      throw new Error("服务端版本信息与任务不一致");
    }
    //#endregion

    versionId.value = server.versionId;
    totalChunks.value = server.chunkCount;

    const missing = computeMissingChunks(
      server.rowCount,
      server.chunkCount,
      server.chunks
    );
    completedChunks.value = server.chunkCount - missing.length;

    if (missing.length === 0) {
      await finishVersion();
      return;
    }

    await uploadChunks(missing);
  } catch (err) {
    // 版本已被删除或已完成，任务没有继续保留的意义
    if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
      await removeUploadTask(task.versionId);
    }

    sheet.value = null;
    sourceFile.value = null;
    versionId.value = null;
    totalChunks.value = 0;
    completedChunks.value = 0;
    phase.value = "idle";
    error.value = `恢复失败：${err instanceof Error ? err.message : "请重试"}`;
  }
}

async function startUpload(): Promise<void> {
  const parsed = sheet.value;

  if (!parsed || busy.value) {
    return;
  }

  error.value = "";
  failedChunks.value = [];
  fatalError.value = false;
  completedChunks.value = 0;
  totalChunks.value = 0;
  cancelRequested.value = false;
  phase.value = "creating";

  try {
    const created = await createFile(props.workspaceId, {
      name: parsed.name,
      columns: parsed.columns,
      rowCount: parsed.rowCount,
    });

    versionId.value = created.version.id;
    totalChunks.value = created.version.chunkCount;

    if (cancelRequested.value) {
      await performCancel();
      return;
    }

    const file = sourceFile.value;
    if (file) {
      try {
        await saveUploadTask(
          {
            versionId: created.version.id,
            fileId: created.file.id,
            workspaceId: props.workspaceId,
            fileName: file.name,
            fileSize: file.size,
            lastModified: file.lastModified,
            rowCount: parsed.rowCount,
            chunkCount: created.version.chunkCount,
            createdAt: Date.now(),
          },
          file
        );
      } catch {
        // 持久化失败不阻塞上传
      }
    }

    const indices = Array.from(
      { length: created.version.chunkCount },
      (_, index) => index
    );

    await uploadChunks(indices);
  } catch (err) {
    if (cancelRequested.value) {
      await performCancel();
      return;
    }

    // 这俩是响应式数据欧
    phase.value = "idle";
    error.value = `创建失败：${err instanceof Error ? err.message : "请重试"}`;
  }
}

async function retryFailed(): Promise<void> {
  if (busy.value || fatalError.value || failedChunks.value.length === 0) {
    return;
  }

  const indices = [...failedChunks.value];
  failedChunks.value = [];
  error.value = "";

  await uploadChunks(indices);
}

async function retryComplete(): Promise<void> {
  if (busy.value || !canRetryComplete.value) {
    return;
  }

  await finishVersion();
}

function handlePrimary(): void {
  if (primaryDisabled.value) {
    return;
  }

  if (failedChunks.value.length > 0) {
    void retryFailed();
    return;
  }

  if (canRetryComplete.value) {
    void retryComplete();
    return;
  }

  void startUpload();
}

watch(
  [() => props.open, () => props.resumeTask],
  ([open, resumeTask]) => {
    if (!open) {
      return;
    }

    resetDialog();

    if (resumeTask) {
      void startResume(resumeTask);
    }
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog-card">
        <header class="dialog-header">
          <h2>上传文件</h2>
          <button
            type="button"
            class="close-btn"
            :disabled="busy"
            @click="closeDialog"
          >
            ×
          </button>
        </header>

        <div class="dialog-body">
          <input
            ref="fileInput"
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            @change="handleFileChange"
          />

          <button
            type="button"
            class="select-btn"
            :disabled="parsing || busy || versionId !== null"
            @click="triggerFileInput"
          >
            {{ parsing ? "正在解析..." : "选择 Excel / CSV 文件" }}
          </button>

          <div v-if="sheet" class="sheet-summary">
            <strong>{{ sheet.name }}</strong>
            <span>
              {{ sheet.rowCount.toLocaleString() }} 行 ·
              {{ sheet.columnCount }} 列
            </span>
            <p class="column-preview">列：{{ columnPreview }}</p>
          </div>

          <div v-if="totalChunks > 0" class="progress-block">
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{ width: `${progressPercent}%` }"
              ></div>
            </div>
            <p class="progress-text">
              {{ completedChunks }} / {{ totalChunks }} 片 ·
              {{ progressPercent }}%
            </p>
          </div>

          <p v-if="phaseText" class="phase-text">{{ phaseText }}</p>

          <p v-if="error" class="error">{{ error }}</p>

          <p v-if="fatalError" class="fatal-hint">
            该错误无法通过重试解决，请取消后重新上传。
          </p>

          <p v-if="!sheet && !parsing && !error" class="hint">
            支持 .xlsx、.xls、.csv，只解析第一个工作表。
          </p>
        </div>

        <footer class="dialog-footer">
          <button
            type="button"
            class="ghost-btn"
            :disabled="cancelDisabled"
            @click="handleCancelClick"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="primaryDisabled"
            @click="handlePrimary"
          >
            {{ primaryLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(40, 33, 24, 0.35);
  backdrop-filter: blur(2px);
}

.dialog-card {
  width: 100%;
  max-width: 480px;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 16px;
  background: #fffdf9;
  box-shadow: 0 24px 60px rgba(60, 46, 27, 0.18);
  color: #333;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.15);
}

.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #999;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.close-btn:hover:not(:disabled) {
  background: rgba(191, 161, 117, 0.08);
  color: #555;
}

.dialog-body {
  padding: 24px;
}

.select-btn {
  width: 100%;
  padding: 14px;
  border: 1px dashed rgba(191, 161, 117, 0.45);
  border-radius: 10px;
  background: rgba(191, 161, 117, 0.04);
  color: #8a7355;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.select-btn:hover:not(:disabled) {
  background: rgba(191, 161, 117, 0.1);
}

.select-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sheet-summary {
  margin-top: 18px;
  padding: 16px;
  border: 1px solid rgba(191, 161, 117, 0.18);
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
}

.sheet-summary strong {
  display: block;
  margin-bottom: 6px;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-summary span {
  color: #888;
}

.column-preview {
  margin: 10px 0 0;
  color: #999;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}

.progress-block {
  margin-top: 18px;
}

.progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(191, 161, 117, 0.12);
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #bfa175 0%, #d8b08a 100%);
  transition: width 0.2s ease;
}

.progress-text {
  margin: 8px 0 0;
  color: #8a7355;
  font-size: 12px;
}

.phase-text {
  margin: 12px 0 0;
  color: #8a7355;
  font-size: 13px;
}

.error {
  margin: 16px 0 0;
  padding: 10px 12px;
  border: 1px solid rgba(245, 108, 108, 0.25);
  border-radius: 8px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 13px;
  line-height: 1.5;
}

.hint {
  margin: 14px 0 0;
  color: #aaa;
  font-size: 12px;
  line-height: 1.6;
}

.fatal-hint {
  margin: 10px 0 0;
  color: #b06a6a;
  font-size: 12px;
  line-height: 1.6;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 22px;
}

.ghost-btn,
.primary-btn {
  padding: 9px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn {
  border: 1px solid rgba(191, 161, 117, 0.3);
  background: transparent;
  color: #8a7355;
}

.primary-btn {
  border: none;
  background: linear-gradient(135deg, #bfa175 0%, #d8b08a 100%);
  color: #fff;
}

.ghost-btn:disabled,
.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

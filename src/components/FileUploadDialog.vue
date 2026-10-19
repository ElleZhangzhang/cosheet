<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useFileParser } from "@/composables/useFileParse";
import { createFile } from "@/services/files";
import { completeVersion, uploadChunk } from "@/services/versions";
import type { ParsedSheet } from "@/types";

const props = defineProps<{
  open: boolean;
  workspaceId: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created"): void;
}>();

const { parseFile } = useFileParser();

const fileInput = ref<HTMLInputElement>();
const sheet = ref<ParsedSheet | null>(null);
const parsing = ref(false);
const uploading = ref(false);
const error = ref("");
const progress = ref({ current: 0, total: 0 });

const columnPreview = computed(() => {
  if (!sheet.value) {
    return "";
  }

  const labels = sheet.value.columns.slice(0, 8).map((column) => column.label);

  return labels.join("、") + (sheet.value.columns.length > 8 ? "…" : "");
});

function resetDialog(): void {
  sheet.value = null;
  parsing.value = false;
  uploading.value = false;
  error.value = "";
  progress.value = { current: 0, total: 0 };
}

function closeDialog(): void {
  if (uploading.value) {
    return;
  }

  emit("update:open", false);
  resetDialog();
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

  sheet.value = null;
  error.value = "";
  progress.value = { current: 0, total: 0 };
  parsing.value = true;

  try {
    sheet.value = await parseFile(file);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "文件解析失败";
  } finally {
    parsing.value = false;
  }
}

async function handleUpload(): Promise<void> {
  const parsed = sheet.value;
  if (!parsed || parsing.value || uploading.value) {
    return;
  }

  uploading.value = true;
  error.value = "";

  try {
    const created = await createFile(props.workspaceId, {
      name: parsed.name,
      columns: parsed.columns,
      rowCount: parsed.rowCount,
    });
    const versionId = created.version.id;

    progress.value = { current: 0, total: created.version.chunkCount };

    // 顺序上传；并发、进度条和重试在下一格补充
    for (let index = 0; index < created.version.chunkCount; index += 1) {
      const start = index * 500;
      const rows = parsed.rows.slice(start, start + 500);

      await uploadChunk(versionId, index, rows);
      progress.value = {
        current: index + 1,
        total: created.version.chunkCount,
      };
    }

    await completeVersion(
      versionId,
      parsed.rowCount,
      created.version.chunkCount
    );

    emit("created");
    emit("update:open", false);
    resetDialog();
  } catch (err) {
    // 失败时保留 uploading 版本，下一格实现重试/取消
    error.value = err instanceof Error ? err.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetDialog();
    }
  }
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
            :disabled="uploading"
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
            :disabled="parsing || uploading"
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

          <p v-if="uploading" class="progress">
            正在上传 {{ progress.current }} / {{ progress.total }} 片
          </p>

          <p v-if="error" class="error">{{ error }}</p>

          <p v-if="!sheet && !parsing && !error" class="hint">
            支持 .xlsx、.xls、.csv，只解析第一个工作表。
          </p>
        </div>

        <footer class="dialog-footer">
          <button
            type="button"
            class="ghost-btn"
            :disabled="uploading"
            @click="closeDialog"
          >
            取消
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="!sheet || parsing || uploading"
            @click="handleUpload"
          >
            {{ uploading ? "上传中..." : "开始上传" }}
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

.progress {
  margin: 16px 0 0;
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

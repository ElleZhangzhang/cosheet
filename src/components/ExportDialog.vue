<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  exportVersionExcel,
  exportVersionPdf,
} from "@/utils/versionExport";
import type { ColumnDef } from "@/types";

type ExportFormat = "excel" | "pdf";

const props = defineProps<{
  open: boolean;
  versionId: string;
  versionNumber: number;
  fileName: string;
  columns: ColumnDef[];
  rowCount: number;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const format = ref<ExportFormat>("excel");
const exporting = ref(false);
const error = ref("");
const loadedRows = ref(0);
const totalRows = ref(0);
const stageText = ref("");

const progressText = computed(() => {
  if (!exporting.value) {
    return "";
  }

  if (stageText.value) {
    return stageText.value;
  }

  return totalRows.value > 0
    ? `已读取 ${loadedRows.value.toLocaleString()} / ${totalRows.value.toLocaleString()} 行`
    : "正在读取数据...";
});

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return;
    }

    error.value = "";
    loadedRows.value = 0;
    totalRows.value = props.rowCount;
    stageText.value = "";
  }
);

function handleClose(): void {
  if (exporting.value) {
    return;
  }

  emit("update:open", false);
}

async function handleExport(): Promise<void> {
  if (exporting.value) {
    return;
  }

  exporting.value = true;
  error.value = "";
  loadedRows.value = 0;
  totalRows.value = props.rowCount;
  stageText.value = "";

  const options = {
    versionId: props.versionId,
    versionNumber: props.versionNumber,
    fileName: props.fileName,
    columns: props.columns,
    onProgress: (loaded: number, total: number) => {
      loadedRows.value = loaded;
      totalRows.value = total;
    },
    onStage: (message: string) => {
      stageText.value = message;
    },
  };

  try {
    if (format.value === "excel") {
      await exportVersionExcel(options);
    } else {
      await exportVersionPdf(options);
    }

    emit("update:open", false);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "导出失败，请重试";
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-overlay" @click.self="handleClose">
      <div class="dialog-card">
        <header class="dialog-header">
          <h2>导出版本</h2>
          <button
            type="button"
            class="close-btn"
            :disabled="exporting"
            aria-label="关闭"
            @click="handleClose"
          >
            ×
          </button>
        </header>

        <div class="dialog-body">
          <p class="file-summary">
            {{ fileName }} · v{{ versionNumber }} ·
            {{ rowCount.toLocaleString() }} 行
          </p>

          <div class="format-list">
            <label
              class="format-option"
              :class="{ active: format === 'excel' }"
            >
              <input
                v-model="format"
                type="radio"
                value="excel"
                :disabled="exporting"
              />
              <span class="format-text">
                <strong>Excel</strong>
                <span>导出完整版本，包含全部行和列</span>
              </span>
            </label>

            <label class="format-option" :class="{ active: format === 'pdf' }">
              <input
                v-model="format"
                type="radio"
                value="pdf"
                :disabled="exporting"
              />
              <span class="format-text">
                <strong>PDF</strong>
                <span>竖向 A4、多页，导出全部行</span>
              </span>
            </label>
          </div>

          <p
            v-if="format === 'pdf' && rowCount > 1000"
            class="pdf-note"
          >
            将导出全部 {{ rowCount.toLocaleString() }}
            行，页数较多时生成需要较长时间。
          </p>

          <p v-if="exporting" class="progress-text">
            {{ progressText }}
          </p>

          <div v-if="error" class="error-banner">
            {{ error }}
          </div>
        </div>

        <footer class="dialog-footer">
          <button
            type="button"
            class="ghost-btn"
            :disabled="exporting"
            @click="handleClose"
          >
            取消
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="exporting"
            @click="handleExport"
          >
            {{
              exporting
                ? "导出中..."
                : format === "excel"
                ? "导出 Excel"
                : "导出 PDF"
            }}
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
  max-width: 520px;
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
  padding: 22px 24px;
}

.file-summary {
  margin: 0 0 16px;
  color: #8a7355;
  font-size: 13px;
}

.format-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.format-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.format-option.active {
  border-color: #bfa175;
  background: rgba(191, 161, 117, 0.06);
}

.format-option input {
  margin-top: 3px;
  accent-color: #bfa175;
}

.format-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
}

.format-text strong {
  font-size: 14px;
}

.format-text span {
  color: #8c7e6b;
  font-size: 12px;
}

.pdf-note,
.export-note {
  margin: 14px 0 0;
  color: #8a7355;
  font-size: 12px;
  line-height: 1.6;
}

.progress-text {
  margin: 14px 0 0;
  color: #8a7355;
  font-size: 12px;
}

.error-banner {
  margin-top: 14px;
  padding: 9px 12px;
  border: 1px solid rgba(245, 108, 108, 0.2);
  border-radius: 8px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
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

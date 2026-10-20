<script setup lang="ts">
import type { UploadTaskMeta } from "@/types/uploadTask";

defineProps<{
  tasks: UploadTaskMeta[];
  abandoningId?: string | null;
}>();

defineEmits<{
  (e: "resume", task: UploadTaskMeta): void;
  (e: "abandon", task: UploadTaskMeta): void;
}>();

function formatTime(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
</script>

<template>
  <section v-if="tasks.length > 0" class="unfinished-card">
    <header class="unfinished-header">
      <div>
        <h2>未完成的上传</h2>
        <p>这些文件上次没有上传完成，可以继续上传或放弃。</p>
      </div>
      <span class="unfinished-count">{{ tasks.length }} 个</span>
    </header>

    <div class="unfinished-list">
      <article
        v-for="task in tasks"
        :key="task.versionId"
        class="unfinished-row"
      >
        <div class="task-icon">↑</div>

        <div class="task-main">
          <strong>{{ task.fileName }}</strong>
          <span>
            {{ task.rowCount.toLocaleString() }} 行 ·
            共 {{ task.chunkCount }} 片 ·
            {{ formatTime(task.createdAt) }}
          </span>
        </div>

        <div class="task-actions">
          <button
            type="button"
            class="ghost-btn"
            :disabled="abandoningId === task.versionId"
            @click="$emit('abandon', task)"
          >
            {{
              abandoningId === task.versionId
                ? "放弃中..."
                : "放弃上传"
            }}
          </button>
          <button
            type="button"
            class="resume-btn"
            :disabled="abandoningId === task.versionId"
            @click="$emit('resume', task)"
          >
            继续上传
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.unfinished-card {
  margin-top: 20px;
  overflow: hidden;
  border: 1px solid rgba(218, 165, 32, 0.3);
  border-radius: 12px;
  background: #fffdf5;
}

.unfinished-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(218, 165, 32, 0.15);
}

.unfinished-header h2 {
  margin: 0 0 4px;
  color: #6f5a36;
  font-size: 15px;
  font-weight: 600;
}

.unfinished-header p {
  margin: 0;
  color: #a08b67;
  font-size: 12px;
}

.unfinished-count {
  flex-shrink: 0;
  color: #a08b67;
  font-size: 12px;
}

.unfinished-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 22px;
  border-bottom: 1px solid rgba(218, 165, 32, 0.1);
}

.unfinished-row:last-child {
  border-bottom: none;
}

.task-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(218, 165, 32, 0.12);
  color: #b08a2e;
  font-size: 16px;
  font-weight: 700;
}

.task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.task-main strong {
  overflow: hidden;
  color: #5f513a;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-main span {
  color: #a08b67;
  font-size: 12px;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ghost-btn,
.resume-btn {
  padding: 7px 13px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn {
  border: 1px solid rgba(191, 161, 117, 0.3);
  background: transparent;
  color: #8a7355;
}

.resume-btn {
  border: none;
  background: #bfa175;
  color: #fff;
}

.ghost-btn:disabled,
.resume-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

<script setup lang="ts">
import type { FileVersionDetail } from "@/types/api";

const props = defineProps<{
  versions: FileVersionDetail[];
  selectedVersionId: string;
}>();

const emit = defineEmits<{
  (e: "change", versionId: string): void;
}>();

function handleChange(event: Event): void {
  const versionId = (event.target as HTMLSelectElement).value;

  if (!versionId || versionId === props.selectedVersionId) {
    return;
  }

  emit("change", versionId);
}

function optionLabel(version: FileVersionDetail): string {
  if (version.status !== "ready") {
    return `v${version.versionNumber} · 上传中`;
  }

  return `v${version.versionNumber} · ${version.rowCount.toLocaleString()} 行`;
}
</script>

<template>
  <label class="version-selector">
    <span class="version-label">版本</span>
    <select
      class="version-select"
      :value="selectedVersionId"
      @change="handleChange"
    >
      <option
        v-for="version in versions"
        :key="version.id"
        :value="version.id"
        :disabled="version.status !== 'ready'"
      >
        {{ optionLabel(version) }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.version-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.version-label {
  color: #999;
  font-size: 12px;
}

.version-select {
  padding: 7px 10px;
  border: 1px solid #e6e0d8;
  border-radius: 7px;
  background: #fffdf9;
  color: #5f513a;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.version-select:focus {
  border-color: #bfa175;
  box-shadow: 0 0 0 3px rgba(191, 161, 117, 0.12);
}
</style>

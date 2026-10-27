<script setup lang="ts">
defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "retain"): void;
  (e: "clear"): void;
  (e: "close"): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-overlay"
      @click.self="emit('close')"
    >
      <div class="dialog-card">
        <header class="dialog-header">
          <h2>导出前处理未保留修改</h2>
          <button
            type="button"
            class="close-btn"
            aria-label="关闭"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-body">
          <p>
            当前版本还有未保留的修改。保留版本后会导出新版本；
            清除改动会回退到基础数据，并且不会导出。
          </p>
        </div>

        <footer class="dialog-footer">
          <button
            type="button"
            class="danger-btn"
            @click="emit('clear')"
          >
            清除改动并取消导出
          </button>
          <button
            type="button"
            class="primary-btn"
            @click="emit('retain')"
          >
            保留版本并导出
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
  z-index: 110;
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

.close-btn:hover {
  background: rgba(191, 161, 117, 0.08);
  color: #555;
}

.dialog-body {
  padding: 22px 24px;
}

.dialog-body p {
  margin: 0;
  color: #7a6a55;
  font-size: 13px;
  line-height: 1.8;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 22px;
}

.danger-btn,
.primary-btn {
  padding: 9px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.danger-btn {
  border: 1px solid rgba(245, 108, 108, 0.35);
  background: transparent;
  color: #d05c5c;
}

.danger-btn:hover {
  background: #fef0f0;
}

.primary-btn {
  border: none;
  background: linear-gradient(135deg, #bfa175 0%, #d8b08a 100%);
  color: #fff;
}
</style>

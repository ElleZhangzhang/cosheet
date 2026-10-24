<script setup lang="ts">
import { ref, watch } from "vue";
import type { RowComment } from "@/types/api";

const props = defineProps<{
  open: boolean;
  rowIndex: number;
  comments: RowComment[];
  loading: boolean;
  error: string;
  submitting: boolean;
  canComment: boolean;
  canResolveAny: boolean;
  canDeleteAny: boolean;
  currentUserId: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "create", content: string): void;
  (
    e: "toggle-resolve",
    comment: RowComment,
    resolved: boolean
  ): void;
  (e: "delete", comment: RowComment): void;
}>();

const newComment = ref("");

function canResolve(comment: RowComment): boolean {
  return (
    props.canResolveAny ||
    (props.canComment && comment.authorId === props.currentUserId)
  );
}

function canDelete(comment: RowComment): boolean {
  return (
    props.canDeleteAny || comment.authorId === props.currentUserId
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function handleSubmit(): void {
  const content = newComment.value.trim();
  if (!content || props.submitting) {
    return;
  }

  emit("create", content);
  newComment.value = "";
}

watch(
  [() => props.open, () => props.rowIndex],
  ([open]) => {
    if (open) {
      newComment.value = "";
    }
  }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="panel-overlay" @click.self="emit('close')">
      <aside class="comments-panel">
        <header class="panel-header">
          <div>
            <h2>第 {{ rowIndex + 1 }} 行评论</h2>
            <p>{{ comments.length }} 条评论</p>
          </div>
          <button
            type="button"
            class="close-btn"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="panel-body">
          <div v-if="loading && comments.length === 0" class="state">
            正在加载评论...
          </div>

          <div v-if="error" class="error">{{ error }}</div>

          <div
            v-if="loading && comments.length > 0"
            class="updating"
          >
            更新中...
          </div>

          <div v-if="comments.length > 0" class="comment-list">
            <article
              v-for="comment in comments"
              :key="comment.id"
              class="comment-card"
              :class="{ resolved: comment.resolved }"
            >
              <header class="comment-meta">
                <strong>{{ comment.authorName }}</strong>
                <span>{{ formatTime(comment.createdAt) }}</span>
              </header>

              <p class="comment-content">{{ comment.content }}</p>

              <div class="comment-tags">
                <span v-if="comment.columnKey" class="column-tag">
                  列：{{ comment.columnKey }}
                </span>
                <span v-if="comment.resolved" class="resolved-tag">
                  已解决
                </span>
              </div>

              <div
                v-if="canResolve(comment) || canDelete(comment)"
                class="comment-actions"
              >
                <button
                  v-if="canResolve(comment)"
                  type="button"
                  class="text-btn"
                  :disabled="submitting"
                  @click="
                    emit(
                      'toggle-resolve',
                      comment,
                      !comment.resolved
                    )
                  "
                >
                  {{ comment.resolved ? "重新打开" : "标记解决" }}
                </button>
                <button
                  v-if="canDelete(comment)"
                  type="button"
                  class="text-btn danger"
                  :disabled="submitting"
                  @click="emit('delete', comment)"
                >
                  删除
                </button>
              </div>
            </article>
          </div>

          <div
            v-if="!loading && comments.length === 0 && !error"
            class="state"
          >
            这一行还没有评论
          </div>
        </div>

        <footer v-if="canComment" class="panel-footer">
          <textarea
            v-model="newComment"
            rows="3"
            maxlength="5000"
            placeholder="写下这条评论..."
            :disabled="submitting"
          ></textarea>
          <button
            type="button"
            class="send-btn"
            :disabled="submitting || !newComment.trim()"
            @click="handleSubmit"
          >
            {{ submitting ? "提交中..." : "发表评论" }}
          </button>
        </footer>

        <footer v-else class="readonly-footer">
          当前角色只能查看评论。
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  justify-content: flex-end;
  background: rgba(40, 33, 24, 0.25);
}

.comments-panel {
  width: 400px;
  max-width: 92vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(191, 161, 117, 0.2);
  background: #fffdf9;
  box-shadow: -12px 0 40px rgba(60, 46, 27, 0.12);
  color: #333;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 22px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.15);
}

.panel-header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.panel-header p {
  margin: 6px 0 0;
  color: #999;
  font-size: 12px;
}

.close-btn {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
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

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
}

.state {
  padding: 28px 0;
  color: #aaa;
  font-size: 13px;
  text-align: center;
}

.updating {
  margin-bottom: 10px;
  color: #aaa;
  font-size: 11px;
  text-align: right;
}

.error {
  margin-bottom: 14px;
  padding: 9px 12px;
  border: 1px solid rgba(245, 108, 108, 0.25);
  border-radius: 8px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.5;
}

.comment-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.comment-card {
  padding: 13px 14px;
  border: 1px solid rgba(191, 161, 117, 0.16);
  border-radius: 10px;
  background: #fff;
}

.comment-card.resolved {
  background: #fafafa;
  opacity: 0.78;
}

.comment-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.comment-meta strong {
  color: #5f513a;
  font-size: 13px;
  font-weight: 600;
}

.comment-meta span {
  color: #aaa;
  font-size: 11px;
}

.comment-content {
  margin: 9px 0 0;
  color: #444;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.comment-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.column-tag,
.resolved-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}

.column-tag {
  background: rgba(191, 161, 117, 0.1);
  color: #8a7355;
}

.resolved-tag {
  background: #f0f9eb;
  color: #67c23a;
}

.comment-actions {
  display: flex;
  gap: 12px;
  margin-top: 10px;
}

.text-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: #8a7355;
  font-size: 12px;
  cursor: pointer;
}

.text-btn:hover:not(:disabled) {
  text-decoration: underline;
}

.text-btn.danger {
  color: #f56c6c;
}

.text-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panel-footer {
  padding: 16px 22px 20px;
  border-top: 1px solid rgba(191, 161, 117, 0.15);
}

.panel-footer textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid #e6e0d8;
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
}

.panel-footer textarea:focus {
  border-color: #bfa175;
  box-shadow: 0 0 0 3px rgba(191, 161, 117, 0.12);
}

.send-btn {
  width: 100%;
  margin-top: 10px;
  padding: 9px;
  border: none;
  border-radius: 8px;
  background: #bfa175;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.send-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.readonly-footer {
  padding: 16px 22px 20px;
  border-top: 1px solid rgba(191, 161, 117, 0.15);
  color: #aaa;
  font-size: 12px;
  text-align: center;
}
</style>

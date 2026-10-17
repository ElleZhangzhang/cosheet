<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useDataStore } from "@/stores/data";

const router = useRouter();
const dataStore = useDataStore();

const error = ref("");
const exporting = ref(false);

const currentDataset = computed(() => dataStore.currentDataset);

// TipTap Editor
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Placeholder.configure({
      placeholder: "在此编辑分析报告内容...",
    }),
    Table,
    TableRow,
    TableCell,
    TableHeader,
  ],
  editorProps: {
    attributes: {
      class: "prose prose-sm max-w-none",
    },
  },
});

// 导航退回
function goBack() {
  router.push("/");
}

// #region PDF导出
async function exportPDF() {
  const proseMirror = document.querySelector(
    ".ProseMirror"
  ) as HTMLElement | null;
  if (!proseMirror || !currentDataset.value) return;

  exporting.value = true;

  try {
    //  await import() 是动态导入——用户点击导出按钮时才下载这两个库，不会影响编辑器打开速度。
    // 把 HTML 元素截成一张图片
    const { default: html2canvas } = await import("html2canvas");
    // 创建 PDF 文件，往里面贴图片
    const { jsPDF } = await import("jspdf");

    const canvas = await html2canvas(proseMirror, {
      scale: 2, // 2 倍清晰度
      useCORS: true, // 允许截图中包含跨域图片
      backgroundColor: "#ffffff",
      logging: false,
    });

    //  canvas.toDataURL("image/png") 把 Canvas 转成一长串 base64编码的图片数据。这个字符串可以传给 jsPDF。
    const imgData = canvas.toDataURL("image/png");
    // 三个参数：纵向  单位毫米  纸张大小
    const pdf = new jsPDF("p", "mm", "a4");
    //  A4 宽 210mm ≈ 21cm
    const pdfWidth = 210;
    // A4 高 297mm ≈ 29.7cm
    const pdfHeight = 297;
    // 左右各留 8mm 边距，图片宽194mm
    const imgWidth = pdfWidth - 16;
    //  按比例计算图片在 PDF 中的高度，等比缩放，不变形
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    // 第一页：position = 0，图片顶部对齐PDF顶部
    const xOffset = 8;
    pdf.addImage(imgData, "PNG", xOffset, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    // 后续页：把图片往上移，显示剩余部分
    while (heightLeft > 0) {
      // 图片往上移一页
      position -= pdfHeight;
      // 新建一页
      pdf.addPage();
      pdf.addImage(imgData, "PNG", xOffset, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    // 下载：浏览器弹出下载对话框，文件名如 员工数据_分析报告.pdf。
    pdf.save(`${currentDataset.value.name}_分析报告.pdf`);
  } catch (e) {
    console.error("PDF 导出失败", e);
    error.value = "PDF 导出失败，请重试";
  } finally {
    exporting.value = false;
  }
}
//#endregion
</script>

<template>
  <div class="report-editor">
    <!-- Header -->
    <header class="editor-header">
      <button class="btn-back" @click="goBack">← 返回</button>
      <h2 class="report-title">
        {{ currentDataset?.name || "数据分析报告" }}
      </h2>
      <div class="header-actions">
        <button class="btn btn-export" :disabled="exporting" @click="exportPDF">
          {{ exporting ? "⏳ 导出中..." : "📄 导出 PDF" }}
        </button>
      </div>
    </header>

    <!-- Error banner -->
    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <!-- Main layout -->
    <div class="editor-layout">
      <!-- Editor area -->
      <main class="editor-main">
        <!-- Toolbar -->
        <div v-if="editor" class="editor-toolbar">
          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('bold') }"
            @click="editor.chain().focus().toggleBold().run()"
            title="加粗"
          >
            <strong>B</strong>
          </button>
          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('italic') }"
            @click="editor.chain().focus().toggleItalic().run()"
            title="斜体"
          >
            <em>I</em>
          </button>
          <span class="toolbar-divider"></span>

          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('heading', { level: 1 }) }"
            @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
            title="标题1"
          >
            H1
          </button>
          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('heading', { level: 2 }) }"
            @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
            title="标题2"
          >
            H2
          </button>
          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('heading', { level: 3 }) }"
            @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
            title="标题3"
          >
            H3
          </button>
          <span class="toolbar-divider"></span>

          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('bulletList') }"
            @click="editor.chain().focus().toggleBulletList().run()"
            title="无序列表"
          >
            ≡
          </button>
          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('orderedList') }"
            @click="editor.chain().focus().toggleOrderedList().run()"
            title="有序列表"
          >
            1.
          </button>
          <span class="toolbar-divider"></span>

          <button
            class="toolbar-btn"
            :class="{ active: editor.isActive('blockquote') }"
            @click="editor.chain().focus().toggleBlockquote().run()"
            title="引用"
          >
            ❝
          </button>
          <button
            class="toolbar-btn"
            @click="editor.chain().focus().setHorizontalRule().run()"
            title="分割线"
          >
            —
          </button>
          <span class="toolbar-divider"></span>

          <button
            class="toolbar-btn"
            @click="editor.chain().focus().undo().run()"
            title="撤销"
          >
            ↩
          </button>
          <button
            class="toolbar-btn"
            @click="editor.chain().focus().redo().run()"
            title="重做"
          >
            ↪
          </button>
        </div>

        <!-- PDF export overlay -->
        <div v-if="exporting" class="loading-overlay">
          <div class="loading-spinner"></div>
          <p>正在导出 PDF...</p>
        </div>

        <!-- Editor content -->
        <div class="editor-content-wrapper">
          <EditorContent :editor="editor" class="editor-content" />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.report-editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

/* Header */
.editor-header {
  display: flex;
  align-items: center;
  padding: 12px 24px;
  background: white;
  border-bottom: 1px solid #e8e8e8;
  gap: 16px;
  flex-shrink: 0;
  z-index: 10;
}

.btn-back {
  padding: 6px 14px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  color: #555;
  transition: all 0.2s;
}

.btn-back:hover {
  border-color: #409eff;
  color: #409eff;
}

.report-title {
  flex: 1;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.btn {
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-export {
  background: white;
  color: #555;
  border: 1px solid #d9d9d9;
}

.btn-export:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}

/* Error banner */
.error-banner {
  padding: 10px 24px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* Main layout */
.editor-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Editor main area */
.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* Toolbar */
.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: white;
  border-bottom: 1px solid #e8e8e8;
  gap: 2px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.toolbar-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  color: #555;
  transition: all 0.15s;
}

.toolbar-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.toolbar-btn.active {
  background: #e6f4ff;
  color: #409eff;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: #e0e0e0;
  margin: 0 6px;
}

/* Loading overlay */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  z-index: 20;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e8e8e8;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-overlay p {
  color: #666;
  font-size: 15px;
}

/* Editor content area */
.editor-content-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
  background: #fafafa;
}

:deep(.editor-content) {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  padding: 48px 64px;
  min-height: 600px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  outline: none;
}

/* TipTap prose styling */
:deep(.ProseMirror) {
  outline: none;
  min-height: 600px;
}

:deep(.ProseMirror p) {
  margin: 0 0 12px;
  line-height: 1.8;
  font-size: 15px;
  color: #333;
}

:deep(.ProseMirror h1) {
  font-size: 26px;
  font-weight: 700;
  margin: 32px 0 16px;
  color: #1f2937;
  border-bottom: 2px solid #409eff;
  padding-bottom: 8px;
}

:deep(.ProseMirror h2) {
  font-size: 20px;
  font-weight: 600;
  margin: 28px 0 12px;
  color: #1f2937;
}

:deep(.ProseMirror h3) {
  font-size: 17px;
  font-weight: 600;
  margin: 20px 0 10px;
  color: #374151;
}

:deep(.ProseMirror ul),
:deep(.ProseMirror ol) {
  margin: 8px 0 16px;
  padding-left: 24px;
}

:deep(.ProseMirror li) {
  margin-bottom: 4px;
  line-height: 1.7;
  font-size: 15px;
}

:deep(.ProseMirror blockquote) {
  margin: 16px 0;
  padding: 12px 20px;
  border-left: 4px solid #409eff;
  background: #f9fafb;
  color: #555;
  font-style: normal;
}

:deep(.ProseMirror hr) {
  margin: 24px 0;
  border: none;
  border-top: 1px solid #e0e0e0;
}

:deep(.ProseMirror table) {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
}

:deep(.ProseMirror th),
:deep(.ProseMirror td) {
  border: 1px solid #d9d9d9;
  padding: 8px 12px;
  text-align: left;
  font-size: 14px;
}

:deep(.ProseMirror th) {
  background: #f5f7fa;
  font-weight: 600;
}

/* Placeholder styling */
:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #bbb;
  pointer-events: none;
  height: 0;
}
</style>

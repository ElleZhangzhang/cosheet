// 说明：导出版本数据为 Excel 或 PDF

import { getVersionRows } from "@/services/versions";
import type { ColumnDef } from "@/types";
import type { VersionRow } from "@/types/api";

const PAGE_SIZE = 500;
const FETCH_CONCURRENCY = 3;
const PDF_ROWS_PER_PAGE = 35;

interface ExportProgressOptions {
  onProgress?: (loaded: number, total: number) => void;
  onStage?: (message: string) => void;
}

interface VersionExportOptions extends ExportProgressOptions {
  versionId: string;
  versionNumber: number;
  fileName: string;
  columns: ColumnDef[];
}

// 文件名清洗
function sanitizeBaseName(fileName: string): string {
  // 去掉后缀
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "");
  // 替换9种特殊字符为_ + 去掉前后空格
  const sanitized = withoutExtension
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();

  return sanitized || "table";
}

function makeFileName(
  fileName: string,
  versionNumber: number,
  extension: "xlsx" | "pdf"
): string {
  return `${sanitizeBaseName(fileName)}_v${versionNumber}.${extension}`;
}

function makeSheetName(
  fileName: string,
  versionNumber: number
): string {
  const base = sanitizeBaseName(fileName).replace(/[\[\]:*?]/g, "_");
  return (base || `v${versionNumber}`).slice(0, 31);
}

function cellValue(row: VersionRow, column: ColumnDef): unknown {
  const value = row[column.keyName];
  return value === null || value === undefined ? "" : value;
}

async function fetchAllRows(
  versionId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<VersionRow[]> {
  const firstPage = await getVersionRows(versionId, {
    offset: 0,
    limit: PAGE_SIZE,
  });

  // file总行数
  const total = firstPage.total;
  // chunk总行数
  const rows = [...firstPage.rows];

  onProgress?.(rows.length, total);

  const offsets: number[] = [];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
    offsets.push(offset);
  }

  // 每3个并行读取本地磁盘文件
  for (let index = 0; index < offsets.length; index += FETCH_CONCURRENCY) {
    const batchOffsets = offsets.slice(
      index,
      index + FETCH_CONCURRENCY
    );
    const pages = await Promise.all(
      batchOffsets.map((offset) =>
        getVersionRows(versionId, {
          offset,
          limit: PAGE_SIZE,
        })
      )
    );

    for (const page of pages) {
      rows.push(...page.rows);
    }

    onProgress?.(rows.length, total);
  }

  return rows;
}

function appendCell(
  row: HTMLTableRowElement,
  value: unknown,
  tagName: "td" | "th"
): void {
  const cell = document.createElement(tagName);
  cell.textContent = String(value ?? "");
  row.appendChild(cell);
}

// utils.aoa_to_sheet转换二维数组为工作表形式 → utils.book_append_sheet创工作簿放（多个）工作表 → writeFile将一坨JS对象编译为二进制数据 +触发下载
export async function exportVersionExcel(
  options: VersionExportOptions
): Promise<void> {
  const rows = await fetchAllRows(options.versionId, options.onProgress);

  options.onStage?.("正在生成 Excel...");

  // LIGHT 懒加载库
  const XLSX = await import("xlsx");

  const header = options.columns.map((column) => column.label);
  const data = rows.map((row) =>
    options.columns.map((column) => cellValue(row, column))
  );
  // [['name', 'age'], ['elle', 19], 'elle zhang', 20]
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  const workbook = XLSX.utils.book_new();

  worksheet["!cols"] = options.columns.map((column) => ({
    // 12<= column.width/8 <=40
    wch: Math.min(40, Math.max(12, column.width / 8)),
  }));

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    makeSheetName(options.fileName, options.versionNumber)
  );
  // 执行完 → 浏览器触发下载excel文件
  XLSX.writeFile(
    workbook,
    makeFileName(options.fileName, options.versionNumber, "xlsx")
  );
}

// 渲染HTML
function createPdfPageContainer(
  options: VersionExportOptions,
  pageRows: VersionRow[],
  pageIndex: number,
  pageCount: number,
  total: number
): HTMLDivElement {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${Math.max(
    1200,
    options.columns.length * 160
  )}px`;
  container.style.padding = "20px";
  container.style.background = "#ffffff";
  container.style.color = "#222222";
  container.style.fontFamily =
    '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

  const title = document.createElement("h2");
  title.textContent = `${options.fileName} · v${options.versionNumber}`;
  title.style.margin = "0 0 6px";
  title.style.fontSize = "18px";
  title.style.fontWeight = "600";
  container.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.textContent = `第 ${pageIndex + 1} / ${pageCount} 页 · 共 ${total} 行`;
  subtitle.style.margin = "0 0 12px";
  subtitle.style.color = "#8a7355";
  subtitle.style.fontSize = "11px";
  container.appendChild(subtitle);

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "12px";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of options.columns) {
    appendCell(headerRow, column.label, "th");
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of pageRows) {
    const tr = document.createElement("tr");
    for (const column of options.columns) {
      appendCell(tr, cellValue(row, column), "td");
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  for (const cell of container.querySelectorAll("th, td")) {
    if (!(cell instanceof HTMLElement)) {
      continue;
    }
    cell.style.border = "1px solid #d9d2c5";
    cell.style.padding = "5px 7px";
    cell.style.textAlign = "left";
    cell.style.verticalAlign = "top";
    cell.style.wordBreak = "break-word";
  }
  for (const header of container.querySelectorAll("th")) {
    if (header instanceof HTMLElement) {
      header.style.background = "#f5f1e8";
      header.style.fontWeight = "600";
    }
  }

  return container;
}

// 流程：渲染HTML → 截图 → pdf.addImage塞进pdf的a4纸 → pdf.save触发浏览器下载pdf
export async function exportVersionPdf(
  options: VersionExportOptions
): Promise<void> {
  const rows = await fetchAllRows(options.versionId, options.onProgress);
  const total = rows.length;
  const pageCount = Math.max(
    1,
    Math.ceil(total / PDF_ROWS_PER_PAGE)
  );

  // LIGHT 懒加载，优化首屏加载速度
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  // #region 通过jsPDF获取contentWidth/contentHeight
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  //#endregion

  // 等待字体加载完毕，防乱码
  if (document.fonts) {
    await document.fonts.ready;
  }

  options.onStage?.("正在生成 PDF...");

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const start = pageIndex * PDF_ROWS_PER_PAGE;
    const pageRows = rows.slice(start, start + PDF_ROWS_PER_PAGE);
    const container = createPdfPageContainer(
      options,
      pageRows,
      pageIndex,
      pageCount,
      total
    );

    options.onStage?.(
      `正在生成第 ${pageIndex + 1} / ${pageCount} 页...`
    );

    document.body.appendChild(container);

    try {
      // 等两次rAF，确保DOM加载完毕
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve())
        );
      });

      // 截图转图片
      // 1.截图container
      const canvas = await html2canvas(container, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const image = canvas.toDataURL("image/jpeg", 0.92);

      // #region 接下来计算截图的宽高和位置
      // 2.等比例计算pdf图片的高度
      const imageHeight = (canvas.height * contentWidth) / canvas.width;
      let drawWidth = contentWidth;
      let drawHeight = imageHeight;

      // 3.图片太高A4塞不下 → 等比例缩小宽高
      if (drawHeight > contentHeight) {
        const factor = contentHeight / drawHeight;
        drawWidth *= factor;
        drawHeight = contentHeight;
      }

      // 4.x保证图片在A4纸上水平居中
      const x = margin + (contentWidth - drawWidth) / 2;
      //#endregion

      if (pageIndex > 0) {
        pdf.addPage();
      }

      pdf.addImage(
        image,
        "JPEG",
        x,
        margin,
        drawWidth,
        drawHeight
      );
    } finally {
      container.remove();
    }
  }

  // 触发浏览器下载PDF文件
  pdf.save(makeFileName(options.fileName, options.versionNumber, "pdf"));
}

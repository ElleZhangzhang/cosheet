import * as XLSX from 'xlsx'
import type { DataRow, ColumnDef, ParsedSheet } from '@/types/index'

type WorkerInMessage = {
  file: File
}

type WorkerOutMessage =
  | { ok: true; sheet: ParsedSheet }
  | { ok: false; message: string }

// 推断每列数据的类型
const inferColumnType = (key: string, data: any[]): ColumnDef['type'] => {
  const sampleSize = Math.min(100, data.length)
  const values = data.slice(0, sampleSize).map(row => row[key])
  const nonNull = values.filter(v => v != null)

  if (nonNull.length === 0) return 'string'

  const isNumber = nonNull.every(v =>
    typeof v === 'number' || !isNaN(Number(v))
  )
  if (isNumber) return 'number'

  const isDate = nonNull.every(v =>
    !isNaN(Date.parse(String(v)))
  )
  if (isDate) return 'date'

  return 'string'
}

// Web Worker入口：主线程一发消息，这里就开始执行解析流程
// 解析excel文件
self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  try {
    // 1. 拿到主线程传过来的数据
    const { file } = event.data

    // 2. 解析文件数据
    // #region
    const reader = new FileReaderSync()
    const binaryData = reader.readAsBinaryString(file)

    const workbook = XLSX.read(binaryData, { type: 'binary' })
    const sheetNames = workbook.SheetNames
    const firstSheetName = sheetNames[0]
    if (!firstSheetName) {
      throw new Error('文件中没有工作表')
    }

    const worksheet = workbook.Sheets[firstSheetName]
    if (!worksheet) {
      throw new Error('工作表内容为空')
    }

    const jsonData = XLSX.utils.sheet_to_json(worksheet)
    //#endregion

    if (jsonData.length === 0) {
      throw new Error('工作表没有数据行')
    }

    // 3. 根据解析好的数据创建 ParsedSheet（原来是dataset）
    // #region
    // 最后rows大概长这样：
    // [
    //   {
    //     "id": "row-0",
    //     "姓名": "张三",
    //     "年龄": 20,
    //     "城市": "北京"
    //   },
    //   {
    //     "id": "row-1",
    //     "姓名": "李四",
    //     "年龄": 22,
    //     "城市": "上海"
    //   }
    // ]
    const rows: DataRow[] = jsonData.map((row, index) => ({
      id: `row-${index}`,
      ...(row as Record<string, any>)
    }))

    const firstRow = jsonData[0] as object
    const columnKeys = Object.keys(firstRow)
    if (columnKeys.length === 0) {
      throw new Error('工作表没有可用列')
    }

    const columns: ColumnDef[] = columnKeys.map(column => ({
      keyName: column,
      label: column,
      type: inferColumnType(column, jsonData),
      width: 150
    }))

    const sheet: ParsedSheet = {
      name: file.name,
      rows,
      columns,
      rowCount: rows.length,
      columnCount: columns.length,
    }
    //#endregion

    // 4. 把结果 postMessage 回主线程
    const payload: WorkerOutMessage = { ok: true, sheet }
    self.postMessage(payload)
  } catch (error) {
    const payload: WorkerOutMessage = {
      ok: false,
      message: error instanceof Error ? error.message : '文件解析失败'
    }
    self.postMessage(payload)
  }
}

export { }

import type { ParsedSheet } from '@/types/index'

type WorkerOutMessage =
  | { ok: true; sheet: ParsedSheet }
  | { ok: false; message: string }

export function useFileParser() {
  const parseFile = async (file: File): Promise<ParsedSheet> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('@/workers/excel-parser.worker.ts', import.meta.url),
        { type: 'module' }
      )

      const cleanup = () => {
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
      }
      // 2. 接收worker返回的消息
      worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
        const payload = event.data

        if (!payload.ok) {
          cleanup()
          reject(new Error(payload.message || '文件解析失败'))
          return
        }

        cleanup()
        resolve(payload.sheet)
      }

      worker.onerror = () => {
        cleanup()
        reject(new Error('Worker 解析失败'))
      }
      // 1. 向worker发送file，让worker负责解析file
      worker.postMessage({ file })
    })
  }

  return { parseFile }
}

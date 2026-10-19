import { request } from "@/api/http";
import type { ColumnDef } from "@/types";
import type { CreateFileResponse, FilesResponse } from "@/types/api";

interface CreateFileInput {
  name: string;
  columns: ColumnDef[];
  rowCount: number;
}

function listFiles(
  workspaceId: string,
  q = ""
): Promise<FilesResponse> {
  const query = q.trim();
  // encodeURIComponent：
  // 1.把字符串中的特殊字符（& /=/#）转成编码，防止破坏url结构
  // 2.拼接URL参数时，凡是用户传的值，无脑套encodeURIComponent()
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";

  return request<FilesResponse>(
    `/workspaces/${workspaceId}/files${suffix}`
  );
}

function createFile(
  workspaceId: string,
  input: CreateFileInput
): Promise<CreateFileResponse> {
  return request<CreateFileResponse>(
    `/workspaces/${workspaceId}/files`,
    {
      method: "POST",
      body: input,
    }
  );
}

export { listFiles, createFile };

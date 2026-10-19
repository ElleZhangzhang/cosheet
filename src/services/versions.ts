import { request } from "@/api/http";
import type { DataRow } from "@/types";
import type {
  CompleteVersionResponse,
  UploadChunkResponse,
} from "@/types/api";

function uploadChunk(
  versionId: string,
  index: number,
  rows: DataRow[]
): Promise<UploadChunkResponse> {
  return request<UploadChunkResponse>(
    `/versions/${versionId}/chunks/${index}`,
    {
      method: "PUT",
      body: { rows },
    }
  );
}

function completeVersion(
  versionId: string,
  rowCount: number,
  chunkCount: number
): Promise<CompleteVersionResponse> {
  return request<CompleteVersionResponse>(
    `/versions/${versionId}/complete`,
    {
      method: "POST",
      body: { rowCount, chunkCount },
    }
  );
}

export { uploadChunk, completeVersion };

import { request } from "@/api/http";
import type { DataRow } from "@/types";
import type {
  CompleteVersionResponse,
  UploadChunkResponse,
  VersionChunksResponse,
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

function cancelVersion(versionId: string): Promise<null> {
  return request<null>(`/versions/${versionId}`, {
    method: "DELETE",
  });
}

function getVersionChunks(
  versionId: string
): Promise<VersionChunksResponse> {
  return request<VersionChunksResponse>(
    `/versions/${versionId}/chunks`
  );
}

export {
  uploadChunk,
  completeVersion,
  cancelVersion,
  getVersionChunks,
};

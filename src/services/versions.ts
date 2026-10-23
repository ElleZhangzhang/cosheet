import { request } from "@/api/http";
import type { DataRow } from "@/types";
import type {
  CompleteVersionResponse,
  UploadChunkResponse,
  VersionChunksResponse,
  VersionRowsQuery,
  VersionRowsResponse,
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

function getVersionRows(
  versionId: string,
  query: VersionRowsQuery = {}
): Promise<VersionRowsResponse> {
  const params = new URLSearchParams();

  if (query.offset !== undefined) {
    params.set("offset", String(query.offset));
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.q) {
    params.set("q", query.q);
  }
  if (query.sortBy) {
    params.set("sortBy", query.sortBy);
  }
  if (query.sortDir) {
    params.set("sortDir", query.sortDir);
  }

  const suffix = params.toString();

  return request<VersionRowsResponse>(
    `/versions/${versionId}/rows${suffix ? `?${suffix}` : ""}`
  );
}

export {
  uploadChunk,
  completeVersion,
  cancelVersion,
  getVersionChunks,
  getVersionRows,
};

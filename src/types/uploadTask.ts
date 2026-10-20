interface UploadTaskMeta {
  versionId: string;
  fileId: string;
  workspaceId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  rowCount: number;
  chunkCount: number;
  createdAt: number;
}

export type { UploadTaskMeta };

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { getFileDetail, listFileVersions } from "../services/files";
import { HttpError } from "../utils/httpError";

export const fileDetailRouter = Router();

function getUserId(userId: string | undefined): string {
  if (!userId) {
    throw new HttpError(401, "未登录");
  }

  return userId;
}

function getFileId(fileId: string | string[] | undefined): string {
  if (typeof fileId !== "string" || !fileId) {
    throw new HttpError(400, "缺少文件 ID");
  }

  return fileId;
}

// GET /api/files/:fileId/versions
// git log
fileDetailRouter.get(
  "/:fileId/versions",
  asyncHandler(async (req, res) => {
    const versions = await listFileVersions(
      getUserId(req.userId),
      getFileId(req.params.fileId)
    );

    res.json({ versions });
  })
);

// GET /api/files/:fileId
// git log + 文件基本信息 + 最新ready版本
fileDetailRouter.get(
  "/:fileId",
  asyncHandler(async (req, res) => {
    const detail = await getFileDetail(
      getUserId(req.userId),
      getFileId(req.params.fileId)
    );

    res.json(detail);
  })
);

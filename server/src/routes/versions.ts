import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { getVersionRows } from "../services/versionRows";
import {
  cancelVersion,
  completeVersion,
  listUploadedChunks,
  uploadChunk,
} from "../services/versions";
import { HttpError } from "../utils/httpError";
import { validateChunkInput, validateCompleteInput } from "../utils/validate";

export const versionsRouter = Router();

function getUserId(userId: string | undefined): string {
  if (!userId) {
    throw new HttpError(401, "未登录");
  }

  return userId;
}

function getVersionId(
  versionId: string | string[] | undefined
): string {
  if (typeof versionId !== "string" || !versionId) {
    throw new HttpError(400, "缺少版本 ID");
  }

  return versionId;
}

function getChunkIndex(
  value: string | string[] | undefined
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    throw new HttpError(400, "缺少分片索引");
  }

  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    throw new HttpError(400, "分片索引不合法");
  }

  return index;
}

// GET /api/versions/:versionId/chunks
versionsRouter.get(
  "/:versionId/chunks",
  asyncHandler(async (req, res) => {
    const result = await listUploadedChunks(
      getUserId(req.userId),
      getVersionId(req.params.versionId)
    );

    res.json(result);
  })
);

// GET /api/versions/:versionId/rows
versionsRouter.get(
  "/:versionId/rows",
  asyncHandler(async (req, res) => {
    const result = await getVersionRows(
      getUserId(req.userId),
      getVersionId(req.params.versionId),
      req.query as Record<string, unknown>
    );

    res.json(result);
  })
);

// PUT /api/versions/:versionId/chunks/:index
versionsRouter.put(
  "/:versionId/chunks/:index",
  asyncHandler(async (req, res) => {
    const { rows } = validateChunkInput(req.body);

    const chunk = await uploadChunk(
      getUserId(req.userId),
      getVersionId(req.params.versionId),
      getChunkIndex(req.params.index),
      rows
    );

    res.json({ chunk });
  })
);

// POST /api/versions/:versionId/complete
versionsRouter.post(
  "/:versionId/complete",
  asyncHandler(async (req, res) => {
    const input = validateCompleteInput(req.body);

    const result = await completeVersion(
      getUserId(req.userId),
      getVersionId(req.params.versionId),
      input
    );

    res.json(result);
  })
);

// DELETE /api/versions/:versionId
versionsRouter.delete(
  "/:versionId",
  asyncHandler(async (req, res) => {
    await cancelVersion(
      getUserId(req.userId),
      getVersionId(req.params.versionId)
    );

    res.status(204).send();
  })
);

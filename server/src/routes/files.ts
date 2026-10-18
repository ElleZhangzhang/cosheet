import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { createFileWithVersion, listFiles } from "../services/files";
import { HttpError } from "../utils/httpError";
import { validateCreateFileInput } from "../utils/validate";

export const filesRouter = Router({ mergeParams: true });

function getUserId(userId: string | undefined): string {
  if (!userId) {
    throw new HttpError(401, "未登录");
  }

  return userId;
}

function getWorkspaceId(
  workspaceId: string | string[] | undefined
): string {
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpError(400, "缺少工作空间 ID");
  }

  return workspaceId;
}

// GET /api/workspaces/:workspaceId/files
filesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q =
      typeof req.query.q === "string"
        ? req.query.q.trim().slice(0, 100)
        : "";

    const files = await listFiles(
      getUserId(req.userId),
      getWorkspaceId(req.params.workspaceId),
      q
    );

    res.json({ files });
  })
);

// POST /api/workspaces/:workspaceId/files
filesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = validateCreateFileInput(req.body); // {name,columns数组对象,rowCount}

    const result = await createFileWithVersion(
      getUserId(req.userId),
      getWorkspaceId(req.params.workspaceId),
      input
    );

    res.status(201).json(result);
  })
);

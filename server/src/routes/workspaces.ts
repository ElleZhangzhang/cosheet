import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { createWorkspace, listWorkspaces } from "../services/workspaces";
import { HttpError } from "../utils/httpError";
import { validateCreateWorkspaceInput } from "../utils/validate";

export const workspacesRouter = Router();

function getUserId(userId: string | undefined): string {
  if (!userId) {
    throw new HttpError(401, "未登录");
  }

  return userId;
}

// GET /api/workspaces：当前用户参与的工作空间
workspacesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const workspaces = await listWorkspaces(getUserId(req.userId));

    res.json({ workspaces });
  })
);

// POST /api/workspaces：创建新工作空间，创建者为 owner
workspacesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name } = validateCreateWorkspaceInput(req.body);
    // req.userId是前面的中间件校验用户过后挂上去的
    const workspace = await createWorkspace(getUserId(req.userId), name);

    res.status(201).json({ workspace });
  })
);

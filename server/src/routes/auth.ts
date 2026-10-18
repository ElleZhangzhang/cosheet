import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authRequired } from "../middleware/auth";
import { getUserById, loginUser, registerUser } from "../services/auth";
import { HttpError } from "../utils/httpError";
import { signToken } from "../utils/jwt";
import { validateLoginInput, validateRegisterInput } from "../utils/validate";

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { email, password, name } = validateRegisterInput(req.body);
    const user = await registerUser(email, password, name);

    res.status(201).json({ token: signToken(user), user });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = validateLoginInput(req.body);
    const user = await loginUser(email, password);

    res.json({ token: signToken(user), user });
  })
);

authRouter.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw new HttpError(401, "未登录");
    }

    const user = await getUserById(req.userId);
    res.json({ user });
  })
);

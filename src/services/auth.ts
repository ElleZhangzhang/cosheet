import { request } from "@/api/http";
import type {
  AuthResponse,
  LoginInput,
  MeResponse,
  RegisterInput,
} from "@/types/api";

function register(input: RegisterInput): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: input,
    auth: false,
  });
}

function login(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
}

function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>("/auth/me");
}

export { register, login, fetchMe };

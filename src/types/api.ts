interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

interface MeResponse {
  user: User;
}

interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface ApiErrorBody {
  statusCode: number;
  message: string;
}

export type {
  User,
  AuthResponse,
  MeResponse,
  RegisterInput,
  LoginInput,
  ApiErrorBody,
};

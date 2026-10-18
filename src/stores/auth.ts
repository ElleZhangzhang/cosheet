import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  fetchMe,
  login as loginRequest,
  register as registerRequest,
} from "@/services/auth";
import { clearToken, getToken, setToken } from "@/utils/tokenStorage";
import type { User } from "@/types/api";

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(getToken());
  const user = ref<User | null>(null);
  const isReady = ref(false);

  const isAuthenticated = computed(() => Boolean(token.value && user.value));

  function applyAuth(nextToken: string, nextUser: User): void {
    token.value = nextToken;
    user.value = nextUser;
    setToken(nextToken);
  }

  async function login(email: string, password: string): Promise<void> {
    const data = await loginRequest({ email, password });
    applyAuth(data.token, data.user);
  }

  async function register(
    name: string,
    email: string,
    password: string
  ): Promise<void> {
    await registerRequest({ name, email, password });
  }

  function logout(): void {
    token.value = null;
    user.value = null;
    clearToken();
  }

  async function initialize(): Promise<void> {
    if (isReady.value) {
      return;
    }

    if (!token.value) {
      isReady.value = true;
      return;
    }

    try {
      const data = await fetchMe();
      user.value = data.user;
    } catch {
      logout();
    } finally {
      isReady.value = true;
    }
  }

  return {
    token,
    user,
    isReady,
    isAuthenticated,
    login,
    register,
    logout,
    initialize,
  };
});

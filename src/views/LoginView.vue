<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/api/http";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const isRegister = computed(() => route.path === "/register");
const successMessage = computed(() =>
  route.query.registered === "1" ? "注册成功，请登录" : ""
);

const initialEmail = route.query.email;
const name = ref("");
const email = ref(typeof initialEmail === "string" ? initialEmail : "");
const password = ref("");
const error = ref("");
const submitting = ref(false);

function switchMode(): void {
  error.value = "";
  router.push({
    path: isRegister.value ? "/login" : "/register",
    query: { redirect: route.query.redirect },
  });
}

// 登录成功后跳转：优先使用路由守卫带来的 redirect
function getRedirectTarget(): string {
  // 从当前页面的url参数拿到redirect（路由守卫那里拼的）
  // http://localhost:5173/login?redirect=/workspaces/123
  const redirect = route.query.redirect;

  // 直接访问受保护页面 → index.ts路由守卫挂redirect并重定向至登录页 → 登录成功后调用getRedirectTarget → 执行if语句跳到redirect → 进入受保护页面
  if (
    typeof redirect === "string" &&
    redirect.startsWith("/") &&
    !redirect.startsWith("//")
  ) {
    return redirect;
  }

  // 直接从登录页进入 → 登录成功后调用getRedirectTarget → 执行return '/workspaces'进入工作页
  return "/workspaces";
}

async function handleSubmit(): Promise<void> {
  error.value = "";
  submitting.value = true;

  try {
    if (isRegister.value) {
      await auth.register(
        name.value.trim(),
        email.value.trim(),
        password.value
      );

      const redirect = route.query.redirect;
      await router.replace({
        path: "/login",
        query: {
          registered: "1",
          email: email.value.trim(),
          ...(typeof redirect === "string" ? { redirect } : {}),
        },
      });
      return;
    }

    await auth.login(email.value.trim(), password.value);

    // getRedirectTarget() → .replace(target) → beforeEach
    await router.replace(getRedirectTarget());
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err.message;
    } else {
      error.value = "网络错误，请稍后重试";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="brand">Co<span>Sheet</span></div>
      <h1>{{ isRegister ? "创建账号" : "欢迎回来" }}</h1>
      <p class="subtitle">
        {{
          isRegister
            ? "注册后会自动创建你的个人工作空间"
            : "登录后继续管理你的数据"
        }}
      </p>

      <p v-if="successMessage" class="success">{{ successMessage }}</p>

      <!-- KNOW 阻止表单submit的默认行为：
      1.默认行为：把表单数据拼成url参数（GET）/请求体（POST），并向服务器发送请求
      2.阻止原因：防止onSubmit逻辑没处理完就刷新页面 -->
      <form @submit.prevent="handleSubmit">
        <label v-if="isRegister" class="field">
          <span>姓名</span>
          <input
            v-model="name"
            type="text"
            required
            maxlength="100"
            autocomplete="name"
            placeholder="你的名字"
          />
        </label>

        <label class="field">
          <span>邮箱</span>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="name@example.com"
          />
        </label>

        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            required
            :minlength="isRegister ? 8 : undefined"
            :autocomplete="isRegister ? 'new-password' : 'current-password'"
            :placeholder="isRegister ? '至少 8 位' : '输入密码'"
          />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="submit-btn" :disabled="submitting">
          {{ submitting ? "请稍候..." : isRegister ? "注册" : "登录" }}
        </button>
      </form>

      <button type="button" class="switch-btn" @click="switchMode">
        {{ isRegister ? "已有账号？去登录" : "没有账号？去注册" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: radial-gradient(
      circle at 80% 10%,
      rgba(218, 165, 32, 0.12),
      transparent 40%
    ),
    #f9f6f1;
  color: #333;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.auth-card {
  width: 100%;
  max-width: 420px;
  padding: 40px;
  background: #fff;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(191, 161, 117, 0.12);
}

.brand {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.5px;
  text-transform: uppercase;
}

.brand span {
  color: #bfa175;
}

h1 {
  margin: 28px 0 8px;
  font-size: 26px;
  font-weight: 600;
}

.subtitle {
  margin: 0 0 28px;
  color: #888;
  font-size: 14px;
  line-height: 1.6;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
  font-size: 13px;
  font-weight: 600;
  color: #555;
}

.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border: 1px solid #e6e0d8;
  border-radius: 8px;
  background: #fffdf9;
  color: #333;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.field input:focus {
  border-color: #bfa175;
  box-shadow: 0 0 0 3px rgba(191, 161, 117, 0.12);
}

.error {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid rgba(245, 108, 108, 0.25);
  border-radius: 8px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 13px;
}

.success {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid rgba(103, 194, 58, 0.25);
  border-radius: 8px;
  background: #f0f9eb;
  color: #67c23a;
  font-size: 13px;
}

.submit-btn {
  width: 100%;
  padding: 13px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #bfa175 0%, #d8b08a 100%);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(191, 161, 117, 0.25);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.switch-btn {
  display: block;
  width: 100%;
  margin-top: 18px;
  padding: 4px;
  border: none;
  background: transparent;
  color: #bfa175;
  font-size: 13px;
  cursor: pointer;
}

.switch-btn:hover {
  text-decoration: underline;
}
</style>

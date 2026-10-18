<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const auth = useAuthStore();

function handleLogout(): void {
  auth.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="workspace-page">
    <header class="workspace-header">
      <div class="brand">Co<span>Sheet</span></div>
      <div class="user-area">
        <div class="user-text">
          <span class="user-name">{{ auth.user?.name }}</span>
          <span class="user-email">{{ auth.user?.email }}</span>
        </div>
        <button class="logout-btn" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <main class="workspace-main">
      <h1>工作空间</h1>
      <p>工作空间列表和基础布局将在下一格实现。</p>
    </main>
  </div>
</template>

<style scoped>
.workspace-page {
  min-height: 100vh;
  background: #f9f6f1;
  color: #333;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 32px;
  background: #fff;
  border-bottom: 1px solid rgba(191, 161, 117, 0.15);
}

.brand {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.5px;
  text-transform: uppercase;
}

.brand span {
  color: #bfa175;
}

.user-area {
  display: flex;
  align-items: center;
  gap: 16px;
}

.user-text {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
}

.user-email {
  font-size: 12px;
  color: #888;
}

.logout-btn {
  padding: 8px 14px;
  border: 1px solid rgba(191, 161, 117, 0.3);
  border-radius: 8px;
  background: transparent;
  color: #8a7355;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.logout-btn:hover {
  background: rgba(191, 161, 117, 0.08);
}

.workspace-main {
  max-width: 960px;
  margin: 0 auto;
  padding: 64px 32px;
}

.workspace-main h1 {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 600;
}

.workspace-main p {
  margin: 0;
  color: #888;
  font-size: 14px;
}
</style>

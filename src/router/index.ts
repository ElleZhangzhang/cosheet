import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import LoginView from "@/views/LoginView.vue";

// LIGHT 路由懒加载
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: LoginView,
    },
    {
      path: "/register",
      name: "register",
      component: LoginView,
    },
    {
      path: "/workspaces",
      name: "workspaces",
      component: () => import("@/views/WorkspaceView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/workspaces/:workspaceId",
      name: "workspace",
      component: () => import("@/views/WorkspaceView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/files/:fileId",
      name: "file",
      component: () => import("@/views/FileView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/",
      redirect: "/workspaces",
    },
  ],
});

// KNOW
// 路由守卫：拦截页面跳转。工作于前端
// 请求/响应拦截器：拦截网络请求。工作于网络层

// to是router内定义的route对象
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.initialize();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return {
      name: "login",
      query: { redirect: to.fullPath },
    };
  }

  if ((to.name === "login" || to.name === "register") && auth.isAuthenticated) {
    return { name: "workspaces" };
  }

  // 返回值：
  // true 正常放行
  // return {} 重定向至name
  // false 不跳转
  return true;
});

export default router;

import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/accounts" },
    {
      path: "/accounts",
      name: "accounts",
      component: () => import("@/views/AccountsView.vue"),
      meta: { title: "账号管理" },
    },
    {
      path: "/aggregate-api",
      name: "aggregate-api",
      component: () => import("@/views/AggregateApiView.vue"),
      meta: { title: "聚合API" },
    },
    {
      path: "/apikeys",
      name: "apikeys",
      component: () => import("@/views/ApiKeysView.vue"),
      meta: { title: "平台密钥" },
    },
    {
      path: "/models",
      name: "models",
      component: () => import("@/views/ModelsView.vue"),
      meta: { title: "模型管理" },
    },
    {
      path: "/logs",
      name: "logs",
      component: () => import("@/views/LogsView.vue"),
      meta: { title: "请求日志" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/SettingsView.vue"),
      meta: { title: "设置" },
    },
  ],
});

import {
  Connection,
  DataAnalysis,
  Document,
  Key,
  Setting,
  User,
} from "@element-plus/icons-vue";

export const sidebarMenus = [
  { path: "/accounts", label: "账号管理", icon: User },
  { path: "/aggregate-api", label: "聚合API", icon: DataAnalysis },
  { path: "/apikeys", label: "平台密钥", icon: Key },
  { path: "/models", label: "模型管理", icon: Connection },
  { path: "/logs", label: "请求日志", icon: Document },
  { path: "/settings", label: "设置", icon: Setting },
];

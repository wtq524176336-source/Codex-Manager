import {
  Connection,
  DataAnalysis,
  Document,
  Key,
  MagicStick,
  Monitor,
  Setting,
  User,
} from "@element-plus/icons-vue";

export const sidebarMenus = [
  { path: "/accounts", label: "账号管理", icon: User },
  { path: "/aggregate-api", label: "聚合API", icon: DataAnalysis },
  { path: "/apikeys", label: "平台密钥", icon: Key },
  { path: "/models", label: "模型管理", icon: Connection },
  { path: "/logs", label: "请求日志", icon: Document },
  { path: "/plugins", label: "插件管理", icon: MagicStick },
  { path: "/author", label: "赞助推荐", icon: Monitor },
  { path: "/settings", label: "设置", icon: Setting },
];

import { invoke, withAddr } from "@/api/transport";
import type {
  InstalledPluginSummary,
  PluginCatalogEntry,
  PluginRunLogSummary,
  PluginTaskSummary,
} from "@/types/common";

export function listPluginCatalog(refresh = false) {
  return invoke<PluginCatalogEntry[]>(
    refresh ? "service_plugin_catalog_refresh" : "service_plugin_catalog_list",
    withAddr(),
  );
}

export function listInstalledPlugins() {
  return invoke<InstalledPluginSummary[]>("service_plugin_list", withAddr());
}

export function installPlugin(pluginId: string) {
  return invoke("service_plugin_install", withAddr({ pluginId }));
}

export function updatePlugin(pluginId: string) {
  return invoke("service_plugin_update", withAddr({ pluginId }));
}

export function uninstallPlugin(pluginId: string) {
  return invoke("service_plugin_uninstall", withAddr({ pluginId }));
}

export function enablePlugin(pluginId: string, enabled: boolean) {
  return invoke(enabled ? "service_plugin_enable" : "service_plugin_disable", withAddr({ pluginId }));
}

export function listPluginTasks(pluginId?: string) {
  return invoke<PluginTaskSummary[]>("service_plugin_tasks_list", withAddr({ pluginId: pluginId || null }));
}

export function updatePluginTask(taskId: string, params: { enabled?: boolean }) {
  return invoke("service_plugin_tasks_update", withAddr({ taskId, ...params }));
}

export function runPluginTask(taskId: string) {
  return invoke("service_plugin_tasks_run", withAddr({ taskId }));
}

export function listPluginRunLogs(params: { pluginId?: string; taskId?: string; limit?: number } = {}) {
  return invoke<PluginRunLogSummary[]>(
    "service_plugin_logs_list",
    withAddr({
      pluginId: params.pluginId || null,
      taskId: params.taskId || null,
      limit: params.limit || 50,
    }),
  );
}

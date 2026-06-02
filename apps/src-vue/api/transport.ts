import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

import { http } from "@/api/http";

type Params = Record<string, unknown>;
type WebCommandDescriptor = {
  rpcMethod?: string;
  mapParams?: (params?: Params) => Params;
  direct?: (params?: Params) => Promise<unknown>;
};

const DEFAULT_SERVICE_ADDR = "localhost:48760";
const MAX_IMPORT_RPC_BODY_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ERROR_ITEMS = 50;
let runtimeServiceAddr: string | null = null;

function toAppError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.trim()) {
    return new Error(error);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("请求失败");
  }
}

function isCommandMissingError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    (message.includes("command") && message.includes("not found")) ||
    message.includes("unknown command") ||
    message.includes("未找到命令")
  );
}

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export function setServiceAddr(addr: string | null | undefined) {
  const normalized = typeof addr === "string" ? addr.trim() : "";
  runtimeServiceAddr = normalized || null;
  if (runtimeServiceAddr) {
    localStorage.setItem("codexmanager-service-addr", runtimeServiceAddr);
  }
}

function readServiceAddr(): string | null {
  if (runtimeServiceAddr) {
    return runtimeServiceAddr;
  }

  try {
    const storedAddr = localStorage.getItem("codexmanager-service-addr");
    if (storedAddr?.trim()) {
      runtimeServiceAddr = storedAddr.trim();
      return runtimeServiceAddr;
    }

    const rawSettings = localStorage.getItem("codexmanager-settings");
    if (!rawSettings) {
      return null;
    }
    const settings = JSON.parse(rawSettings) as Record<string, unknown>;
    return typeof settings.serviceAddr === "string" && settings.serviceAddr.trim()
      ? settings.serviceAddr
      : null;
  } catch {
    return null;
  }
}

export function withAddr(params: Params = {}): Params {
  return {
    addr: readServiceAddr() || DEFAULT_SERVICE_ADDR,
    ...params,
  };
}

function unwrapRpcPayload<T>(payload: unknown): T {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (obj.error) {
      throw new Error(readErrorMessage(obj.error));
    }
    if ("data" in obj) {
      throwIfBusinessError(obj.data);
      return obj.data as T;
    }
    if ("result" in obj) {
      throwIfBusinessError(obj.result);
      return obj.result as T;
    }
  }
  throwIfBusinessError(payload);
  return payload as T;
}

function asRecord(value: unknown): Params | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Params)
    : null;
}

function readErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  const source = asRecord(error);
  if (source) {
    const message = source.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const data = source.data;
    if (typeof data === "string" && data.trim()) {
      return data;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "请求失败";
  }
}

function readBusinessErrorMessage(payload: unknown): string {
  const source = asRecord(payload);
  if (!source) return "";
  if (source.ok === false) {
    return source.error ? readErrorMessage(source.error) : "操作失败";
  }
  return source.error ? readErrorMessage(source.error) : "";
}

function throwIfBusinessError(payload: unknown): void {
  const message = readBusinessErrorMessage(payload);
  if (message) {
    throw new Error(message);
  }
}

function mapKeyIdToId(params?: Params): Params {
  const source = params ?? {};
  const keyId =
    typeof source.keyId === "string" && source.keyId.trim()
      ? source.keyId.trim()
      : "";
  return keyId ? { ...source, id: keyId } : source;
}

function importResultShell() {
  return {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [] as Array<{ index?: number; message?: string }>,
  };
}

function importNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function estimateImportRequestBytes(contents: string[]): number {
  return new TextEncoder().encode(JSON.stringify({ contents })).length;
}

function splitImportContents(contents: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const content of contents) {
    const next = current.concat(content);
    if (current.length > 0 && estimateImportRequestBytes(next) > MAX_IMPORT_RPC_BODY_BYTES) {
      chunks.push(current);
      current = [content];
      if (estimateImportRequestBytes(current) > MAX_IMPORT_RPC_BODY_BYTES) {
        throw new Error("单条导入内容过大，请拆分后重试");
      }
      continue;
    }
    current = next;
  }

  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

function mergeImportResult(target: ReturnType<typeof importResultShell>, payload: unknown, indexOffset: number) {
  const source = asRecord(payload) ?? {};
  target.total += importNumber(source.total);
  target.created += importNumber(source.created);
  target.updated += importNumber(source.updated);
  target.failed += importNumber(source.failed);

  const errors = Array.isArray(source.errors) ? source.errors : [];
  for (const error of errors) {
    if (target.errors.length >= MAX_IMPORT_ERROR_ITEMS) {
      break;
    }
    const item = asRecord(error) ?? {};
    target.errors.push({
      index: importNumber(item.index) + indexOffset,
      message: typeof item.message === "string" ? item.message : "",
    });
  }
}

function isSupportedBrowserImportFile(file: File): boolean {
  const name = String(file.name || "").trim().toLowerCase();
  return name.endsWith(".json") || name.endsWith(".txt");
}

async function pickImportFilesFromBrowser(directory: boolean): Promise<Params> {
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持浏览器文件选择");
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.txt,application/json,text/plain";
  input.multiple = true;
  if (directory) {
    const directoryInput = input as HTMLInputElement & {
      directory?: boolean;
      webkitdirectory?: boolean;
    };
    directoryInput.directory = true;
    directoryInput.webkitdirectory = true;
  }
  input.style.display = "none";
  document.body.appendChild(input);

  return await new Promise<Params>((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel as EventListener);
      input.remove();
    };

    const finish = (value: Params) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(value);
    };

    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };

    const handleCancel = () => {
      finish({ ok: true, canceled: true });
    };

    const handleChange = async () => {
      try {
        const files = Array.from(input.files ?? []);
        if (!files.length) {
          handleCancel();
          return;
        }

        const importableFiles = files.filter(isSupportedBrowserImportFile);
        if (!importableFiles.length) {
          fail(
            new Error(
              directory
                ? "所选目录中没有可导入的 .json 或 .txt 文件"
                : "请选择 .json 或 .txt 文件",
            ),
          );
          return;
        }

        const fileEntries = await Promise.all(
          importableFiles.map(async (file) => ({
            content: await file.text(),
            path:
              (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
              file.name,
          })),
        );
        const nonEmptyEntries = fileEntries.filter((entry) => entry.content.trim());
        if (!nonEmptyEntries.length) {
          fail(new Error("未在所选文件中找到可导入内容"));
          return;
        }

        const filePaths = nonEmptyEntries.map((entry) => entry.path);
        const directorySourcePath = filePaths[0] || "";
        finish({
          ok: true,
          canceled: false,
          directoryPath: directory
            ? directorySourcePath.split("/")[0] || directorySourcePath.split("\\")[0] || ""
            : "",
          fileCount: importableFiles.length,
          filePaths,
          contents: nonEmptyEntries.map((entry) => entry.content),
        });
      } catch (error) {
        fail(error);
      }
    };

    input.addEventListener("change", handleChange);
    input.addEventListener("cancel", handleCancel as EventListener);
    input.click();
  });
}

async function importAccountContentsViaWeb(contents: string[]): Promise<Params> {
  const batches = splitImportContents(contents);
  if (!batches.length) {
    return importResultShell();
  }

  const merged = importResultShell();
  let processed = 0;
  for (const batch of batches) {
    const result = await postJsonRpc<unknown>("account/import", { contents: batch });
    mergeImportResult(merged, result, processed);
    processed += batch.length;
  }
  return merged;
}

async function importPickedAccountsFromBrowser(directory: boolean): Promise<unknown> {
  const picked = await pickImportFilesFromBrowser(directory);
  if (picked.canceled || !Array.isArray(picked.contents) || !picked.contents.length) {
    return picked;
  }

  const imported = await importAccountContentsViaWeb(
    picked.contents.map((item) => String(item || "")),
  );
  return {
    ...imported,
    canceled: false,
    directoryPath: picked.directoryPath || "",
    fileCount: picked.fileCount || picked.contents.length,
    filePaths: picked.filePaths,
  };
}

async function exportAccountsViaBrowser(params?: Params): Promise<unknown> {
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持浏览器导出");
  }

  const selectedAccountIds = Array.isArray(params?.selectedAccountIds)
    ? params.selectedAccountIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const exportMode =
    typeof params?.exportMode === "string" && params.exportMode.trim()
      ? params.exportMode.trim()
      : "multiple";
  const payload = asRecord(
    await postJsonRpc<unknown>("account/exportData", {
      selectedAccountIds,
      exportMode,
    }),
  ) ?? {};
  const files = Array.isArray(payload.files)
    ? payload.files
        .map((item) => asRecord(item))
        .filter((item): item is Params => item !== null)
    : [];

  for (const item of files) {
    const fileName =
      typeof item.fileName === "string" && item.fileName.trim()
        ? item.fileName.trim()
        : "account.json";
    const content = typeof item.content === "string" ? item.content : "";
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return {
    ok: true,
    canceled: false,
    exported: typeof payload.exported === "number" ? payload.exported : files.length,
    outputDir: "browser-download",
  };
}

const WEB_COMMAND_MAP: Record<string, WebCommandDescriptor> = {
  app_settings_get: { rpcMethod: "appSettings/get" },
  app_settings_set: {
    rpcMethod: "appSettings/set",
    mapParams: (params) => asRecord(asRecord(params)?.patch) ?? {},
  },
  service_initialize: { rpcMethod: "initialize" },
  service_account_list: { rpcMethod: "account/list" },
  service_account_delete: { rpcMethod: "account/delete" },
  service_account_delete_many: { rpcMethod: "account/deleteMany" },
  service_account_delete_by_statuses: { rpcMethod: "account/deleteByStatuses" },
  service_account_delete_unavailable_free: { rpcMethod: "account/deleteUnavailableFree" },
  service_account_update: { rpcMethod: "account/update" },
  service_account_import: { rpcMethod: "account/import" },
  service_account_import_by_file: { direct: () => importPickedAccountsFromBrowser(false) },
  service_account_import_by_directory: { direct: () => importPickedAccountsFromBrowser(true) },
  service_account_export_by_account_files: { direct: exportAccountsViaBrowser },
  service_account_warmup: { rpcMethod: "account/warmup" },
  service_usage_read: { rpcMethod: "account/usage/read" },
  service_usage_list: { rpcMethod: "account/usage/list" },
  service_usage_refresh: { rpcMethod: "account/usage/refresh" },
  service_usage_aggregate: { rpcMethod: "account/usage/aggregate" },
  service_login_start: {
    rpcMethod: "account/login/start",
    mapParams: (params) => ({
      ...(params ?? {}),
      type:
        typeof params?.loginType === "string" && params.loginType.trim()
          ? params.loginType
          : "chatgpt",
      openBrowser: false,
    }),
  },
  service_login_status: { rpcMethod: "account/login/status" },
  service_login_complete: { rpcMethod: "account/login/complete" },
  service_login_chatgpt_auth_tokens: {
    rpcMethod: "account/login/start",
    mapParams: (params) => ({ ...(params ?? {}), type: "chatgptAuthTokens" }),
  },
  service_chatgpt_auth_tokens_refresh: {
    rpcMethod: "account/chatgptAuthTokens/refresh",
  },
  service_chatgpt_auth_tokens_refresh_all: {
    rpcMethod: "account/chatgptAuthTokens/refreshAll",
  },
  service_aggregate_api_list: { rpcMethod: "aggregateApi/list" },
  service_aggregate_api_create: { rpcMethod: "aggregateApi/create" },
  service_aggregate_api_update: { rpcMethod: "aggregateApi/update" },
  service_aggregate_api_delete: { rpcMethod: "aggregateApi/delete" },
  service_aggregate_api_reset_usage: { rpcMethod: "aggregateApi/resetUsage" },
  service_aggregate_api_read_secret: { rpcMethod: "aggregateApi/readSecret" },
  service_aggregate_api_test_connection: { rpcMethod: "aggregateApi/testConnection" },
  service_apikey_list: { rpcMethod: "apikey/list" },
  service_apikey_create: { rpcMethod: "apikey/create" },
  service_apikey_usage_stats: { rpcMethod: "apikey/usageStats" },
  service_apikey_delete: { rpcMethod: "apikey/delete", mapParams: mapKeyIdToId },
  service_apikey_update_model: { rpcMethod: "apikey/updateModel", mapParams: mapKeyIdToId },
  service_apikey_disable: { rpcMethod: "apikey/disable", mapParams: mapKeyIdToId },
  service_apikey_enable: { rpcMethod: "apikey/enable", mapParams: mapKeyIdToId },
  service_apikey_models: { rpcMethod: "apikey/models" },
  service_apikey_read_secret: { rpcMethod: "apikey/readSecret", mapParams: mapKeyIdToId },
  service_model_catalog_list: { rpcMethod: "apikey/modelCatalogList" },
  service_model_catalog_save: {
    rpcMethod: "apikey/modelCatalogSave",
    mapParams: (params) => asRecord(asRecord(params)?.payload) ?? {},
  },
  service_model_catalog_delete: { rpcMethod: "apikey/modelCatalogDelete" },
  service_gateway_transport_get: { rpcMethod: "gateway/transport/get" },
  service_gateway_transport_set: { rpcMethod: "gateway/transport/set" },
  service_gateway_upstream_proxy_get: { rpcMethod: "gateway/upstreamProxy/get" },
  service_gateway_upstream_proxy_set: { rpcMethod: "gateway/upstreamProxy/set" },
  service_gateway_route_strategy_get: { rpcMethod: "gateway/routeStrategy/get" },
  service_gateway_route_strategy_set: { rpcMethod: "gateway/routeStrategy/set" },
  service_gateway_background_tasks_get: { rpcMethod: "gateway/backgroundTasks/get" },
  service_gateway_background_tasks_set: { rpcMethod: "gateway/backgroundTasks/set" },
  service_gateway_concurrency_recommend_get: {
    rpcMethod: "gateway/concurrencyRecommendation/get",
  },
  service_listen_config_get: { rpcMethod: "service/listenConfig/get" },
  service_listen_config_set: { rpcMethod: "service/listenConfig/set" },
  service_requestlog_list: { rpcMethod: "requestlog/list" },
  service_requestlog_summary: { rpcMethod: "requestlog/summary" },
  service_requestlog_today_summary: { rpcMethod: "requestlog/today_summary" },
  service_requestlog_clear: { rpcMethod: "requestlog/clear" },
  service_requestlog_error_list: { rpcMethod: "requestlog/error_list" },
  service_requestlog_error_clear: { rpcMethod: "requestlog/error_clear" },
  open_in_browser: {
    direct: async (params) => {
      const url = typeof params?.url === "string" ? params.url.trim() : "";
      if (!url) {
        throw new Error("缺少浏览器跳转地址");
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true };
    },
  },
  app_update_open_logs_dir: {
    direct: async () => {
      throw new Error("当前环境不支持打开更新日志目录");
    },
  },
};

async function postJsonRpc<T>(method: string, params: Params = {}): Promise<T> {
  const response = await http.post("/api/rpc", {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  });
  return unwrapRpcPayload<T>(response.data);
}

async function invokeWebRpc<T>(method: string, params: Params = {}): Promise<T> {
  const descriptor = WEB_COMMAND_MAP[method];
  if (!descriptor) {
    throw new Error("当前 Web / Docker 版暂不支持该操作");
  }
  if (descriptor.direct) {
    return (await descriptor.direct(params)) as T;
  }
  if (!descriptor.rpcMethod) {
    throw new Error("当前 Web / Docker 版暂不支持该操作");
  }
  return postJsonRpc<T>(
    descriptor.rpcMethod,
    descriptor.mapParams ? descriptor.mapParams(params) : params,
  );
}

export async function invoke<T>(method: string, params: Params = {}): Promise<T> {
  try {
    if (isTauri()) {
      const payload = await tauriInvoke(method, params);
      return unwrapRpcPayload<T>(payload);
    }
    return invokeWebRpc<T>(method, params);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function invokeFirst<T>(methods: string[], params: Params = {}): Promise<T> {
  let firstMissingError: Error | null = null;
  for (const method of methods) {
    try {
      return await invoke<T>(method, params);
    } catch (error) {
      const appError = toAppError(error);
      if (isCommandMissingError(appError)) {
        firstMissingError ||= appError;
        continue;
      }
      throw appError;
    }
  }
  throw firstMissingError || new Error("未配置可用命令");
}

import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

import { http } from "@/api/http";

type Params = Record<string, unknown>;

const DEFAULT_SERVICE_ADDR = "localhost:48760";
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
      throw new Error(String(obj.error));
    }
    if ("data" in obj) {
      return obj.data as T;
    }
    if ("result" in obj) {
      return obj.result as T;
    }
  }
  return payload as T;
}

async function postJsonRpc<T>(method: string, params: Params = {}): Promise<T> {
  const response = await http.post("/api/rpc", {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  });
  return unwrapRpcPayload<T>(response.data);
}

export async function invoke<T>(method: string, params: Params = {}): Promise<T> {
  try {
    if (isTauri()) {
      const payload = await tauriInvoke(method, params);
      return unwrapRpcPayload<T>(payload);
    }
    return postJsonRpc<T>(method, params);
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

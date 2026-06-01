import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

import { http } from "@/api/http";

type Params = Record<string, unknown>;

function readServiceAddr(): string | null {
  try {
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
    addr: readServiceAddr(),
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
  if (isTauri()) {
    const payload = await tauriInvoke(method, params);
    return unwrapRpcPayload<T>(payload);
  }
  return postJsonRpc<T>(method, params);
}

export async function invokeFirst<T>(methods: string[], params: Params = {}): Promise<T> {
  let lastError: unknown;
  for (const method of methods) {
    try {
      return await invoke<T>(method, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("未配置可用命令");
}

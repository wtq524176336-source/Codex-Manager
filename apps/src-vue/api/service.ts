import { invoke, isDesktopRuntime, setServiceAddr, withAddr } from "@/api/transport";
import { readSettings } from "@/api/settings";

const DEFAULT_SERVICE_ADDR = "localhost:48760";

export interface ServiceBootstrapResult {
  addr: string;
  settings: Record<string, unknown>;
}

function readServiceAddrFromSettings(settings: Record<string, unknown>): string {
  const value = settings.serviceAddr;
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SERVICE_ADDR;
}

export async function bootstrapService(): Promise<ServiceBootstrapResult> {
  if (!isDesktopRuntime()) {
    setServiceAddr(DEFAULT_SERVICE_ADDR);
    return { addr: DEFAULT_SERVICE_ADDR, settings: {} };
  }

  const settings = await readSettings();
  const addr = readServiceAddrFromSettings(settings);
  setServiceAddr(addr);

  await invoke("service_start", { addr });
  await invoke("service_initialize", withAddr());

  return { addr, settings };
}

import { invoke, withAddr } from "@/api/transport";
import { normalizeAccountList } from "@/api/normalize";

export async function listAccounts() {
  const result = await invoke<unknown>("service_account_list", withAddr({ page: 1, pageSize: 500 }));
  return normalizeAccountList(result);
}

export function refreshAccounts() {
  return invoke("service_usage_refresh", withAddr());
}

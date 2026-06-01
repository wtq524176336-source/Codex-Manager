import { invoke, withAddr } from "@/api/transport";
import { normalizeApiKeyList } from "@/api/normalize";

export async function listApiKeys() {
  const result = await invoke<unknown>("service_apikey_list", withAddr());
  return normalizeApiKeyList(result);
}

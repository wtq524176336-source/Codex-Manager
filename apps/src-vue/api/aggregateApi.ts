import { invoke, withAddr } from "@/api/transport";
import { normalizeAggregateApiList } from "@/api/normalize";

export async function listAggregateApis() {
  const result = await invoke<unknown>("service_aggregate_api_list", withAddr());
  return normalizeAggregateApiList(result);
}

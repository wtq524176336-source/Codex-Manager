import { asObject, asString, toNullableBoolean, toNumber } from "@/api/normalize";
import { invoke, invokeFirst } from "@/api/transport";

export interface UpdateCheckResult {
  repo: string;
  mode: string;
  isPortable: boolean;
  hasUpdate: boolean;
  canPrepare: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseTag: string;
  releaseName: string | null;
  publishedAt: string | null;
  reason: string | null;
  checkedAtUnixSecs: number;
}

export interface UpdatePrepareResult {
  prepared: boolean;
  mode: string;
  isPortable: boolean;
  releaseTag: string;
  latestVersion: string;
  assetName: string;
  assetPath: string;
  downloaded: boolean;
  installerPath?: string | null;
  stagingDir?: string | null;
  preparedAtUnixSecs?: number;
}

export interface UpdateActionResult {
  ok: boolean;
  message: string;
}

export interface UpdateStatusResult {
  repo: string;
  mode: string;
  isPortable: boolean;
  currentVersion: string;
  currentExePath: string;
  portableMarkerPath: string;
  pending: UpdatePrepareResult | null;
  lastCheck: UpdateCheckResult | null;
  lastError: string | null;
}

function readUpdateCheckResult(payload: unknown): UpdateCheckResult {
  const source = asObject(payload);
  return {
    repo: asString(source.repo),
    mode: asString(source.mode),
    isPortable: toNullableBoolean(source.isPortable ?? source.is_portable) ?? false,
    hasUpdate: toNullableBoolean(source.hasUpdate ?? source.has_update) ?? false,
    canPrepare: toNullableBoolean(source.canPrepare ?? source.can_prepare) ?? false,
    currentVersion: asString(source.currentVersion ?? source.current_version),
    latestVersion: asString(source.latestVersion ?? source.latest_version),
    releaseTag: asString(source.releaseTag ?? source.release_tag),
    releaseName: asString(source.releaseName ?? source.release_name) || null,
    publishedAt: asString(source.publishedAt ?? source.published_at) || null,
    reason: asString(source.reason) || null,
    checkedAtUnixSecs: toNumber(source.checkedAtUnixSecs ?? source.checked_at_unix_secs, 0),
  };
}

function readUpdatePrepareResult(payload: unknown): UpdatePrepareResult {
  const source = asObject(payload);
  return {
    prepared: toNullableBoolean(source.prepared) ?? false,
    mode: asString(source.mode),
    isPortable: toNullableBoolean(source.isPortable ?? source.is_portable) ?? false,
    releaseTag: asString(source.releaseTag ?? source.release_tag),
    latestVersion: asString(source.latestVersion ?? source.latest_version),
    assetName: asString(source.assetName ?? source.asset_name),
    assetPath: asString(source.assetPath ?? source.asset_path),
    downloaded: toNullableBoolean(source.downloaded) ?? false,
    installerPath: asString(source.installerPath ?? source.installer_path) || null,
    stagingDir: asString(source.stagingDir ?? source.staging_dir) || null,
    preparedAtUnixSecs: toNumber(source.preparedAtUnixSecs ?? source.prepared_at_unix_secs, 0),
  };
}

function readUpdateActionResult(payload: unknown): UpdateActionResult {
  const source = asObject(payload);
  return {
    ok: toNullableBoolean(source.ok) ?? false,
    message: asString(source.message),
  };
}

function readUpdateStatusResult(payload: unknown): UpdateStatusResult {
  const source = asObject(payload);
  const pending = source.pending ? readUpdatePrepareResult(source.pending) : null;
  const lastCheck = source.lastCheck ?? source.last_check;
  return {
    repo: asString(source.repo),
    mode: asString(source.mode),
    isPortable: toNullableBoolean(source.isPortable ?? source.is_portable) ?? false,
    currentVersion: asString(source.currentVersion ?? source.current_version),
    currentExePath: asString(source.currentExePath ?? source.current_exe_path),
    portableMarkerPath: asString(source.portableMarkerPath ?? source.portable_marker_path),
    pending,
    lastCheck: lastCheck ? readUpdateCheckResult(lastCheck) : null,
    lastError: asString(source.lastError ?? source.last_error) || null,
  };
}

export async function checkUpdate() {
  const result = await invokeFirst<unknown>(["app_update_check", "update_check", "check_update"], {});
  return readUpdateCheckResult(result);
}

export async function prepareUpdate() {
  const result = await invokeFirst<unknown>(
    ["app_update_prepare", "update_download", "download_update"],
    {},
  );
  return readUpdatePrepareResult(result);
}

export async function applyPortableUpdate() {
  const result = await invokeFirst<unknown>(
    ["app_update_apply_portable", "update_restart", "restart_update"],
    {},
  );
  return readUpdateActionResult(result);
}

export async function launchInstallerUpdate() {
  const result = await invokeFirst<unknown>(
    ["app_update_launch_installer", "update_install", "install_update"],
    {},
  );
  return readUpdateActionResult(result);
}

export async function getUpdateStatus() {
  const result = await invokeFirst<unknown>(["app_update_status", "update_status"], {});
  return readUpdateStatusResult(result);
}

export function openUpdateLogsDir(assetPath?: string) {
  return invoke("app_update_open_logs_dir", { assetPath: assetPath || null });
}

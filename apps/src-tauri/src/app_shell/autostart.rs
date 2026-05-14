#[cfg(target_os = "windows")]
const WINDOWS_RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(target_os = "windows")]
const WINDOWS_RUN_VALUE_NAME: &str = "CodexManager";

#[cfg(target_os = "windows")]
fn quote_windows_command(path: &std::path::Path) -> String {
    format!("\"{}\"", path.to_string_lossy())
}

#[cfg(target_os = "windows")]
fn ensure_windows_autostart() -> Result<String, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe_path = std::env::current_exe()
        .map_err(|err| format!("读取当前 exe 路径失败：{err}"))?;
    let command = quote_windows_command(&exe_path);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(WINDOWS_RUN_KEY)
        .map_err(|err| format!("打开 Windows 启动项注册表失败：{err}"))?;

    run_key
        .set_value(WINDOWS_RUN_VALUE_NAME, &command)
        .map_err(|err| format!("写入 Windows 启动项失败：{err}"))?;

    Ok(command)
}

/// 函数 `ensure_autostart_registered`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 无
pub(crate) fn ensure_autostart_registered() {
    #[cfg(target_os = "windows")]
    match ensure_windows_autostart() {
        Ok(command) => log::info!("windows autostart registered: {}", command),
        Err(err) => log::warn!("windows autostart register failed: {}", err),
    }
}

//! Refresh tokens live in Windows Credential Manager (SPEC 4.3), never in SQLite: Google's
//! here, and the Sanctum account's (cloud.rs) under its own target.

/// Dev builds keep their own entry, like their own database.
const TARGET: &str = if cfg!(debug_assertions) { "Sanctum/google-dev" } else { "Sanctum/google" };

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

#[cfg(windows)]
pub fn save(secret: &str) -> Result<(), String> {
    save_to(TARGET, secret)
}

#[cfg(windows)]
pub fn save_to(target_name: &str, secret: &str) -> Result<(), String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};
    let mut target = wide(target_name);
    let mut user = wide("Sanctum");
    let blob = secret.as_bytes();
    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user.as_mut_ptr()),
        ..Default::default()
    };
    // SAFETY: every pointer in `cred` outlives the call; Windows copies the blob.
    unsafe { CredWriteW(&cred, 0) }.map_err(|e| format!("Couldn't save the sign-in: {e}"))
}

#[cfg(windows)]
pub fn load() -> Option<String> {
    load_from(TARGET)
}

#[cfg(windows)]
pub fn load_from(target_name: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
    let target = wide(target_name);
    let mut p: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: on success Windows hands back one allocation, read here and freed with CredFree.
    unsafe {
        CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut p).ok()?;
        let c = &*p;
        let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
        CredFree(p as *const _);
        String::from_utf8(bytes).ok()
    }
}

#[cfg(windows)]
pub fn clear() {
    clear_at(TARGET)
}

#[cfg(windows)]
pub fn clear_at(target_name: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let target = wide(target_name);
    // SAFETY: `target` is a valid NUL-terminated string for the duration of the call.
    unsafe {
        let _ = CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None);
    }
}

#[cfg(not(windows))]
pub fn save(_secret: &str) -> Result<(), String> {
    Err("Google Calendar needs Windows Credential Manager.".into())
}

#[cfg(not(windows))]
pub fn load() -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn clear() {}

#[cfg(not(windows))]
pub fn save_to(_target: &str, _secret: &str) -> Result<(), String> {
    Err("Signing in needs Windows Credential Manager.".into())
}

#[cfg(not(windows))]
pub fn load_from(_target: &str) -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn clear_at(_target: &str) {}

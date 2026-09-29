//! The Google refresh token lives in Windows Credential Manager (SPEC 4.3), never in SQLite.

/// Dev builds keep their own entry, like their own database.
const TARGET: &str = if cfg!(debug_assertions) { "Sanctum/google-dev" } else { "Sanctum/google" };

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

#[cfg(windows)]
pub fn save(secret: &str) -> Result<(), String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};
    let mut target = wide(TARGET);
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
    unsafe { CredWriteW(&cred, 0) }.map_err(|e| format!("Couldn't save the Google sign-in: {e}"))
}

#[cfg(windows)]
pub fn load() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
    let target = wide(TARGET);
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
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let target = wide(TARGET);
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

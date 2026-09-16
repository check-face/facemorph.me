// Public test vector from minisign-verify 0.2.5 (MIT, Frank Denis).
// Exercises the verification primitive used by the pinned Tauri updater, not
// installation or GitHub availability. No project signing key is generated.
use minisign_verify::{PublicKey, Signature};

#[test]
fn updater_primitive_rejects_tampered_payload_and_signature() {
    let key =
        PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3").unwrap();
    let text = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";
    let signature = Signature::decode(text).unwrap();
    assert!(key.verify(b"test", &signature, true).is_ok());
    assert!(key.verify(b"Test", &signature, true).is_err());
    let corrupt = text.replace("6NxvASXD", "6NyvASXD");
    let result = Signature::decode(&corrupt).and_then(|s| key.verify(b"test", &s, true));
    assert!(result.is_err());
}

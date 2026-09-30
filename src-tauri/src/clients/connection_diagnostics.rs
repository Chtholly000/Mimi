//! Classification never includes response headers, bodies, request URLs or keys.
/// Production constructor, also exercised by credential-free native UI smoke.
/// reqwest uses rustls-no-provider, so building before this initialization panics.
pub fn reachability_client() -> Result<reqwest::Client, reqwest::Error> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(8))
        .build()
}

pub fn authentication_rejected(error: &tokio_tungstenite::tungstenite::Error) -> bool {
    matches!(error, tokio_tungstenite::tungstenite::Error::Http(response)
        if matches!(response.status().as_u16(), 401 | 403))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_http_client_initializes_tls_in_a_fresh_process() {
        const FLAG: &str = "MIMI_TEST_FRESH_HTTP_CLIENT";
        if std::env::var(FLAG).as_deref() == Ok("1") {
            // Other HTTP tests may have initialized the process-global provider.
            // A fresh process reproduces the first-click path from native QA.
            assert!(rustls::crypto::CryptoProvider::get_default().is_none());
            assert!(reachability_client().is_ok());
            assert!(rustls::crypto::CryptoProvider::get_default().is_some());
            return;
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "clients::connection_diagnostics::tests::production_http_client_initializes_tls_in_a_fresh_process",
                "--nocapture",
            ])
            .env(FLAG, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "fresh HTTP constructor failed: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }

    #[test]
    fn authenticated_handshake_rejections_are_not_network_failures() {
        for (status, rejected) in [(401, true), (403, true), (429, false), (500, false)] {
            let response = tokio_tungstenite::tungstenite::http::Response::builder()
                .status(status)
                .body(None)
                .unwrap();
            assert_eq!(
                authentication_rejected(&tokio_tungstenite::tungstenite::Error::Http(Box::new(
                    response
                ))),
                rejected
            );
        }
        assert!(!authentication_rejected(
            &tokio_tungstenite::tungstenite::Error::ConnectionClosed
        ));
    }
}

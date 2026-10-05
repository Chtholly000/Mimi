use std::path::PathBuf;
use std::process::Command;

fn xcrun(arguments: &[&str]) -> String {
    let output = Command::new("xcrun").args(arguments).output().expect(
        "Apple Speech requires Xcode 26 or newer: install Xcode and select it with xcode-select",
    );
    assert!(
        output.status.success(),
        "Apple Speech requires the macOS 26 SDK and Swift 6.2+: install/select Xcode 26 or newer; xcrun failed"
    );
    String::from_utf8(output.stdout)
        .expect("Xcode paths must be UTF-8")
        .trim()
        .to_owned()
}

pub fn build() {
    println!("cargo:rerun-if-changed=apple-speech/Bridge.swift");
    println!("cargo:rerun-if-changed=apple-speech/PCMQueue.swift");
    println!("cargo:rerun-if-changed=apple-speech/build.rs");
    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");
    println!("cargo:rerun-if-env-changed=SDKROOT");
    if std::env::var("TARGET").as_deref() != Ok("aarch64-apple-darwin") {
        return;
    }
    let sdk_version = xcrun(&["--sdk", "macosx", "--show-sdk-version"]);
    let major = sdk_version
        .split('.')
        .next()
        .and_then(|n| n.parse::<u32>().ok());
    assert!(major.is_some_and(|n| n >= 26), "Apple Speech requires the macOS 26 SDK: install/select Xcode 26 or newer (found SDK {sdk_version})");
    let sdk = PathBuf::from(xcrun(&["--sdk", "macosx", "--show-sdk-path"]));
    let swiftc = PathBuf::from(xcrun(&["--find", "swiftc"]));
    let swift_lib = swiftc
        .parent()
        .and_then(|p| p.parent())
        .expect("Swift toolchain path")
        .join("lib/swift/macosx");
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"));
    let library = output.join("libMimiAppleSpeech.a");
    let status = Command::new(&swiftc)
        .args([
            "-parse-as-library",
            "-swift-version",
            "6",
            "-warnings-as-errors",
            "-target",
            "arm64-apple-macosx13.0",
            "-sdk",
        ])
        .arg(&sdk)
        .arg("-module-cache-path")
        .arg(output.join("swift-module-cache"))
        .args([
            "-O",
            "-emit-library",
            "-static",
            "-module-name",
            "MimiAppleSpeech",
        ])
        .args([
            "apple-speech/PCMQueue.swift",
            "apple-speech/Bridge.swift",
            "-o",
        ])
        .arg(&library)
        .status()
        .expect("run the Xcode Swift compiler for Apple Speech");
    assert!(status.success(), "Apple Speech native bridge failed to compile; use Xcode 26+ and fix the Swift diagnostics above");
    // Swift objects carry autolink directives, including weak framework imports
    // for APIs newer than the deployment target. The system supplies Swift at
    // runtime; neither Xcode nor an external helper is required by the user.
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static=MimiAppleSpeech");
    println!("cargo:rustc-link-search=native={}", swift_lib.display());
    println!(
        "cargo:rustc-link-search=native={}",
        sdk.join("usr/lib/swift").display()
    );
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// Only inspect known executables. Discovery never launches an agent or reads credentials.
const EXECUTABLES: &[&str] = &[
    "claude",
    "claude-agent-acp",
    "codex",
    "codex-acp",
    "gemini",
    "openpencil-mcp-http",
    "openpencil-harness",
    "npm",
];

// OpenPencil's own companions, whose installed version must match the app.
const PACKAGES: &[(&str, &str)] = &[
    ("openpencil-mcp-http", "@open-pencil/mcp"),
    ("openpencil-harness", "@open-pencil/harness"),
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLookup {
    executables: BTreeMap<String, Option<String>>,
    /// Package versions read from `package.json` next to the resolved executable.
    versions: BTreeMap<String, Option<String>>,
    search_path: String,
}

#[derive(serde::Deserialize)]
struct PackageManifest {
    name: Option<String>,
    version: Option<String>,
}

/// Follows the executable's links into its package and reads the version without running it.
fn package_version(executable: &Path, package: &str) -> Option<String> {
    let resolved = std::fs::canonicalize(executable).ok()?;
    resolved.ancestors().skip(1).take(4).find_map(|dir| {
        let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
        let manifest: PackageManifest = serde_json::from_str(&text).ok()?;
        (manifest.name.as_deref() == Some(package))
            .then_some(manifest.version)
            .flatten()
    })
}

fn lookup_with(search_path: String, resolve: impl Fn(&str) -> Option<PathBuf>) -> AgentLookup {
    let resolved: BTreeMap<&str, Option<PathBuf>> = EXECUTABLES
        .iter()
        .map(|command| (*command, resolve(command)))
        .collect();
    AgentLookup {
        executables: resolved
            .iter()
            .map(|(command, path)| {
                (
                    (*command).to_owned(),
                    path.as_ref()
                        .map(|path| path.to_string_lossy().into_owned()),
                )
            })
            .collect(),
        versions: PACKAGES
            .iter()
            .map(|(command, package)| {
                let path = resolved.get(command).cloned().flatten();
                (
                    (*package).to_owned(),
                    path.and_then(|path| package_version(&path, package)),
                )
            })
            .collect(),
        search_path,
    }
}

#[tauri::command]
pub async fn agent_lookup() -> Result<AgentLookup, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let current = std::env::var("PATH").unwrap_or_default();
        let search_path = crate::augment_path(&current, &crate::mcp_candidate_dirs());
        let cwd = std::env::current_dir().unwrap_or_else(|_| Path::new("/").to_path_buf());
        lookup_with(search_path.clone(), |command| {
            which::which_in(command, Some(&search_path), &cwd).ok()
        })
    })
    .await
    .map_err(|_| "Could not discover local agents.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_cli_and_adapter_independently_without_running_them() {
        let result = lookup_with("/agents/bin".to_owned(), |command| match command {
            "claude" | "npm" => Some(PathBuf::from("/agents/bin").join(command)),
            _ => None,
        });
        assert_eq!(result.executables.len(), EXECUTABLES.len());
        assert_eq!(
            result.executables["claude"],
            Some("/agents/bin/claude".to_owned())
        );
        assert_eq!(result.executables["claude-agent-acp"], None);
        assert_eq!(result.executables["codex"], None);
        assert_eq!(result.search_path, "/agents/bin");
        assert_eq!(result.versions["@open-pencil/mcp"], None);
    }

    #[cfg(unix)]
    #[test]
    fn reads_the_version_of_a_linked_package() {
        let root = std::env::temp_dir().join(format!("openpencil-agents-{}", std::process::id()));
        let package = root.join("node_modules/@open-pencil/mcp");
        std::fs::create_dir_all(package.join("dist")).unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"name":"@open-pencil/mcp","version":"0.12.0"}"#,
        )
        .unwrap();
        std::fs::write(package.join("dist/index.js"), "").unwrap();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        let link = root.join("bin/openpencil-mcp-http");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(package.join("dist/index.js"), &link).unwrap();

        assert_eq!(
            package_version(&link, "@open-pencil/mcp"),
            Some("0.12.0".to_owned())
        );
        assert_eq!(package_version(&link, "@open-pencil/harness"), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}

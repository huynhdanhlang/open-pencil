use std::path::{Path, PathBuf};

// Only inspect known executables. Discovery never launches an agent or reads credentials.
const EXECUTABLES: &[&str] = &[
    "claude",
    "claude-agent-acp",
    "codex",
    "codex-acp",
    "gemini",
    "openpencil-mcp-http",
    "npm",
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLookup {
    executables: std::collections::BTreeMap<String, Option<String>>,
    search_path: String,
}

fn lookup_with(search_path: String, resolve: impl Fn(&str) -> Option<PathBuf>) -> AgentLookup {
    AgentLookup {
        executables: EXECUTABLES
            .iter()
            .map(|command| {
                (
                    (*command).to_owned(),
                    resolve(command).map(|path| path.to_string_lossy().into_owned()),
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
    }
}

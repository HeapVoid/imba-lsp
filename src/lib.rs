use std::{env, path::Path};

use zed_extension_api::{self as zed, Result};

struct ImbaExtension;

impl zed::Extension for ImbaExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = lsp_server_path()?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: worktree.shell_env(),
        })
    }
}

fn lsp_server_path() -> Result<String> {
    let path = env::current_dir()
        .map_err(|error| format!("Could not resolve Imba extension directory: {error}"))?
        .join("lsp")
        .join("dist")
        .join("src")
        .join("server.js");

    ensure_lsp_server_exists(&path)?;

    Ok(path.to_string_lossy().to_string())
}

fn ensure_lsp_server_exists(path: &Path) -> Result<()> {
    if path.is_file() {
        return Ok(());
    }

    Err(format!(
        "Imba LSP server was not found at {}. Run `npm --prefix lsp install` and `npm run lsp:build`, then reinstall the Zed dev extension.",
        path.to_string_lossy()
    ))
}

zed::register_extension!(ImbaExtension);

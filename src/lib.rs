use std::{
    env,
    path::{Path, PathBuf},
};

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
        let server_path = lsp_server_path(worktree)?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: worktree.shell_env(),
        })
    }
}

fn lsp_server_path(worktree: &zed::Worktree) -> Result<String> {
    let paths = lsp_server_candidates(worktree)?;
    let path = paths
        .first()
        .ok_or_else(|| "Could not resolve any Imba LSP server candidate path".to_string())?;

    Ok(path.to_string_lossy().to_string())
}

fn lsp_server_candidates(worktree: &zed::Worktree) -> Result<Vec<PathBuf>> {
    let extension_work_dir = env::current_dir()
        .map_err(|error| format!("Could not resolve Imba extension work directory: {error}"))?;

    let mut paths = Vec::new();

    if let Some(extension_root) = dev_extension_root(&extension_work_dir) {
        paths.push(lsp_server_path_in(extension_root));
    }

    paths.push(lsp_server_path_in(worktree.root_path()));
    paths.push(lsp_server_path_in(extension_work_dir));

    Ok(paths)
}

fn dev_extension_root(extension_work_dir: &Path) -> Option<PathBuf> {
    let extensions_dir = extension_work_dir.parent()?.parent()?;

    Some(extensions_dir.join("installed").join("imba"))
}

fn lsp_server_path_in(root: impl AsRef<Path>) -> PathBuf {
    root.as_ref()
        .join("lsp")
        .join("dist")
        .join("src")
        .join("server.js")
}

zed::register_extension!(ImbaExtension);

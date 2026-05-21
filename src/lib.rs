use std::{
    env, fs,
    path::{Path, PathBuf},
};

use zed_extension_api::{self as zed, Result};

const LSP_PACKAGE_NAME: &str = "imba-lsp";
const LSP_PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
const LSP_SERVER_PATH: &str = "dist/src/server.js";

struct ImbaExtension {
    did_install_lsp: bool,
}

impl ImbaExtension {
    fn lsp_server_path(&mut self, language_server_id: &zed::LanguageServerId) -> Result<String> {
        if let Some(path) = local_lsp_server_path()? {
            return Ok(path.to_string_lossy().to_string());
        }

        self.install_lsp_package_if_needed(language_server_id)?;

        let path = npm_lsp_server_path()?;
        if !is_file(&path) {
            return Err(format!(
                "installed package '{LSP_PACKAGE_NAME}@{LSP_PACKAGE_VERSION}' did not contain expected path '{}'",
                path.to_string_lossy(),
            ));
        }

        Ok(path.to_string_lossy().to_string())
    }

    fn install_lsp_package_if_needed(
        &mut self,
        language_server_id: &zed::LanguageServerId,
    ) -> Result<()> {
        let installed_version = zed::npm_package_installed_version(LSP_PACKAGE_NAME)?;
        if self.did_install_lsp && installed_version.as_deref() == Some(LSP_PACKAGE_VERSION) {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        if installed_version.as_deref() != Some(LSP_PACKAGE_VERSION) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(LSP_PACKAGE_NAME, LSP_PACKAGE_VERSION)?;
        }

        self.did_install_lsp = true;
        Ok(())
    }
}

impl zed::Extension for ImbaExtension {
    fn new() -> Self {
        Self {
            did_install_lsp: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = self.lsp_server_path(language_server_id)?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: worktree.shell_env(),
        })
    }
}

fn local_lsp_server_path() -> Result<Option<PathBuf>> {
    let extension_work_dir = env::current_dir()
        .map_err(|error| format!("Could not resolve Imba extension work directory: {error}"))?;

    for path in local_lsp_server_candidates(&extension_work_dir) {
        if is_file(&path) {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn local_lsp_server_candidates(extension_work_dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(extension_root) = dev_extension_root(extension_work_dir) {
        paths.push(lsp_server_path_in(extension_root));
    }

    paths.push(lsp_server_path_in(extension_work_dir));

    paths
}

fn dev_extension_root(extension_work_dir: &Path) -> Option<PathBuf> {
    let extensions_dir = extension_work_dir.parent()?.parent()?;

    Some(extensions_dir.join("installed").join("imba"))
}

fn lsp_server_path_in(root: impl AsRef<Path>) -> PathBuf {
    root.as_ref().join("lsp").join(LSP_SERVER_PATH)
}

fn npm_lsp_server_path() -> Result<PathBuf> {
    Ok(env::current_dir()
        .map_err(|error| format!("Could not resolve Imba extension work directory: {error}"))?
        .join("node_modules")
        .join(LSP_PACKAGE_NAME)
        .join(LSP_SERVER_PATH))
}

fn is_file(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
}

zed::register_extension!(ImbaExtension);

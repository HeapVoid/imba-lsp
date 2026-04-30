#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const languageDir = path.join(root, "languages");
const configPaths = [];

for (const languageName of fs.readdirSync(languageDir)) {
  const configPath = path.join(languageDir, languageName, "config.toml");
  if (fs.existsSync(configPath)) configPaths.push(configPath);
}

let failed = false;

for (const configPath of configPaths) {
  const relativePath = path.relative(root, configPath);
  const content = fs.readFileSync(configPath, "utf8");
  const regexSettings = content.matchAll(/^(increase_indent_pattern|decrease_indent_pattern)\s*=\s*(".*")$/gm);

  for (const match of regexSettings) {
    const setting = match[1];
    let pattern;

    try {
      pattern = JSON.parse(match[2]);
    } catch (error) {
      failed = true;
      console.error(`${relativePath}: invalid ${setting} string: ${error.message}`);
      continue;
    }

    const result = spawnSync("rg", ["--regexp", pattern, "--", "/dev/null"], {
      encoding: "utf8",
    });

    if (result.status > 1) {
      failed = true;
      console.error(`${relativePath}: invalid Rust regex in ${setting}`);
      process.stderr.write(result.stderr);
    }
  }
}

if (failed) process.exit(1);

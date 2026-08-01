// Prevents an extra console window from opening on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Clone, Serialize)]
struct TrainingProgress {
    bot_id: String,
    line: String,
}

// Mode A (local training). Spawns FreqAI via `docker run` as a child
// process, streams its output to the frontend as `training-progress`
// events, and returns the path of the ONE resulting .joblib file — never a
// list. If training produces zero or more than one model file, this
// returns an error rather than guessing, mirroring the same strict
// single-file rule the upload API enforces.
//
// Deliberately does not touch the user's real exchange API credentials:
// downloading history and running `backtesting` (which is what actually
// trains and persists a FreqAI model — there is no separate "train"
// subcommand) only need public market data.
#[tauri::command]
async fn train_local_model(
    app: AppHandle,
    bot_id: String,
    strategy: String,
    strategy_code: String,
    exchange_name: String,
    pair_whitelist: String,
) -> Result<String, String> {
    // `strategy` becomes a filename (user_data/strategies/<strategy>.py) —
    // reject anything that isn't a plain identifier before it's ever used
    // as a path, mirroring the same check the web API applies at creation
    // time (see lib/strategy-validation.ts).
    if !is_safe_python_identifier(&strategy) {
        return Err(format!("strategy must be a valid Python identifier (got: {strategy:?})"));
    }

    let work_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join("freqtrade")
        .join(&bot_id);

    let user_data_dir = work_dir.join("user_data");
    let strategies_dir = user_data_dir.join("strategies");
    std::fs::create_dir_all(&strategies_dir).map_err(|e| format!("could not create strategies dir: {e}"))?;
    std::fs::write(strategies_dir.join(format!("{strategy}.py")), &strategy_code)
        .map_err(|e| format!("could not write strategy file: {e}"))?;

    let pairs: Vec<String> = pair_whitelist
        .split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if pairs.is_empty() {
        return Err("pairWhitelist must contain at least one pair".into());
    }

    let config = serde_json::json!({
        "stake_currency": "USDT",
        "stake_amount": "unlimited",
        "dry_run": true,
        "trading_mode": "spot",
        "exchange": {
            "name": exchange_name,
            "key": "",
            "secret": "",
            "pair_whitelist": pairs,
            "pair_blacklist": [],
        },
        "pairlists": [{ "method": "StaticPairList" }],
        "freqai": {
            "enabled": true,
            "identifier": format!("{bot_id}-model"),
            "train_period_days": 30,
            "backtest_period_days": 7,
            "feature_parameters": { "include_timeframes": ["5m"] },
            "data_split_parameters": { "test_size": 0.25 }
        }
    });
    let config_json = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(user_data_dir.join("config.json"), config_json)
        .map_err(|e| format!("could not write config.json: {e}"))?;

    run_freqtrade_step(
        &app,
        &bot_id,
        &work_dir,
        &["download-data", "--config", "user_data/config.json", "--timeframe", "5m"],
    )
    .await?;

    run_freqtrade_step(
        &app,
        &bot_id,
        &work_dir,
        &[
            "backtesting",
            "--config",
            "user_data/config.json",
            "--strategy",
            &strategy,
            "--freqaimodel",
            "LightGBMRegressor",
        ],
    )
    .await?;

    let models_dir = user_data_dir.join("models");
    let mut joblib_files = Vec::new();
    collect_joblib_files(&models_dir, &mut joblib_files)?;

    match joblib_files.as_slice() {
        [single] => Ok(single.to_string_lossy().to_string()),
        [] => Err("training finished but produced no .joblib model file".into()),
        multiple => Err(format!(
            "expected exactly 1 .joblib model file, found {} — refusing to guess which one to upload",
            multiple.len()
        )),
    }
}

fn is_safe_python_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else { return false };
    if value.len() > 64 || !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

async fn run_freqtrade_step(app: &AppHandle, bot_id: &str, work_dir: &Path, args: &[&str]) -> Result<(), String> {
    let mut docker_args = vec![
        "run".to_string(),
        "--rm".to_string(),
        "-v".to_string(),
        format!("{}:/freqtrade/user_data", work_dir.join("user_data").display()),
        "freqtradeorg/freqtrade:stable".to_string(),
    ];
    docker_args.extend(args.iter().map(|s| s.to_string()));

    let mut child = Command::new("docker")
        .args(&docker_args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not spawn docker (is Docker Desktop running?): {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let bot_id = bot_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "training-progress",
                    TrainingProgress { bot_id: bot_id.clone(), line },
                );
            }
        });
    }

    let status = child.wait().await.map_err(|e| format!("docker process error: {e}"))?;
    if !status.success() {
        return Err(format!("docker exited with status {status}"));
    }
    Ok(())
}

fn collect_joblib_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_joblib_files(&path, out)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("joblib") {
            out.push(path);
        }
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![train_local_model])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

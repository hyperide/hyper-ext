mod command;
mod projection;
use oxc_allocator::Allocator;
use oxc_ast::ast::Statement;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn strings(v: &Value) -> Vec<&str> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}
fn observed_bound(v: &Value, minimum: u64) -> Option<(f64, f64)> {
    let base = v.get("baseline")?.as_array()?;
    let candidate = v.get("candidate")?.as_array()?;
    if (base.len() as u64) < minimum || (candidate.len() as u64) < minimum {
        return None;
    }
    let b: Option<Vec<f64>> = base.iter().map(Value::as_f64).collect();
    let c: Option<Vec<f64>> = candidate.iter().map(Value::as_f64).collect();
    let (b, c) = (b?, c?);
    if b.iter().chain(c.iter()).any(|n| !n.is_finite() || *n < 0.0) {
        return None;
    }
    Some((
        b.iter().copied().fold(f64::INFINITY, f64::min),
        c.iter().copied().fold(0.0, f64::max),
    ))
}
pub fn plan(request: &Value) -> Result<Value, String> {
    if request["version"] != 1 {
        return Err("Unsupported request version".into());
    }
    let authored = request["files"].as_array().ok_or("Missing source files")?;
    let mut generated = projection::generate(&request["config"])?;
    generated.extend(command::generate(&request["config"])?);
    let files: Vec<&Value> = authored.iter().chain(generated.iter()).collect();
    if files.is_empty() {
        return Err("Empty source program".into());
    }
    let mut inventory = Vec::new();
    let mut facade_imports = BTreeMap::<String, String>::new();
    let mut rewrites = BTreeMap::<String, Value>::new();
    for file in files {
        let name = file["path"].as_str().ok_or("Missing source path")?;
        let source = file["content"].as_str().ok_or("Missing source content")?;
        let allocator = Allocator::default();
        let source_type = SourceType::from_path(name).map_err(|e| e.to_string())?;
        let parsed = Parser::new(&allocator, source, source_type).parse();
        if !parsed.diagnostics.is_empty() {
            return Err(format!(
                "Syntax diagnostics in {name}: {:?}",
                parsed.diagnostics
            ));
        }
        if parsed.program.body.len() == 1
            && parsed.program.directives.is_empty()
            && let Statement::ExportFromDeclaration(declaration) = &parsed.program.body[0]
            && declaration.with_clause.is_none()
        {
            facade_imports.insert(name.into(), declaration.source.value.to_string());
            rewrites.insert(
                name.into(),
                json!({
                    "before":&source[..declaration.source.span.start as usize],
                    "after":&source[declaration.source.span.end as usize..]
                }),
            );
        }
        inventory
            .push(json!({"path":name,"statements":parsed.program.body.len(),"bytes":source.len()}));
    }
    let config = &request["config"];
    let units = config["units"].as_array().ok_or("Missing units")?;
    let targets = strings(&config["targets"]);
    let caps = strings(&config["capabilities"]);
    let metrics = strings(&config["metrics"]);
    let cases = strings(&config["cases"]);
    if targets.is_empty() || metrics.is_empty() || cases.is_empty() {
        return Err("Targets, metrics and cases must be nonempty".into());
    }
    let minimum = config["minimumSamples"].as_u64().unwrap_or(5).max(3);
    let profile = &request["profile"];
    let fresh = profile["sourceHash"].is_string()
        && profile["sourceHash"] == request["sourceHash"]
        && profile["version"] == 1;
    let records = profile["records"].as_array().cloned().unwrap_or_default();
    let proofs = profile["correctness"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut decisions = Vec::new();
    for unit in units {
        let id = unit["id"].as_str().ok_or("Missing unit id")?;
        let baseline = unit["baseline"].as_str().ok_or("Missing baseline")?;
        let mut chosen = baseline.to_string();
        let mut chosen_id = "baseline".to_string();
        let mut best = 1.0_f64;
        let mut rejected = Vec::new();
        for variant in unit["variants"].as_array().ok_or("Missing variants")? {
            let vid = variant["id"].as_str().ok_or("Missing variant id")?;
            let mut reasons = Vec::<String>::new();
            if !facade_imports.contains_key(unit["facade"].as_str().unwrap_or("")) {
                reasons.push("Facade is not a single effect-free named re-export".into());
            }
            if request["mode"] == "baseline" {
                reasons.push("Explicit baseline build".into());
            }
            if !fresh {
                reasons.push("Missing/stale source-hash profile".into());
            }
            if variant["contract"] != unit["contract"] {
                reasons.push("Observable contract mismatch".into());
            }
            if variant["executor"]
                .as_str()
                .unwrap_or("js-main")
                .contains("worker")
                && unit["timing"] != "async"
            {
                reasons.push("A synchronous contract cannot be moved to a worker".into());
            }
            for capability in strings(&variant["requires"]) {
                if !caps.contains(&capability) {
                    reasons.push(format!("Target lacks declared capability {capability}"));
                }
            }
            let mut score = 0.0_f64;
            let mut observed_cells = 0_usize;
            for target in &targets {
                if !proofs.iter().any(|p| {
                    p["unit"] == id
                        && p["variant"] == vid
                        && p["target"] == *target
                        && p["passed"] == true
                        && p["testHash"].as_str().is_some_and(|h| h.len() == 64)
                }) {
                    reasons.push(format!(
                        "No passing, identified correctness run for {target}"
                    ));
                }
                for case in &cases {
                    for metric in &metrics {
                        let matches: Vec<_> = records
                            .iter()
                            .filter(|v| {
                                v["unit"] == id
                                    && v["variant"] == vid
                                    && v["target"] == *target
                                    && v["case"] == *case
                                    && v["metric"] == *metric
                            })
                            .collect();
                        let bound = if matches.len() == 1 {
                            observed_bound(matches[0], minimum)
                        } else {
                            None
                        };
                        match bound {
                            Some((base, candidate)) => {
                                observed_cells += 1;
                                // Diagnostics must include rejected cells, not only the winning subset.
                                let ratio = if base == 0.0 {
                                    if candidate == 0.0 { 1.0 } else { f64::INFINITY }
                                } else {
                                    candidate / base
                                };
                                score = score.max(ratio);
                                if candidate > base {
                                    reasons.push(format!("Regression {target}/{case}/{metric}: max candidate {candidate} > min baseline {base}"));
                                }
                            }
                            None => reasons.push(format!(
                                "Missing/invalid/duplicate samples {target}/{case}/{metric}"
                            )),
                        }
                    }
                }
            }
            if reasons.is_empty() && score >= 1.0 {
                reasons.push(
                    "No strict observed improvement; tied or timer-limited cells retain baseline"
                        .into(),
                );
            }
            if reasons.is_empty() && score < best {
                best = score;
                chosen = variant["entry"]
                    .as_str()
                    .ok_or("Missing variant entry")?
                    .into();
                chosen_id = vid.into();
            }
            let finite_ratio = if observed_cells > 0 && score.is_finite() {
                Some(score)
            } else {
                None
            };
            rejected.push(json!({"variant":vid,"eligible":reasons.is_empty(),"worstObservedRatio":finite_ratio,"worstObservedRatioUnbounded":observed_cells > 0 && !score.is_finite(),"observedCells":observed_cells,"reasons":reasons}));
        }
        decisions.push(json!({"unit":id,"facade":unit["facade"],"selected":chosen_id,"entry":chosen,"baseline":baseline,"baselineImport":facade_imports.get(unit["facade"].as_str().unwrap_or("")),"rewrite":rewrites.get(unit["facade"].as_str().unwrap_or("")),"candidates":rejected}));
    }
    Ok(
        json!({"manifestVersion":1,"compiler":"statec/0.1.0-oxc", "sourceHash":request["sourceHash"],"selectionTime":"build","scope":"explicit contract-preserving module specialization; not general state source lowering","guarantee":"All declared sampled cells pass conservative max(candidate)<=min(baseline); not a bound on every future execution","targets":targets,"inventory":inventory,"decisions":decisions,"generatedModules":generated}),
    )
}

/// Browser-facing API. Compilation is pure: source is parsed, never executed.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn compile_json(input: &str) -> Result<String, String> {
    if input.len() > 4 * 1024 * 1024 {
        return Err("Compiler request exceeds 4 MiB".into());
    }
    let request: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
    let result = plan(&request)?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

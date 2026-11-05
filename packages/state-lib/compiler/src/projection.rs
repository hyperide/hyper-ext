use serde_json::{Value, json};
use std::collections::BTreeSet;

/// Explicit schema projection, not arbitrary callback translation.
pub fn generate(config: &Value) -> Result<Vec<Value>, String> {
    let units = config["units"]
        .as_array()
        .ok_or("projection: missing units")?;
    let mut output = Vec::new();
    for unit in units {
        let variants = unit["variants"]
            .as_array()
            .ok_or("projection: missing variants")?;
        for variant in variants {
            let Some(spec) = variant.get("generate") else {
                continue;
            };
            if spec["kind"] == "json-command" {
                continue;
            }
            if spec["kind"] != "projection"
                || variant["executor"] != "js-main"
                || unit["timing"] != "sync"
            {
                return Err("projection: only a synchronous JS projection is supported".into());
            }
            let name = spec["export"]
                .as_str()
                .ok_or("projection: missing export")?;
            if name.is_empty()
                || !name.bytes().enumerate().all(|(i, c)| {
                    c.is_ascii_alphabetic()
                        || c == b'_'
                        || c == b'$'
                        || (i > 0 && c.is_ascii_digit())
                })
            {
                return Err("projection: invalid export identifier".into());
            }
            let fields = spec["fields"]
                .as_array()
                .ok_or("projection: fields must be an array")?;
            if fields.len() > 256 {
                return Err("projection: maximum 256 fields".into());
            }
            let mut seen = BTreeSet::new();
            let mut members = Vec::new();
            for field in fields {
                let field = field
                    .as_str()
                    .ok_or("projection: every field must be a string")?;
                if !seen.insert(field) {
                    return Err("projection: duplicate field".into());
                }
                let encoded = serde_json::to_string(field).map_err(|e| e.to_string())?;
                members.push(format!("[{encoded}]: input[{encoded}]"));
            }
            let content = format!(
                "export function {name}(input) {{ return {{ {} }}; }}\n",
                members.join(", ")
            );
            output.push(json!({"path":variant["entry"],"content":content,"kind":"projection","unit":unit["id"],"variant":variant["id"]}));
        }
    }
    Ok(output)
}

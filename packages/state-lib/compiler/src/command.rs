use serde_json::{Value, json};

fn text(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}
fn argument(value: &Value) -> Result<String, String> {
    if let Some(object) = value.as_object() {
        if object.len() == 1 && value["arg"].as_str().is_some() {
            return Ok(format!("args[{}]", text(&value["arg"])?));
        }
        return Err("command: value must be scalar or a named argument".into());
    }
    if value.is_array() {
        return Err("command: array values are not scalar".into());
    }
    text(value)
}
fn path(value: &Value) -> Result<String, String> {
    let keys = value.as_array().ok_or("command: path must be an array")?;
    if keys.is_empty() || keys.len() > 64 {
        return Err("command: path length must be 1..64".into());
    }
    let mut parts = Vec::new();
    for key in keys {
        if !(key.is_string()
            || key.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991)
            || key.is_object())
        {
            return Err("command: invalid path segment".into());
        }
        parts.push(argument(key)?);
    }
    Ok(format!("[{}]", parts.join(",")))
}
fn field(spec: &Value, name: &str) -> Result<String, String> {
    if !spec[name].is_string() {
        return Err(format!("command: {name} must be a string"));
    }
    text(&spec[name])
}

/// Known commands lower to one shared private builder; no arbitrary callback translation.
pub fn generate(config: &Value) -> Result<Vec<Value>, String> {
    let mut modules = Vec::new();
    for unit in config["units"].as_array().ok_or("command: missing units")? {
        for variant in unit["variants"]
            .as_array()
            .ok_or("command: missing variants")?
        {
            let spec = &variant["generate"];
            if spec["kind"] != "json-command" {
                continue;
            }
            if unit["timing"] != "sync" || variant["executor"] != "js-main" {
                return Err("command: only synchronous main-thread commands are supported".into());
            }
            let name = spec["export"].as_str().ok_or("command: missing export")?;
            if name.is_empty()
                || !name.bytes().enumerate().all(|(i, c)| {
                    c.is_ascii_alphabetic() || c == b'_' || c == b'$' || i > 0 && c.is_ascii_digit()
                })
            {
                return Err("command: invalid export identifier".into());
            }
            let runtime = spec["runtime"]
                .as_str()
                .ok_or("command: missing runtime module")?;
            let operation = spec["operation"]
                .as_str()
                .ok_or("command: missing operation")?;
            let value = || argument(spec.get("value").ok_or("command: missing value")?);
            let stride = || argument(spec.get("stride").unwrap_or(&json!(1)));
            let (helper, arguments) = match operation {
                "noop" => ("copyJsonRoot", String::new()),
                "set" => (
                    "setJsonScalar",
                    format!(",{},{}", path(&spec["path"])?, value()?),
                ),
                "toggle" => ("toggleJsonScalar", format!(",{}", path(&spec["path"])?)),
                "each" => (
                    "setJsonEach",
                    format!(
                        ",{},{},{},{}",
                        path(&spec["path"])?,
                        field(spec, "field")?,
                        value()?,
                        stride()?
                    ),
                ),
                "groups" => (
                    "setJsonGroups",
                    format!(
                        ",{},{},{},{},{}",
                        path(&spec["path"])?,
                        field(spec, "itemsField")?,
                        field(spec, "field")?,
                        value()?,
                        stride()?
                    ),
                ),
                "move" => (
                    "moveJsonItem",
                    format!(
                        ",{},{},{},{}",
                        path(&spec["path"])?,
                        argument(&spec["fromIndex"])?,
                        path(&spec["targetPath"])?,
                        argument(&spec["toIndex"])?
                    ),
                ),
                _ => return Err("command: unsupported operation".into()),
            };
            let import = text(&json!(format!("./{runtime}")))?;
            let content = format!(
                "import {{{helper} as __update}} from {import};\nexport function {name}(base,args) {{ return __update(base{arguments}); }}\n"
            );
            modules.push(json!({"path":variant["entry"],"content":content,"kind":"json-command","unit":unit["id"],"variant":variant["id"]}));
        }
    }
    Ok(modules)
}

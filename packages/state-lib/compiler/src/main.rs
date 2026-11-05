use serde_json::{Value, json};
use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    let result = io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| e.to_string())
        .and_then(|_| serde_json::from_str::<Value>(&input).map_err(|e| e.to_string()))
        .and_then(|v| statec::plan(&v));
    match result {
        Ok(value) => println!("{}", serde_json::to_string(&value).unwrap()),
        Err(message) => {
            eprintln!("{}", json!({"error":message}));
            std::process::exit(2);
        }
    }
}

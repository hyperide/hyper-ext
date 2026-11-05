(module
 (func $length (import "wasm:js-string" "length") (param externref) (result i32))
 (func (export "length") (param externref) (result i32) local.get 0 call $length)
 (func (export "identity") (param externref) (result externref) local.get 0))

(module
 (memory (export "memory") 64)
 (func (export "compute") (param $start i32) (param $end i32) (result i32)
  (local $i i32) (local $j i32) (local $value i32) (local $sum i32)
  local.get $start local.set $i
  block $done
   loop $row
    local.get $i local.get $end i32.ge_u br_if $done
    local.get $i i32.const 4 i32.mul i32.load local.set $value
    i32.const 0 local.set $j
    loop $mix
     local.get $value i32.const 1664525 i32.mul i32.const 1013904223 i32.add local.set $value
     local.get $j i32.const 1 i32.add local.tee $j i32.const 8 i32.lt_u br_if $mix
    end
    local.get $sum local.get $value i32.add local.set $sum
    local.get $i i32.const 1 i32.add local.set $i br $row
   end
  end
  local.get $sum))

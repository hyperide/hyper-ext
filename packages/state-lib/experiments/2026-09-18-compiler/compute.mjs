export function compute(values, start = 0, end = values.length) {
  let sum = 0;
  for (let i = start; i < end; i++) {
    let value = values[i];
    for (let j = 0; j < 8; j++) value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    sum = (sum + value) >>> 0;
  }
  return sum;
}

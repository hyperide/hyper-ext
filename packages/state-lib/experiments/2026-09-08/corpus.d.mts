export interface OperatorCase { id:string; title:string; family:string; code:string; native:string; note:string; optimized:()=>unknown; reference:()=>unknown; }
export const cases: OperatorCase[];
export const invoices: readonly Record<string, unknown>[];
export const customers: readonly Record<string, unknown>[];
export function runCase(id:string): {expected:unknown;actual:unknown};
export function equal(a:unknown,b:unknown):boolean;

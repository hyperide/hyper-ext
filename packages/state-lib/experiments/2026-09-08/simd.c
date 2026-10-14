// All kernels compute the same count, exact integer sum, and first cap IDs in source order.
// Input contract: uint32 amounts, total <= 2^53, independent read-only input/output regions.
#include <stdint.h>
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif
typedef uint32_t u32; typedef uint64_t u64;
#define EX(name) __attribute__((export_name(name)))

EX("aos") void aos(const u32* restrict rows,u32 n,u32 minimum,u32* restrict out,u32 cap,double* restrict result) {
  u32 count=0; double sum=0;
  for(u32 i=0;i<n;i++) if(rows[i*4+2]==1 && rows[i*4+1]>=minimum){
    if(count<cap)out[count]=rows[i*4]; count++; sum+=rows[i*4+1];
  }
  result[0]=count;result[1]=sum;
}
EX("soa") void soa(const u32* restrict ids,const u32* restrict amounts,const u32* restrict flags,u32 n,u32 minimum,u32* restrict out,u32 cap,double* restrict result){
  u32 count=0;u64 sum=0;
  for(u32 i=0;i<n;i++)if(flags[i]==1 && amounts[i]>=minimum){
    if(count<cap)out[count]=ids[i];count++;sum+=amounts[i];
  }
  result[0]=count;result[1]=(double)sum;
}
// Separate reduction from variable-length compaction; do not rely on floating point reassociation.
__attribute__((noinline)) static void aggregate(const u32* restrict amounts,const u32* restrict flags,u32 n,u32 minimum,double* restrict result){
  u32 count=0;u64 sum=0;
  for(u32 i=0;i<n;i++){
    u32 yes=(flags[i]==1) & (amounts[i]>=minimum);
    count+=yes;sum+=yes?amounts[i]:0;
  }
  result[0]=count;result[1]=(double)sum;
}
EX("split") void split(const u32* restrict ids,const u32* restrict amounts,const u32* restrict flags,u32 n,u32 minimum,u32* restrict out,u32 cap,double* restrict result){
  aggregate(amounts,flags,n,minimum,result);
  u32 written=0;
  for(u32 i=0;i<n && written<cap;i++)if(flags[i]==1 && amounts[i]>=minimum)out[written++]=ids[i];
}
#ifdef __wasm_simd128__
EX("explicit") void explicit_simd(const u32* restrict ids,const u32* restrict amounts,const u32* restrict flags,u32 n,u32 minimum,u32* restrict out,u32 cap,double* restrict result){
  u32 i=0,count=0,written=0;u64 tail=0;
  v128_t lo=wasm_i64x2_splat(0),hi=wasm_i64x2_splat(0);
  const v128_t lower=wasm_i32x4_splat(minimum),active=wasm_i32x4_splat(1);
  for(;n-i>=4;i+=4){
    const v128_t a=wasm_v128_load(amounts+i),f=wasm_v128_load(flags+i);
    const v128_t mask=wasm_v128_and(wasm_u32x4_ge(a,lower),wasm_i32x4_eq(f,active));
    const v128_t values=wasm_v128_and(a,mask);
    lo=wasm_i64x2_add(lo,wasm_u64x2_extend_low_u32x4(values));
    hi=wasm_i64x2_add(hi,wasm_u64x2_extend_high_u32x4(values));
    u32 bits=wasm_i32x4_bitmask(mask);count+=__builtin_popcount(bits);
    while(bits && written<cap){u32 lane=__builtin_ctz(bits);out[written++]=ids[i+lane];bits&=bits-1;}
  }
  for(;i<n;i++)if(flags[i]==1 && amounts[i]>=minimum){count++;tail+=amounts[i];if(written<cap)out[written++]=ids[i];}
  const v128_t sums=wasm_i64x2_add(lo,hi);
  u64 total=wasm_u64x2_extract_lane(sums,0)+wasm_u64x2_extract_lane(sums,1)+tail;
  result[0]=count;result[1]=(double)total;
}
#endif
// Zero packing alternative for existing JS objects; these are ordinary imports, NOT builtins.
__attribute__((import_module("host"),import_name("amount"))) extern u32 host_amount(u32);
__attribute__((import_module("host"),import_name("flag"))) extern u32 host_flag(u32);
__attribute__((import_module("host"),import_name("id"))) extern u32 host_id(u32);
EX("host") void host(u32 n,u32 minimum,u32* out,u32 cap,double* result){
  u32 count=0;u64 sum=0;
  for(u32 i=0;i<n;i++){u32 amount=host_amount(i);if(host_flag(i)==1 && amount>=minimum){if(count<cap)out[count]=host_id(i);count++;sum+=amount;}}
  result[0]=count;result[1]=(double)sum;
}

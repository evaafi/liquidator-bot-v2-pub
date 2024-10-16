export const bigAbs = (value: bigint) => value > 0n ? value : -value;
export const bigIntMin = (...args) => args.reduce((m, e) => e < m ? e : m);
export const bigIntMax = (...args) => args.reduce((m, e) => e > m ? e : m);

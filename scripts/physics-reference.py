"""
Independent high-precision reference values for the rectangular-barrier
transmission coefficient, used to pin the Rust (programs/tunnel/src/physics.rs)
and TypeScript (packages/sdk/src/physics.ts) implementations.

Uses only the Python standard library: 50-digit `decimal` arithmetic and the
textbook form T = [1 + V0^2 sinh^2(k a) / (4 E (V0 - E))]^-1 with
k = sqrt(V0 - E) (units with hbar^2 / 2m = 1). Deliberately a different
formula from the implementations, which use the sinh(x)/x form.

    python scripts/physics-reference.py
"""
from decimal import Decimal as D, getcontext

getcontext().prec = 50


def sinh(x: D) -> D:
    return (x.exp() - (-x).exp()) / 2


def transmission(e: D, v0: D, a: D) -> D:
    q = v0 - e
    k = q.sqrt()
    s = v0 * v0 * sinh(k * a) ** 2 / (4 * e * q)
    return 1 / (1 + s)


CASES = [
    ("0.5", "1.0", "1.0"),
    ("0.2", "1.0", "0.9"),
    ("0.8", "4.0", "1.5"),
    ("3.2", "4.0", "1.5"),
    ("1.0", "2.0", "3.0"),
    ("0.05", "10.0", "2.0"),
]

if __name__ == "__main__":
    for e, v0, a in CASES:
        t = transmission(D(e), D(v0), D(a))
        print(f"({e}, {v0}, {a}, {t:.16e}),  ppb={int(t * D(10**9) + D('0.5'))}")

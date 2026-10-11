//! Quantum tunneling through a one-dimensional rectangular potential barrier.
//!
//! Units: normalized so that ħ²/2m = 1. Then k = √E outside the barrier and
//! κ = √(V₀ − E) inside it. For an electron with a length unit of 1 Å the
//! energy unit is ħ²/(2mₑ·Å²) ≈ 3.81 eV.
//!
//! For 0 < E < V₀ the exact transmission coefficient is
//!
//! ```text
//! T = [1 + V₀² sinh²(κa) / (4E(V₀ − E))]⁻¹
//! ```
//!
//! evaluated here in the algebraically equivalent, numerically stable form
//!
//! ```text
//! T = 1 / (1 + V₀² a² f(x)² / 4E),   x = a√|V₀ − E|,   f(x) = sinh(x)/x  (E < V₀)
//!                                                       f(x) = sin(x)/x   (E > V₀)
//!                                                       f    = 1          (E = V₀)
//! ```
//!
//! which has no 0/0 at E → V₀ (limit T = 1/(1 + V₀a²/4)) and tends to 0 as
//! E → 0. Mirrored by `packages/sdk/src/physics.ts`; the off-chain mirror is
//! also checked against an independent transfer-matrix solution.
//!
//! Only `update_params` / `initialize` evaluate this (soft-float is costly);
//! the resulting probabilities are stored as integers and every outcome
//! comparison is pure integer math.

use crate::constants::{MAX_TRANSMISSION_PPB, MIN_TRANSMISSION_PPB, PPB};

/// sinh(x)/x, accurate near 0.
fn sinhc(x: f64) -> f64 {
    if x < 1e-4 {
        1.0 + x * x / 6.0
    } else {
        libm::sinh(x) / x
    }
}

/// sin(x)/x, accurate near 0.
fn sinc(x: f64) -> f64 {
    if x < 1e-4 {
        1.0 - x * x / 6.0
    } else {
        libm::sin(x) / x
    }
}

/// Transmission probability T(E, V₀, a) in normalized units. Returns 0 for
/// non-positive E or invalid inputs.
pub fn transmission(e: f64, v0: f64, a: f64) -> f64 {
    if !(e > 0.0) || !(v0 > 0.0) || !(a > 0.0) {
        return 0.0;
    }
    let d = v0 - e;
    let f = if d > 0.0 {
        sinhc(a * libm::sqrt(d))
    } else if d < 0.0 {
        sinc(a * libm::sqrt(-d))
    } else {
        1.0
    };
    let s = v0 * v0 * a * a * f * f / (4.0 * e);
    1.0 / (1.0 + s)
}

/// Probability in parts per billion for fixed-point protocol inputs:
/// `height_milli` = V₀×1000, `width_milli` = a×1000, `energy_bps` = E/V₀ in bps.
/// Rounded half-up; `None` if outside the protocol's probability bounds.
pub fn transmission_ppb(height_milli: u32, width_milli: u32, energy_bps: u16) -> Option<u32> {
    let v0 = height_milli as f64 / 1000.0;
    let a = width_milli as f64 / 1000.0;
    let e = v0 * energy_bps as f64 / 10_000.0;
    let t = transmission(e, v0, a);
    let ppb = libm::floor(t * PPB as f64 + 0.5);
    if !(ppb >= MIN_TRANSMISSION_PPB as f64 && ppb <= MAX_TRANSMISSION_PPB as f64) {
        return None;
    }
    Some(ppb as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reference values computed independently with 50-digit decimal arithmetic
    // (scripts/physics-reference.py) from the textbook sinh² form.
    const REFERENCE: &[(f64, f64, f64, f64)] = &[
        // (E, V0, a, T)
        (0.5, 1.0, 1.0, 6.2929027363485367e-1),
        (0.2, 1.0, 0.9, 4.4424779662549124e-1),
        (0.8, 4.0, 1.5, 1.1924150122812960e-2),
        (3.2, 4.0, 1.5, 1.6774375972769008e-1),
        (1.0, 2.0, 3.0, 9.8660371654401913e-3),
        (0.05, 10.0, 2.0, 2.6377138919177162e-7),
    ];

    #[test]
    fn matches_high_precision_reference() {
        for &(e, v0, a, t) in REFERENCE {
            let got = transmission(e, v0, a);
            assert!(((got - t) / t).abs() < 1e-12, "T({e},{v0},{a}) = {got}, expected {t}");
        }
    }

    #[test]
    fn limits_and_edge_cases() {
        // E → V₀: T → 1 / (1 + V₀a²/4), continuous from both sides.
        let (v0, a) = (2.0, 1.3);
        let at = transmission(v0, v0, a);
        assert!((at - 1.0 / (1.0 + v0 * a * a / 4.0)).abs() < 1e-15);
        assert!((transmission(v0 - 1e-9, v0, a) - at).abs() < 1e-8);
        assert!((transmission(v0 + 1e-9, v0, a) - at).abs() < 1e-8);
        // E → 0: T → 0.
        assert!(transmission(1e-12, v0, a) < 1e-10);
        assert_eq!(transmission(0.0, v0, a), 0.0);
        assert_eq!(transmission(-1.0, v0, a), 0.0);
        // Bounded in [0, 1] and monotone in E below the barrier.
        let mut prev = 0.0;
        for i in 1..1000 {
            let t = transmission(v0 * i as f64 / 1000.0, v0, a);
            assert!((0.0..=1.0).contains(&t));
            assert!(t >= prev, "not monotone at step {i}");
            prev = t;
        }
        // Resonance above the barrier: sin(x) = 0 ⇒ perfect transmission.
        let x = core::f64::consts::PI;
        let e = v0 + (x / a) * (x / a);
        assert!((transmission(e, v0, a) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn wider_or_taller_barriers_transmit_less() {
        assert!(transmission(0.5, 1.0, 1.5) < transmission(0.5, 1.0, 1.0));
        assert!(transmission(0.5, 2.0, 1.0) < transmission(0.5, 1.0, 1.0));
    }

    #[test]
    fn ppb_fixed_point() {
        assert_eq!(transmission_ppb(1_000, 900, 2_000), Some(444_247_797));
        assert_eq!(transmission_ppb(4_000, 1_500, 2_000), Some(11_924_150));
        assert_eq!(transmission_ppb(4_000, 1_500, 8_000), Some(167_743_760));
        // Out of bounds: practically opaque barrier.
        assert_eq!(transmission_ppb(20_000, 5_000, 500), None);
    }
}

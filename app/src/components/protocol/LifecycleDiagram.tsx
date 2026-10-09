/** Round state machine. Every arrow is a program instruction; dashed arrows are permissionless recovery. */
export function LifecycleDiagram() {
  const states = [
    { id: "UPCOMING", x: 20, color: "#8392A5", note: "scheduled" },
    { id: "OPEN", x: 150, color: "#31D9F5", note: "deposits" },
    { id: "CLOSED", x: 280, color: "#F5C26B", note: "seed fixed" },
    { id: "AWAITING RANDOMNESS", x: 410, color: "#9B75FF", note: "ORAO VRF" },
    { id: "RESOLVING", x: 590, color: "#4378FF", note: "settle × N" },
    { id: "SETTLED", x: 720, color: "#45E6B0", note: "claims" },
  ];
  const w = [110, 110, 110, 160, 110, 110];
  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 850 190" className="min-w-[720px]" role="img" aria-label="Round lifecycle: upcoming, open, closed, awaiting randomness, resolving, settled; any stalled stage can fail into full refund after a timeout.">
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 8 4 0 8z" fill="#56657A" />
          </marker>
          <marker id="arr-r" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 8 4 0 8z" fill="#FF7285" />
          </marker>
        </defs>
        {states.map((s, i) => (
          <g key={s.id}>
            <rect x={s.x} y={30} width={w[i]} height={46} rx={9} fill="#0A0F16" stroke={s.color} strokeOpacity={0.5} />
            <text x={s.x + w[i] / 2} y={51} textAnchor="middle" fill={s.color} fontFamily="var(--font-mono)" fontSize="10.5" letterSpacing="1">
              {s.id}
            </text>
            <text x={s.x + w[i] / 2} y={66} textAnchor="middle" fill="#8392A5" fontFamily="var(--font-mono)" fontSize="9.5">
              {s.note}
            </text>
            {i < states.length - 1 && <line x1={s.x + w[i] + 2} y1={53} x2={states[i + 1].x - 3} y2={53} stroke="#56657A" markerEnd="url(#arr)" />}
          </g>
        ))}
        {/* failure */}
        <rect x={410} y={128} width={160} height={42} rx={9} fill="#0A0F16" stroke="#FF7285" strokeOpacity={0.5} />
        <text x={490} y={147} textAnchor="middle" fill="#FF7285" fontFamily="var(--font-mono)" fontSize="10.5" letterSpacing="1">
          FAILED
        </text>
        <text x={490} y={161} textAnchor="middle" fill="#8392A5" fontFamily="var(--font-mono)" fontSize="9.5">
          100% refund · no fee
        </text>
        {[205, 335, 490].map((x) => (
          <path key={x} d={`M${x} 78 C ${x} 110, ${x < 490 ? x + 60 : 490} ${x < 490 ? 120 : 110}, ${x < 490 ? 408 : 490} ${x < 490 ? 140 : 126}`} fill="none" stroke="#FF7285" strokeOpacity={0.55} strokeDasharray="3 4" markerEnd="url(#arr-r)" />
        ))}
        <text x={20} y={146} fill="#56657A" fontFamily="var(--font-mono)" fontSize="9.5">
          timeout without randomness →
        </text>
        <text x={20} y={20} fill="#56657A" fontFamily="var(--font-mono)" fontSize="9.5">
          open_round · close_round · request_randomness · reveal_randomness · settle_position · finalize_round · claim · sweep_round
        </text>
      </svg>
    </div>
  );
}

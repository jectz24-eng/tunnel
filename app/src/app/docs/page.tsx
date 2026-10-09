import type { Metadata } from "next";
import { DocsToc } from "./DocsToc";

export const metadata: Metadata = { title: "Documentation" };

const SECTIONS = [
  ["introduction", "Introduction"],
  ["science", "Quantum tunnelling science"],
  ["mining", "How mining works"],
  ["barriers", "Barrier probabilities"],
  ["commitments", "SOL commitments"],
  ["sol-rewards", "SOL reward distribution"],
  ["token-rewards", "Token reward distribution"],
  ["rounds", "Mining rounds"],
  ["randomness", "Randomness verification"],
  ["contracts", "Smart contract architecture"],
  ["risks", "Risk disclosures"],
  ["fees", "Protocol fees"],
  ["wallet-security", "Wallet security"],
  ["tokenomics", "Tokenomics"],
  ["admin", "Administrative controls"],
  ["audit", "Audit status"],
  ["deployment", "Deployment status"],
  ["faq", "FAQ"],
] as const;

export default function DocsPage() {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <DocsToc sections={SECTIONS as unknown as [string, string][]} />
      <article className="prose-doc min-w-0 max-w-[760px]">
        <div className="label text-cyan">Documentation</div>
        <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-[-0.02em] text-fg">TUNNEL protocol</h1>
        <p className="mt-4 text-[16px]">
          The complete reference for how TUNNEL works, what is and isn&apos;t guaranteed, and how to verify every outcome yourself.
        </p>

        <h2 id="introduction">Introduction</h2>
        <p>
          TUNNEL ($TUNNEL) is a quantum-inspired stochastic mining protocol on Solana. Participants commit SOL to “particles” and aim them at one of three
          energy barriers. Every 60 seconds a round resolves: each particle either tunnels through its barrier or is reflected. Successful particles share
          95% of the round&apos;s SOL pool and the round&apos;s $TUNNEL emission, in proportion to the reward weight of the barrier they crossed.
        </p>
        <p>
          <strong className="text-fg">TUNNEL uses classical, verifiable randomness and a probability model inspired by quantum tunnelling. It does not use
          quantum hardware or perform quantum computation.</strong> All financial outcomes are determined by a Solana program. The website and its animations
          only display results; they never decide them.
        </p>

        <h2 id="science">Quantum tunnelling science</h2>
        <p>
          In classical mechanics a particle with energy <code>E</code> cannot cross a potential barrier of height <code>V₀ &gt; E</code>. In quantum mechanics the
          particle is described by a wavefunction <code>ψ</code>. Inside the barrier the wavefunction does not vanish; it decays exponentially as{" "}
          <code>e^(−κx)</code>, where <code>κ = √(2m(V₀ − E))/ħ</code>. If the barrier is thin enough, a nonzero amplitude reaches the far side, so the particle
          has a probability of being detected there. For a wide barrier the transmission probability is approximately <code>T ≈ e^(−2κd)</code>, where{" "}
          <code>d</code> is the barrier width.
        </p>
        <p>
          The effect is real and important: it powers nuclear fusion in stars, alpha decay, tunnel diodes, flash memory, and the scanning tunnelling microscope.
          The chamber visualization on this site draws the stationary solution of the 1-D rectangular barrier problem. It shows the incident and reflected wave
          on the left, the evanescent decay inside the barrier, and a transmitted wave of amplitude <code>√T</code> on the right.
        </p>
        <p>
          TUNNEL borrows the idea, not the physics. The three barriers&apos; transmission probabilities are protocol configuration values chosen for the game, not
          measurements of any physical system.
        </p>

        <h2 id="mining">How mining works</h2>
        <ul>
          <li>Connect a Solana wallet (Phantom, Solflare or any Wallet Standard wallet).</li>
          <li>Choose a barrier and a number of particles. Each particle costs 0.01 SOL and is one mining attempt.</li>
          <li>Review the confirmation screen and approve the transaction in your wallet. Your SOL moves into the current round&apos;s program-owned escrow.</li>
          <li>When the 60-second deposit window ends, the round closes and requests randomness from ORAO VRF.</li>
          <li>Once randomness is revealed, every particle&apos;s fate is derived onchain and the round settles.</li>
          <li>Claim your SOL reward (or refund) and $TUNNEL in one transaction, at any time after settlement.</li>
        </ul>

        <h2 id="barriers">Barrier probabilities</h2>
        <table>
          <thead>
            <tr>
              <th>Barrier</th>
              <th>Transmission probability</th>
              <th>Reward weight</th>
              <th>Expected weight / particle</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>I · Low energy</td><td>65%</td><td>1×</td><td>0.65</td></tr>
            <tr><td>II · Medium energy</td><td>30%</td><td>2×</td><td>0.60</td></tr>
            <tr><td>III · High energy</td><td>10%</td><td>5×</td><td>0.50</td></tr>
          </tbody>
        </table>
        <p>
          These are the launch values. Probabilities and weights are governed protocol parameters (bounded onchain: transmission 0.01%–99.99%, weight 1–1000).
          Each round copies the current parameters when it is opened, <em>before</em> it can accept any deposit. An admin change can therefore never alter the odds
          of a round you have already entered. The exact parameters of every round are stored in its account and shown on its verification page.
        </p>

        <h2 id="commitments">SOL commitments</h2>
        <ul>
          <li>Particle cost: 0.01 SOL. Minimum deployment: one particle.</li>
          <li>Deposits are accepted only while <code>open_ts ≤ chain time &lt; close_ts</code>. Late transactions are rejected by the program, even if nobody has closed the round yet.</li>
          <li>Each wallet may hold up to 200 particles per round (spread across any barriers), which bounds settlement compute.</li>
          <li>The first deposit in a round creates a small position account (~0.0011 SOL rent). Its rent is returned to you when you claim.</li>
          <li>SOL goes to the round&apos;s escrow account, a program-derived address. There is no manually controlled deposit address.</li>
        </ul>

        <h2 id="sol-rewards">SOL reward distribution</h2>
        <p>At settlement, integer arithmetic only:</p>
        <pre><code>{`fee            = floor(pool × 500 / 10_000)        → treasury
distributable  = pool − fee                          (95%)
weight(p)      = Σ_b successes(p, b) × weight_b
payout(p)      = floor(distributable × weight(p) / Σ weight)`}</code></pre>
        <p>
          A successful Barrier III particle carries five times the weight of a successful Barrier I particle in the same round. Rounding is always down, so the
          program can never pay out more than the pool. The leftover dust (at most one lamport per participant) goes to the treasury when the round is swept.
        </p>
        <h3>When nobody tunnels</h3>
        <p>
          The 95% distributable pool is not confiscated. It is refunded pro rata to deposits: <code>floor(distributable × deposit(p) / pool)</code>. Only the
          disclosed 5% fee is retained.
        </p>
        <h3>When a round fails</h3>
        <p>If randomness is not revealed within the round&apos;s timeout (10 minutes at launch), anyone can mark the round failed and every participant can reclaim 100% of their deposit. No fee is taken.</p>

        <h2 id="token-rewards">Token reward distribution</h2>
        <p>
          Each round receives a $TUNNEL emission budget when it is opened, taken from the funded mining reserve. The schedule declines exponentially:
        </p>
        <pre><code>{`emission(round) = min(reserve_available,
                      416 × 0.999^floor(round / 1440))   $TUNNEL`}</code></pre>
        <p>
          That is 416 $TUNNEL per round, multiplied by 0.999 every 1,440 rounds (about a day). The series sums to about 599M, under the 600M reserve. Successful
          particles split the budget by the same weights as SOL: <code>floor(budget × weight(p) / Σ weight)</code>. If nobody tunnels, or the round fails,
          the whole budget returns to the reserve. Rounding dust also returns to the reserve at sweep. The program can never budget more than the reserve
          actually holds.
        </p>

        <h2 id="rounds">Mining rounds</h2>
        <table>
          <thead>
            <tr><th>State</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td>UPCOMING</td><td>Scheduled to start when the current round ends. Parameters already snapshotted.</td></tr>
            <tr><td>OPEN</td><td>Accepting deposits until <code>close_ts</code>.</td></tr>
            <tr><td>CLOSED</td><td>Window ended; the VRF seed is fixed from the latest slot hash.</td></tr>
            <tr><td>AWAITING RANDOMNESS</td><td>Randomness requested from ORAO VRF.</td></tr>
            <tr><td>RESOLVING</td><td>Randomness revealed; positions are being settled (one instruction per position).</td></tr>
            <tr><td>SETTLED</td><td>Fee paid, payouts fixed, claims open.</td></tr>
            <tr><td>FAILED</td><td>Stalled past the timeout; 100% refunds available.</td></tr>
          </tbody>
        </table>
        <p>
          Every transition is a permissionless program instruction. The project runs a keeper service that submits them promptly, but anyone can. If the keeper
          is offline, rounds pause in their current state; they are never skipped, and no deposits are accepted into expired rounds.
        </p>

        <h2 id="randomness">Randomness verification</h2>
        <h3>Source and trust assumptions</h3>
        <p>
          Randomness comes from <a href="https://github.com/orao-network/solana-vrf" target="_blank" rel="noreferrer">ORAO VRF v2</a> (program{" "}
          <code>VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y</code>). ORAO fulfillment authorities each sign the request seed with Ed25519. The ORAO program
          verifies the signatures onchain and combines them once a Byzantine quorum is reached. The output is unpredictable to anyone who does not hold a quorum of
          ORAO authority keys. You are trusting that ORAO&apos;s authorities do not collude with a participant. Withholding randomness cannot steal funds: the
          round fails and is fully refunded. This is not fully trustless randomness, and we do not claim it is.
        </p>
        <h3>Lifecycle</h3>
        <ul>
          <li><code>close_round</code> runs only after the deposit window ends. It computes <code>seed = sha256(&quot;TUNNEL/vrf-seed/v1&quot; ‖ program ‖ round ‖ round_id ‖ slot ‖ slot_hash)</code> from the newest SlotHashes entry. The seed does not exist while deposits are possible, and a cranker cannot grind it.</li>
          <li><code>request_randomness</code> asks ORAO for that seed. If anyone already requested the same seed directly, no new request is needed: the output depends only on the seed.</li>
          <li><code>reveal_randomness</code> checks that the account is ORAO&apos;s PDA for this exact seed and is owned by ORAO. It then copies the 64-byte result into the round. Each round has one seed, so randomness cannot be replayed across rounds.</li>
          <li>Timeout: if no randomness arrives within the snapshotted timeout, <code>recover_round</code> fails the round with full refunds. A late fulfillment cannot revive it.</li>
        </ul>
        <h3>Randomness → outcome</h3>
        <pre><code>{`draw(p, b, i) = u64_le( sha256( "TUNNEL/particle/v1"
                               ‖ randomness[64]
                               ‖ u64_le(round_id)
                               ‖ owner[32]
                               ‖ u8(barrier)
                               ‖ u32_le(i) )[0..8] )

tunnels ⇔ draw < floor(transmission_bps × 2^64 / 10_000)`}</code></pre>
        <p>
          Comparing a uniform 64-bit draw against a scaled threshold avoids modulo bias. The deviation from the exact probability is below 2⁻⁶⁴. Each
          particle&apos;s draw is independent, deterministic and reproducible. The program only hashes the particles of the position being settled, so
          computation stays bounded.
        </p>
        <h3>Verify it yourself</h3>
        <ul>
          <li>Open any round&apos;s page (<code>/rounds/&lt;id&gt;</code>). Your browser recomputes every particle from the onchain randomness and compares the results with the program&apos;s records.</li>
          <li>To check independently, read the Round account (randomness, barriers) and each Position account or <code>PositionSettled</code> event, then apply the formula above with any SHA-256 implementation.</li>
          <li>Check the randomness itself in ORAO&apos;s request account for the round&apos;s seed. It is linked from the round page.</li>
        </ul>

        <h2 id="contracts">Smart contract architecture</h2>
        <p>One Anchor program. Its accounts are all program-derived addresses:</p>
        <table>
          <thead><tr><th>Account</th><th>Seeds</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td>Protocol</td><td><code>[&quot;protocol&quot;]</code></td><td>Config, admin, treasury, mint, reserve accounting, totals</td></tr>
            <tr><td>Reward vault</td><td><code>[&quot;reward_vault&quot;]</code></td><td>SPL token account holding the $TUNNEL mining reserve</td></tr>
            <tr><td>Round</td><td><code>[&quot;round&quot;, id]</code></td><td>Parameter snapshot, deposits, VRF seed, randomness, settlement and claim accounting</td></tr>
            <tr><td>Round vault</td><td><code>[&quot;round_vault&quot;, id]</code></td><td>The round&apos;s SOL escrow</td></tr>
            <tr><td>Position</td><td><code>[&quot;position&quot;, id, owner]</code></td><td>A wallet&apos;s particles and outcomes for one round (closed on claim)</td></tr>
            <tr><td>Treasury vault</td><td><code>[&quot;treasury_vault&quot;]</code></td><td>Accumulates fees and swept dust; forwards only to the configured treasury</td></tr>
          </tbody>
        </table>
        <p>
          Instructions: <code>initialize</code>, <code>update_params</code>, <code>set_paused</code>, <code>set_treasury</code>, <code>propose_admin</code>,{" "}
          <code>accept_admin</code>, <code>fund_reserve</code>, <code>open_round</code>, <code>deploy_particles</code>, <code>close_round</code>,{" "}
          <code>request_randomness</code>, <code>reveal_randomness</code>, <code>settle_position</code>, <code>finalize_round</code>, <code>recover_round</code>,{" "}
          <code>claim</code>, <code>sweep_round</code>, <code>withdraw_fees</code>. Every state change emits an event for indexing. All arithmetic is checked; products use 128-bit intermediates.
        </p>
        <p>
          Off chain, a keeper submits the permissionless cranks and indexes events into PostgreSQL. That database powers history, statistics and the leaderboard.
          It is never the authority for funds: claimable amounts are always read from chain, and the program verifies every claim.
        </p>

        <h2 id="risks">Risk disclosures</h2>
        <ul>
          <li><strong className="text-fg">You can lose some or all of the SOL you commit.</strong> If none of your particles tunnel while others&apos; do, you receive nothing from that round.</li>
          <li>A successful tunnel does not guarantee receiving more SOL than you deposited. Your share depends on everyone else&apos;s deposits and outcomes in the round.</li>
          <li>The expected SOL return per round is below 100% of deposits because of the 5% protocol fee. This is not mining income, interest, or yield.</li>
          <li>$TUNNEL has no guaranteed value and may have no market.</li>
          <li>Smart contract risk: the program has <strong className="text-fg">not been independently audited</strong>. Bugs could cause loss of funds.</li>
          <li>Randomness depends on ORAO VRF&apos;s authorities (see above). Solana network outages can delay rounds.</li>
          <li>The program is upgradeable by its upgrade authority, which can change program logic. See administrative controls.</li>
          <li>Participation may be restricted or illegal in your jurisdiction. You are responsible for compliance.</li>
        </ul>

        <h2 id="fees">Protocol fees</h2>
        <p>
          5% of each settled round&apos;s SOL pool moves, in the <code>finalize_round</code> instruction, into a program-owned treasury vault. Anyone can call{" "}
          <code>withdraw_fees</code> to forward the vault&apos;s balance to the configured treasury wallet, and to no other address. Routing fees through a rent-exempt vault
          means the state of the treasury wallet can never block settlement. The fee is snapshotted per round and capped
          onchain at 10%. Failed rounds pay no fee. Solana network fees (~0.000005 SOL per signature) and position rent (refunded on claim) are separate. The
          crank pays ORAO&apos;s request fee.
        </p>

        <h2 id="wallet-security">Wallet security</h2>
        <ul>
          <li>TUNNEL never asks for your seed phrase or private key. Anyone who does is attempting theft.</li>
          <li>Every transaction is built by the app and shown by your wallet before you approve it. Nothing is submitted automatically.</li>
          <li>&ldquo;Verify ownership&rdquo; signs a plain-text message. It is not a transaction, moves no funds and grants no spending authority.</li>
          <li>Deposits only ever go to the program through <code>deploy_particles</code>. Never send SOL to an address someone gives you.</li>
          <li>Check that you are on the correct network. This deployment&apos;s cluster is shown in the header.</li>
        </ul>

        <h2 id="tokenomics">Tokenomics</h2>
        <p>
          Total supply 1,000,000,000 $TUNNEL (SPL token, 6 decimals). 600,000,000 are proposed as the mining reserve and held by the program&apos;s reward vault.
          The remaining 400,000,000 are <strong className="text-fg">unallocated, pending owner approval of final tokenomics</strong>. No team, investor or treasury
          allocation has been decided. See the <a href="/tokenomics">Tokenomics page</a> for live values and addresses.
        </p>

        <h2 id="admin">Administrative controls</h2>
        <p>The admin key (intended to be a multisig before mainnet) can:</p>
        <ul>
          <li>Update parameters for future rounds only, within hard onchain bounds (fee ≤ 10%, odds 0.01%–99.99%, and so on).</li>
          <li>Pause new rounds and deposits. Pausing never blocks closing, settlement, claims or refunds.</li>
          <li>Change the treasury address, and hand over admin through a two-step propose/accept.</li>
        </ul>
        <p>
          The admin <strong className="text-fg">cannot</strong> withdraw escrowed SOL or the $TUNNEL reserve, alter a round&apos;s snapshotted parameters, or change
          outcomes. No instruction exists for any of these. Separately, the program&apos;s <em>upgrade authority</em> can deploy new program code. That is the
          strongest power in the system and is disclosed as an unresolved risk until it is placed under a multisig with a timelock, or revoked.
        </p>

        <h2 id="audit">Audit status</h2>
        <p>
          <strong className="text-amber">Not audited.</strong> The program has an internal security review, threat model and unresolved-risk register (in the
          repository&apos;s <code>docs/</code> folder) and an automated test suite. None of these replace an independent external audit, which must happen before
          any mainnet deployment.
        </p>

        <h2 id="deployment">Deployment status</h2>
        <p>
          TUNNEL is built for and tested on Solana devnet, where SOL has no monetary value. Mainnet configuration exists but is disabled. Mainnet deposits require
          explicit owner authorization and an independent audit. If this site shows the program as “not initialized”, it has not yet been deployed to the cluster the
          site is configured for.
        </p>

        <h2 id="faq">FAQ</h2>
        <h3>Is this real quantum computing?</h3>
        <p>No. It is a game of chance whose odds are inspired by quantum tunnelling. Randomness comes from a classical verifiable random function.</p>
        <h3>Can the team change the odds after I deposit?</h3>
        <p>No. Odds are copied into each round before it accepts deposits, and no instruction can modify a round&apos;s snapshot.</p>
        <h3>What happens if the website or keeper goes down?</h3>
        <p>Your funds stay in program escrow. Anyone can submit the round instructions. If randomness never arrives, the round becomes fully refundable after the timeout.</p>
        <h3>Do unclaimed rewards expire?</h3>
        <p>No. You can come back after any number of rounds and claim each settled position.</p>
        <h3>Do the animations show my real results?</h3>
        <p>
          On the Mine page, yes. The chamber shows the particles actually deployed in the round, and after settlement it replays each particle&apos;s verified
          outcome. The homepage chamber is an illustrative simulation and is labelled as such.
        </p>
        <h3>Why did I receive less SOL than I deposited even though a particle tunnelled?</h3>
        <p>Your payout is your share of the round&apos;s weighted successes. If many others also tunnelled, your share of the 95% pool can be smaller than your deposit.</p>
      </article>
    </div>
  );
}

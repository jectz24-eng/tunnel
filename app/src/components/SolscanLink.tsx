import { explorerAddress } from "@/lib/config";

/**
 * Small "Solscan ↗" button for a wallet. Shots are settled off-chain (verified by seeds),
 * so the on-chain record of a player is their wallet: deposits and withdrawals.
 */
export function SolscanLink({ address, className = "" }: { address: string; className?: string }) {
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noreferrer"
      title="View wallet, deposits and withdrawals on Solscan"
      aria-label={`View ${address} on Solscan`}
      className={`inline-flex shrink-0 items-center rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-cyan/40 hover:text-cyan ${className}`}
    >
      Solscan ↗
    </a>
  );
}

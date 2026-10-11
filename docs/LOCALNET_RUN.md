# Localnet integration run

Run at 2026-10-11T10:38:37.359Z against a local solana-test-validator with the real ORAO VRF program cloned from devnet; fulfillment signed by a local authority key (scripts/local-vrf-fulfiller.ts).

Program `GyywTr1c6yTJPSxDiADUfawcpuQBQ6JPwMKaoC6WrhF9` · cycle **#2** · outcome **rewards** · tunnels Low/Medium/High = 9 / 1 / 0 · budget 20,000 · nominal 48.22

## Results
- user A: 15 particles, 55/100 energy, **9 tunneled**, paid **37.51 $TUNNEL** (matches SDK), position rent returned (-0.000237 SOL incl. token-account creation if any), duplicate claim rejected
- user B: 30 particles, 30/100 energy, **1 tunneled**, paid **10.7 $TUNNEL** (matches SDK), position rent returned (-0.000237 SOL incl. token-account creation if any), duplicate claim rejected
- every particle outcome independently recomputed from onchain randomness, and every odds-table entry recomputed from the barrier physics: **all match**
- deployment beyond the per-cycle energy allowance: **rejected**
- late deployment after `close_ts`: **rejected**

## Transactions
- fund test wallets (0.05 SOL each, for fees and refundable rent): [`3mDUWhmkGNeF5wSY…`](https://explorer.solana.com/tx/3mDUWhmkGNeF5wSYMteBGhdvx2MiAZM4TpRZgvRUbAoTnEMCg3WDLkqBLE1X5uUbckoUtzHR9i5T5i9a9nwNspnR?cluster=custom)
- user A deploys 10 × Low Barrier at E3 (68.37%): [`5REqGLY7NM26jy8B…`](https://explorer.solana.com/tx/5REqGLY7NM26jy8Bmhbe2DzyQP6Y2dddbD55RUCs67mbBqbqqQRLyWmcanbUHxkBi5jyq4ykHb5pYkmaGv6D1rVn?cluster=custom)
- user A deploys 5 × High Barrier at E5 (16.77%): [`sseZS4fP1aYKdAd5…`](https://explorer.solana.com/tx/sseZS4fP1aYKdAd5TaWfF4yX85XDCQJSPigxZCNmtG4iYT2SbZtocQAKrdNwWekmCg22YMWziBMJcRGs7KsyJcU?cluster=custom)
- user B deploys 20 × Medium Barrier at E1 (9.34%): [`5WjjpSmPwAnt28z6…`](https://explorer.solana.com/tx/5WjjpSmPwAnt28z6qu9T2hTESWySopjusFpPVJvwaSYqtvcvcG7htJX1CsRNZaXgyPYjq7dozCZxtTF6T4We1ttR?cluster=custom)
- user B deploys 10 × Medium Barrier at E1 (9.34%): [`4ELAc6QuWMpyneeg…`](https://explorer.solana.com/tx/4ELAc6QuWMpyneegfYRCEQYmTH7wgFk8z8bNANW6dVnnGQ5KoCHsKsR4CQRtJtsW8du25e9d3R6wQA2VLSyQYM1r?cluster=custom)
- close_cycle #2: [`4WKHtzKrQQcnLvyu…`](https://explorer.solana.com/tx/4WKHtzKrQQcnLvyu2hLBB2jJU35N1JPiMTToGpFDGiD2GHC1oPUTodHh2BV45GahM1vKzYoBffudRXV3i7JneAxU?cluster=custom)
- request_randomness (ORAO VRF): [`2V8sGkai6vDM7K7k…`](https://explorer.solana.com/tx/2V8sGkai6vDM7K7kKoX5QBiARHiYdU8zsyCfSF9NeY3XhjTPaASzgjxbzPmFzfHbVux28gMMSJCMGeFmwfo9KExo?cluster=custom)
- settle_position GjyZB6…: [`5MFKBrcmJm1efeRp…`](https://explorer.solana.com/tx/5MFKBrcmJm1efeRpzKeVTot9tV76uedDxy2jwcvpwvFAwr4G9Cu3bvEvo6oDJxMBMwPK1U2BB6jHQEPyjHnDQpEA?cluster=custom)
- settle_position BvPgXL…: [`5Epcuc86ZT9xbczm…`](https://explorer.solana.com/tx/5Epcuc86ZT9xbczmjKV9uYesaGVQtNSpvkRgDbKh7pn1BUxiiBuzt5uiQsQWV5PXv4XdyFgvmSeNTxbCCdL337Fw?cluster=custom)
- finalize_cycle: [`5WrjuRXvT3yV98TY…`](https://explorer.solana.com/tx/5WrjuRXvT3yV98TYgksZqqgm4g7x4wMaV3vFdDCBJSprfWekfzefnKE7RkpZCQSboLgzsqPAVs64Vfi5TCke6iCL?cluster=custom)
- claim (user A): [`2vq52YGKTPW7SX5U…`](https://explorer.solana.com/tx/2vq52YGKTPW7SX5UctCajUdKsWca68kEqi5B2bixqhpaMRNqvt8KWTbBdyf9SNWD8S9STV4a5qL7oT8hm1ZYV3sZ?cluster=custom)
- claim (user B): [`3kUj61rXVoqC2S1q…`](https://explorer.solana.com/tx/3kUj61rXVoqC2S1qgViXrkrQAZx2sfGMEqwjW18Fb3HjGsRfo1tkcSau3yCX7xy685CkcYNMhUgDq7TQHy5ZxQtX?cluster=custom)

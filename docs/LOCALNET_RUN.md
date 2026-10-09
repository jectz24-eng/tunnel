# Localnet integration run

Run at 2026-10-09T23:32:42.010Z against a local solana-test-validator with the real ORAO VRF program cloned from devnet; fulfillment signed by a local authority key (scripts/local-vrf-fulfiller.ts).

Program `GyywTr1c6yTJPSxDiADUfawcpuQBQ6JPwMKaoC6WrhF9` · round **#3** · outcome **rewards** · successes I/II/III = 8 / 0 / 0

## Results
- user A: particles 10/0/0, tunnelled 8/0/0, paid **0.152 SOL** + **416 $TUNNEL** (matches SDK), duplicate claim rejected
- user B: particles 0/4/2, tunnelled 0/0/0, paid **0 SOL** + **0 $TUNNEL** (matches SDK), duplicate claim rejected
- every particle outcome independently recomputed from onchain randomness: **all match**
- late deposit after `close_ts`: **rejected**

## Transactions
- fund test wallets (0.3 SOL each): [`qeBtknr7UPcYwC6w…`](https://explorer.solana.com/tx/qeBtknr7UPcYwC6wtssNk6pGZNaJJyCaNUDpDzic3qVLY8nG9MuxkVVjieWkkFP7sG82jv5tBMmLKVkQ8cypw2w?cluster=custom)
- user A deploys 10 particles on Barrier I: [`2csRSX2bXc37zvED…`](https://explorer.solana.com/tx/2csRSX2bXc37zvEDDYnRTbXy6FvcYEM3cq3BB3iCtXtdwwFJVa8hpvDpNr28UY3tqQw9FHwHZtZpZeVFXMkwNzoN?cluster=custom)
- user B deploys 4 on Barrier II + 2 on Barrier III: [`585BeKSMSjU1Av6P…`](https://explorer.solana.com/tx/585BeKSMSjU1Av6PFxSDy2XprW4oaexn3vqp3yP53sLsGDTZMxf71YdrRyZEC7w3cmFEaw1VJjwSyzERuTBvz9c8?cluster=custom)
- request_randomness (ORAO VRF): [`3UAd6S77934mCFQx…`](https://explorer.solana.com/tx/3UAd6S77934mCFQxZ53eCRfFVdjgP37K6TJXyhkfATkhBcY98RaGpGBXzXaGRkCrpt9mG1uMsizjVvFmEhSAugHV?cluster=custom)
- reveal_randomness: [`2nCVhoAKMw7GNFpD…`](https://explorer.solana.com/tx/2nCVhoAKMw7GNFpDqFK8xdnM4kREAYRkU7oP3CEWypMN5bDRpRAC8P7N5VJSMVch8Etw73JMbN1ugCywCnScoJXX?cluster=custom)
- settle_position LetWLE…: [`5rDNvPUeyR4SiX6d…`](https://explorer.solana.com/tx/5rDNvPUeyR4SiX6d6YVtjdNb5bzpupin4cNDcSezgfihkcpcSShhPLw9fg3hC7AyQHN7yADiCsab4Tz2eJ4aTwWQ?cluster=custom)
- settle_position 3TGyQ4…: [`4A9yEbNxdFApmXcy…`](https://explorer.solana.com/tx/4A9yEbNxdFApmXcyQSyqpRQSHFBcESbbMv9p6wW6gXn471zq3Rhs3cHMKV4t8vaJDNixeC4KJsUXZ7mNzagDp5FR?cluster=custom)
- finalize_round: [`2TbyrTUhZLRB2v7Q…`](https://explorer.solana.com/tx/2TbyrTUhZLRB2v7QfByqu4bVV8jdLLrqoJ2sHNDT6t78DSboAjK8jpcUTz4BtPwvySJ4qnTzQYfFRfpkMQWzpEZt?cluster=custom)
- claim (user A): [`5qrpuPyHhxPn4YV8…`](https://explorer.solana.com/tx/5qrpuPyHhxPn4YV8QcK8Ak1rrcQZjrVFFZ8rNS96AgC9aVbJVTDK6YDLfjbHStGVTxoUCGcefoXPZsbP7w9KKrMk?cluster=custom)
- claim (user B): [`4ZsvnydM8ChrW1TC…`](https://explorer.solana.com/tx/4ZsvnydM8ChrW1TCuwbPqidarRH4jotL7HEEuGi8qDeGaj44V3wpGm68kAYkaVxjSHQ1tmM7CbqqijLqUY1t3wCq?cluster=custom)

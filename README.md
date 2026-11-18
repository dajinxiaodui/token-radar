# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dajinxiaodui/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dajinxiaodui/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have not issued a token yet. It reads the sealed DefiLlama snapshot (758 protocols, 342 of them pre-token), ranks all 40 watchlist protocols plus 179 early finds of its own, and prices every row the way the market already prices that category's tokenized protocols: the median market-cap ÷ TVL multiple of the category, shrunk toward the snapshot-wide median (0.17×) by eight phantom peers so a lone peer cannot set a price, clamped to 0.01×–2.5×, then adjusted for 7-day TVL growth, for years run without a token, and for chain reach. No protocol name is special-cased; every row's detail view shows its full price build-up so it can be re-priced by hand.

The board leaves out three classes that do not launch tokens of their own — centralised exchanges, canonical bridges, and versioned deployments of protocols whose token already trades. Each row carries a seven-step farm plan generated from its own category playbook, chains, TVL tier and age, with concrete position sizes, gas budgets and holding windows. The static dashboard (no network, no framework) offers search, category and chain filters, six sort orders, a per-protocol detail drawer, the full peer-multiple table the prices came from, and the already-trading comparison set.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

This writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory; open `dashboard/index.html` from there to read the board.

---

<sub>Entered on [make.fun](https://make.fun/?ref=qtgxrqfw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

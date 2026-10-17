# Contributing

Issues and pull requests are welcome. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup and
architecture.

Before opening a pull request:

```bash
npm run typecheck && npm test && node --import tsx tools/savetest.ts
```

## Guidelines

- **Keep the simulation deterministic.** Code in `src/sim/` must use the world's seeded random
  number generator, never `Math.random()`, `Date` or rendering state. The save test must print
  `DETERMINISTIC ✓`.
- **Stay faithful to Red Alert.** Classic rules and the campaign follow the original game. Any
  deliberate deviation needs simulation evidence. New gameplay systems belong in the optional
  Commander rules.
- **No copyrighted assets.** Everything is generated in code. Don't add EA art, audio, names or
  trademarks.
- **Treat imported data as untrusted.** Parse it with `src/platform/untrusted.ts`, and escape any
  text that goes into HTML with `esc()` from `src/ui/dom.ts`.
- **Add a test** for every bug fix and new mechanic, in `tests/`.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

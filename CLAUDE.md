# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It reads
and controls a **Niko Home Control II** installation through the local
**Hobby API** of its Connected Controller (MQTT over TLS on port 8884, own
client on `mqtt`), turns each Niko device with a state into a Gladys device
and sends the Gladys commands back. Unofficial, not affiliated with Niko.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/model.test.js            # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js                 SDK bootstrap only
src/handlers.js          every SDK handler -> the app (shared with the tests)
src/app.js               NikoApp: lifecycle, device list -> devices and states,
                         events, commands, token expiry, badges, buttons
src/nhc2/client.js       the MQTT link: TLS, token, stable client id, device
                         list after each connection, 1 message per second,
                         reconnection, watchdog
src/nhc2/protocol.js     topics, messages, devices, grammars, UDP replies (pure)
src/nhc2/tls.js          the Niko CA (niko-ca.pem), the TLS options
src/model.js             Niko device -> Gladys device, readers, writers (pure)
src/token.js             the Hobby API token's expiry (JWT exp)
src/config.js            config_schema normalized
src/publisher.js         states within 300/min, measurement throttling, events
src/store.js             JSON documents in /data (client id, last reminder)
src/constants.js         manifest keys, core enums, limits, timings
src/i18n.js              runtime texts (en/fr) and feature names (fr/en/nl)
test/fixtures/           an installation WRITTEN in the shape of Niko's messages,
                         test-only TLS certificates
test/helpers/            simulated controller, in-memory broker
```

## Rules

- **External ids are forever**: device = `nhc:<Niko Uuid>`, the controller
  `nhc:controller`; feature = `<key>` among `binary`, `brightness`, `state`,
  `position`, `run`, `active`, `closed`, `ring`, `doorlock`, `speed`,
  `temperature`, `humidity`, `setpoint`, `mode`, `activity`, `program`,
  `overrule`, `eco`, `fan`, `power`, `production`, `from-grid`, `to-grid`,
  `token-days`. Never change how they are built.
- The manifest keys (config keys, `test_connection`, `find_controller`, the
  scene trigger `token_expiring` and its variables) are frozen: users store
  them.
- Value conventions: the Gladys side uses the enums of the core
  `server/utils/constants.js` (COVER_STATE, THERMOSTAT_MODE…, copied in
  `src/constants.js`: the SDK does not export them).
- **TLS**: trust the Niko CA of `src/nhc2/niko-ca.pem` only, verify the chain,
  skip the host name check only. Never add an option that turns verification
  off; test brokers pass their CA through the `extraCa` constructor option.
- **Niko's limits**: 5 clients, 1 new connection and 1 message per second:
  commands go through `NhcClient.control`, which merges them; never publish
  directly.
- Never log or put in a status message the token or a whole Niko message:
  errors keep the code and a short message only.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only; the UDP discovery goes
  through `gladys.scanNetwork`).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Tests never touch the network: the simulated controller and the in-memory
  broker stand in (`test/tls.test.js` uses a local TLS server on 127.0.0.1).
  The real broker path is checked with Mosquitto 2 in TLS:
  `~/gladys-integrations/e2e/niko-e2e.sh`.
- Licences: `src/nhc2/niko-ca.pem` comes from joleys/niko-home-control-II
  (MIT); openHAB (EPL-2.0) and Niko's documentation (shared under Niko's terms)
  are read as documentation only, never copied. Keep THIRD_PARTY_NOTICES.md in
  step.
- Code, comments, README in English; `docs/en.md`, `docs/fr.md` and
  `docs/nl.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.

# gladys-niko-home-control

[Gladys Assistant](https://gladysassistant.com) external integration for
**Niko Home Control II**, through the local **Hobby API** of the Connected
Controller (or the Wireless Smart Hub): lights, dimmers, sockets and switched
outputs, shutters, sun blinds, gates and garage doors, free functions, moods
and all-off, virtual flags, thermostats and HVAC thermostats, energy meters and
smart plugs, doorbell rings as events; every change pushed by the controller
at once, no cloud, no polling. Unofficial, not affiliated with Niko.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md) ·
[docs/nl.md](docs/nl.md).

> **First version (0.1), not in the Gladys store yet.** Developed and tested
> without a Niko installation: the controller was simulated from Niko's Hobby
> API documentation, also behind a real Mosquitto broker in TLS (see
> [TODO.md](TODO.md) for what still needs a real installation). Feedback and bug
> reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-niko-home-control/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (NikoApp) ⇄ src/nhc2/client.js ⇄ MQTT/TLS 8884 ⇄ Connected Controller
                                   │                      protocol.js  messages, devices, grammars (pure)
                                   │                      tls.js       the Niko CA, verified chain
                                   ├─ src/model.js      Niko devices -> Gladys devices, readers, writers (pure)
                                   ├─ src/token.js      the token's expiry (JWT exp)
                                   └─ src/publisher.js  states within 300/min, measurement throttling, events
```

- **Connection**: MQTT 3.1.1 over TLS on port 8884, user `hobby`, the Hobby
  API token (a JWT) as password, a stable client id kept in `/data`, clean
  session. The controller keeps nothing for a client: after every connection
  the integration asks `devices.list` on `hobby/control/devices/cmd`, then
  follows `hobby/control/devices/evt` (`devices.status` carries the changed
  properties only). Niko allows 5 clients, 1 new connection and 1 message per
  second: the commands of a same moment are merged into one `devices.control`
  message, one message per second at most. A watchdog on the `time.published`
  event (every 30 s) catches a link that died silently; reconnections wait 5 s
  to 5 min, 30 min after a refused token.
- **TLS**: the controller's certificate is issued by Niko's own CA. The
  integration trusts these two certificates only (the root and the "Niko
  Intermediate CA", shipped in `src/nhc2/niko-ca.pem`), verifies the chain and
  skips only the host name check, as the openHAB binding and the Home Assistant
  integration do (the certificate does not name the IP address users type).
  Verification is never turned off: a device at the address that is not a Niko
  controller is refused, and the status says so.
- **Devices**: one Gladys device per Niko "action" or device with a state,
  named after it and its location ("Spots (Living room)"); which features it
  gets depends on its model and on the properties it declares, so partial or
  newer devices still map. Hardware (modules, push buttons, detectors) has no
  state in the Hobby API and is left out.
- **Token**: the expiry (`exp` of the JWT) is a "days left" sensor on the
  controller device; from 14 days before (as openHAB), a warning in the logs,
  the status and the badge, and the `token_expiring` scene trigger once a day.
  An expired token is not used.
- **Discovery of the controller**: the "Find the controller" button asks Gladys
  to broadcast the byte `0x44` on UDP port 10000 (`udp-active-broadcast`, the
  discovery of openHAB and nhc2-coco) and reads the replies (IP address, NHC I
  or II). Niko documents a `Niko<last 4 of MAC>.local` DNS-SD name but no
  service type, so mDNS is not used.

## Reused work

- **No dependency but mqtt.js**: `@openhomekit/nhc2-hobby-api` (MIT) was
  evaluated and not used: one release in 3.5 years (2.5.0, June 2025), mqtt 4
  and RxJS 6, CommonJS only, no CA and `rejectUnauthorized: false`. The other
  npm packages are Homebridge or Node-RED plugins, or Niko Home Control I.
  MQTT through [mqtt.js](https://github.com/mqttjs/MQTT.js) 5 (MIT), the client
  of the other MQTT integrations of this author and of the Gladys core.
- **Protocol**: written from Niko's Hobby API documentation (PDF v1.4 and the
  [Motiv Building Control API](https://device-api-doc.cloud.motiv.eu/) pages,
  catalog 2.27.1) and checked against
  [joleys/niko-home-control-II](https://github.com/joleys/niko-home-control-II)
  (MIT, the Home Assistant custom integration, very active), the
  [openHAB binding](https://github.com/openhab/openhab-addons/tree/main/bundles/org.openhab.binding.nikohomecontrol)
  (EPL-2.0), [nhc2-coco](https://github.com/filipvh/nhc2-coco) (MIT) and
  [node-red-contrib-nhc2](https://github.com/PLO-NIKO/node-red-contrib-nhc2)
  (MIT), read as documentation.
- **Niko CA**: `src/nhc2/niko-ca.pem` is the `coco_ca.pem` of
  joleys/niko-home-control-II (MIT); openHAB embeds the same two certificates.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the licences and
[TODO.md](TODO.md) "Decisions" for the reasons.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run the real client and app against the SDK's fake Gladys:
`test/helpers/simController.js` is a simulated controller written from the
documentation (devices.list, devices.control applied and confirmed by
devices.status, errors, offline devices), `test/helpers/broker.js` an in-memory
MQTT broker in front of it; `test/tls.test.js` checks the TLS trust against a
real local TLS server with test certificates (`test/fixtures/tls`, made for the
tests). The fixtures (`test/fixtures/niko.js`) are an installation written in
the shape of the documented messages.

The same simulated controller also ran behind a real **Mosquitto 2** broker in
TLS (port 8884, user `hobby`, a JWT password, a test CA, connection by IP
address): `~/gladys-integrations/e2e/niko-e2e.sh` (outside the repository).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0. Niko and Niko Home Control are trademarks of Niko group nv; this
project is not affiliated with Niko. The Hobby API is offered by Niko for
private, non-commercial use.

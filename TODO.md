# TODO — Niko Home Control II v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`, `docs/nl.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the module was claimed in /t/10385 (post #214); the recap of the published
  modules is posted there, with a link to each repo.

## Status

- [x] **Milestone 1 — core** (2026-10-16): Hobby API client on mqtt.js (TLS
      8884 verified against the Niko CA, user hobby + token, stable client id,
      devices.list after every connection, devices.status events, commands
      merged at 1 message per second, reconnection 5 s → 5 min and 30 min after
      a refused token, watchdog on time.published); one device per Niko device
      with a state (relays, dimmers, motors, garage doors, routines, bell
      buttons, fans, virtual flags, thermostats and HVAC thermostats, meters,
      smart plugs, Energy Home, sensors); live power re-asked every 25 s for the
      meters created; the controller device with the token's days left, the
      14-day warning and the `token_expiring` scene trigger; badges; connection
      test; UDP discovery of the controller; manifest; docs en/fr/nl. Unit and
      app tests on a simulated controller (in-memory broker), TLS trust against
      a local TLS server, and an end-to-end run behind a real Mosquitto 2 in TLS
      (`~/gladys-integrations/e2e/niko-e2e.sh`).
- [ ] **Milestone 2 — real installations**: the points of "To check" below,
      anonymized `devices.list` dumps of real installations as fixtures.
- [ ] **Milestone 3 — more devices**: colour and tunable white lights (Color
      `hsv()`/`cwww()`, ColorMode), audio control (Sonos, Bose), access control
      and video door station (call status, ring-and-come-in), car chargers
      (charging mode, status, power), partner HVAC/ventilation/hot water
      interfaces (Range(...)/Choice(...) resolved at runtime), ProtectMode,
      notifications (`hobby/notification/evt`, alarm and notice as scene
      triggers), energy totals through the REST measurements API
      (`https://<controller>/measurements/v1`, Bearer token, same CA) as energy
      indexes, the Digital Black extension button (`Button01` presses).
- [ ] **Milestone 4 — first release**: cover image, Docker image check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).
- [ ] **Later — Niko Home Control I** (the older system, out of scope of v1):
      what the openHAB binding does, for a future port: plain TCP port 8000 to
      the IP interface 550-00508 (or a Connected Controller in an NHC I
      installation), no TLS and no authentication, line-delimited JSON. Each
      command waits for its answer: `{"cmd":"systeminfo"}`, `listlocations`,
      `listactions`, `listthermostat`, `listthermostatHVAC`, `listenergy`,
      `readtariffdata`, `getalarms`, then `{"cmd":"startevents"}`, after which
      the same socket streams `{"event":"listactions","data":[...]}`,
      `listthermostat`, `getlive`, `getalarms`. Actions:
      `{"cmd":"executeactions","id":<int>,"value1":<int>}` (relay/trigger
      100/0, dimmer 0..100 with 254 = on and 255 = off, shutter 255 up, 254
      down, 253 stop; action types 0 trigger, 1 relay, 2 dimmer, 4/5 shutter).
      Thermostats: `{"cmd":"executethermostat","id":…,"mode":…}` or
      `"overrule":<tenths of °C>,"overruletime":"HH:MM"`, values in 0.1 °C.
      Energy: `getlive`/`stoplive` per channel, `getenergydata` on a second
      socket. Discovery: the same UDP 0x44 to port 10000, byte 15 below 2 = NHC
      I (the "Find the controller" button already reports them). The Home
      Assistant core `niko_home_control` integration (library `nhc` 0.8.1, MIT)
      is NHC I only and could be the reference of such a port.

## To check on a real installation

- **TLS**: the controller's leaf certificate (CN, SAN, issuer: the "Niko
  Intermediate CA"?); `openssl s_client -connect <ip>:8884 -showcerts
-CAfile src/nhc2/niko-ca.pem` should verify. The integration logs the
  certificate CN at the first connection.
- **Token**: the CONNACK code of an expired, replaced or wrong token (4 or 5
  expected); the claims of a real token (`exp` read; `sub`, `aud`, `iss`,
  `role` unknown); the controller offline at the first use.
- **Broker limits**: 5 clients, 1 new connection and 1 message per second (Niko
  N1): does the controller drop a client that sends 2 messages in a second at
  the connection (system information, then device list)?
- **devices.list** of a real installation: the models and properties per
  firmware (2.2x), `Online` case, empty definitions (openHAB issue 21302),
  the size of a big installation.
- **devices.status**: only changed properties (as documented); the shape of
  an Online change (with or without Properties).
- **Dimmer**: Status On + Brightness in one message (the integration sends
  `[Status On, Brightness]` when the dimmer is off, as openHAB does in two
  messages); does Status On restore the previous level first?
- **Motors**: Moving and LastDirection while moving (joleys notes that
  LastDirection changes at once); Position of a gate; the sun blind direction
  (100 = open).
- **Routines**: BasicState of a free function, a mood, all-off, the PIR action
  after "Triggered"; the bell button "On" while ringing (Niko) and CallPending;
  the alarm routines' Intermediate state.
- **Thermostats**: SetpointTemperature during an overrule (the integration
  reads SetpointTemperature as the effective setpoint), OverruleTime counting
  down, Program `Cool`, HVAC ThermostatOn and OperationMode, Demand values.
- **Meters**: ReportInstantUsage deprecated on the battery clamp in catalog
  2.27.1 ("streaming" replaces it, undocumented): does live power still come?
  The sign of ElectricalPower per Flow/Segment/Inverted (a production clamp is
  published as a positive production).
- **Discovery**: the 25-byte UDP reply of a current Connected Controller and
  Wireless Smart Hub through Gladys's `udp-active-broadcast` (ephemeral source
  port: do the controllers answer to it? openHAB uses the same socket); the
  DNS-SD service type, if any (`dns-sd -B _services._dns-sd._udp local`).
- **Errors**: the `err` topics actually used (`hobby/control/devices/err`).

## Decisions

- **Not a duplicate** (checked 2026-10-16): no Niko service in the Gladys core
  (master 165e0d9, 39 services, `git grep -i niko` empty); no Niko entry in the
  store, on GitHub under the `gladys-assistant-integration` topic, or claimed
  by anyone else on the forum (pierre-gilles suggested it for Belgium in
  /t/10385 #60; the tracker lists only this repository). The Home Assistant
  core `niko_home_control` integration is NHC I only; NHC II in Home Assistant
  is the custom integration joleys/niko-home-control-II.
- **Reuse (Louis's rule)**:
  - `@openhomekit/nhc2-hobby-api` (npm, MIT in package.json, a boilerplate
    LICENSE naming someone else, hence GitHub's NOASSERTION): not used. One
    release since 2022-11 (2.5.0, 2025-06-13, car chargers), nothing since;
    mqtt ^4.3.7 (the unmaintained 4.x line) and RxJS 6, deprecated glob@7 and
    inflight in its tree (`npm audit` clean today), ES5 CommonJS only, no CA
    shipped and `rejectUnauthorized: false` in its README, an unguarded
    JSON.parse, no timeout on the device list, silent token expiry. Its
    Homebridge plugin excludes Node 24 and leaves issues unanswered.
  - Other npm packages: `node-red-contrib-nhc2` (MIT, very active, by a Niko
    employee) is Node-RED nodes, not a library, also on mqtt 4 with
    verification off; everything else is NHC I or dead.
  - So: an own client on **mqtt.js 5** (5.16.1, as gladys-aquarea and the
    Gladys core), about 400 lines, with the references read as documentation:
    Niko's Hobby API documentation (PDF v1.4 of 2025-03-25 and the Motiv
    Building Control API pages, catalog 2.27.1), joleys/niko-home-control-II
    (MIT, the most complete and active implementation), the openHAB binding
    (EPL-2.0: read only), nhc2-coco and node-red-contrib-nhc2 (MIT). Credited
    in the README and THIRD_PARTY_NOTICES.md.
- **TLS**: the CA of joleys (`coco_ca.pem`, MIT; identical to openHAB's two
  certificates and to the root Niko offers for download) is shipped in
  `src/nhc2/niko-ca.pem` and is the ONLY trust (not the public CAs); the chain
  is verified, only the host name check is skipped (`checkServerIdentity`
  returning nothing), as openHAB and the Home Assistant integration do: users
  type an IP address, and the certificate is not issued for it. No option turns
  verification off. The test brokers (unit tests, e2e) add their own test CA
  through the `extraCa` constructor option, never through the configuration.
- **Connection**: user `hobby` (also the topic prefix), the token as password,
  clean session, keepalive 60 s, MQTT 3.1.1, QoS 1 (as openHAB and nhc2-coco),
  a client id generated once and kept in `/data/state.json` (Niko asks for a
  stable, unique id); the connection test reads the live link when there is
  one (Niko allows 5 clients), else opens its own with `-test` appended.
  mqtt.js's reconnection is off: ours waits 5 s doubling to 5 min, 30 min after
  a refused token (CONNACK 4/5), always at least 1.5 s between two connections.
  A watchdog drops a link silent for 75 s (the controller publishes
  time.published every 30 s; node-red-contrib-nhc2 uses 45 s).
- **Publishing**: Niko allows 1 message per second: the system information and
  the device list at the connection go 1 s apart, and the commands wait 50 ms
  (a scene's commands go together, as nhc2-coco's 50 ms buffer) then leave in
  one `devices.control` of at most 16 devices and 32 properties, one message
  per second. A command to a device the controller reports offline is refused
  with a reason (Niko answers nothing in that case).
- **Devices**: one Gladys device per Niko Uuid; which features it gets depends
  on its Type/Model and on its PropertyDefinitions (HasStatus/CanControl), so a
  partial or newer device still maps and unknown kinds are logged once.
  Hardware without properties is left out; the controller's firmware
  (`gatewayfw`) too. The name carries the location ("Spots (Salon)").
- **Routines** (BasicState On/Off, set with "Triggered", which toggles): a
  switch that sends "Triggered" only when the wanted state differs (as the Home
  Assistant integration), plus a "Run" push button for free functions, moods,
  all-off and house mode (always "Triggered"). The PIR action is "motion
  detection enabled", not "motion detected" (Niko).
- **Events**: physical push buttons and detectors produce no event in the
  Hobby API. The bell button's ring (BasicState "On", Niko) and an access
  control's CallPending are doorbell `ring` events sent with publishStates
  (two rings are two events); everything else is a state.
- **Motors**: Niko's Position is 100 = open like Gladys; the state feature
  reads Moving + LastDirection (opening 1, closing -1, at rest 0); sun blinds
  are curtains, the others shutters. Velux and Reynaers actions get the
  open/close/stop commands only (no position).
- **Thermostats**: a setpoint from Gladys is a temporary setpoint
  (OverruleActive True + OverruleSetpoint + OverruleTime of the configured
  duration, 60 min by default as openHAB), in that order and one key per
  object (the documented form; nhc2-hobby-api's single object is avoided). The
  mode maps the program: Off, Cool, ProgN (automatic), the others heating;
  setting heating keeps Night or Eco. HVAC thermostats: ThermostatOn and
  OperationMode. The program itself is a select with Niko's choices.
- **Meters**: live power only comes for 30 s after ReportInstantUsage True:
  asked again every 25 s (openHAB's pace) for the meters created in Gladys
  only. A production clamp (Flow Producer) is an `energy-production-sensor`
  with a positive power; Energy Home uses the `grid-sensor` input/output
  powers. No energy index in milestone 1 (the totals are only in the REST API).
- **Token**: `exp` read without the key; days left rounded up while valid; from
  14 days before (openHAB), the status, the logs, the controller's badge and
  the `token_expiring` scene trigger once a day (the day kept in /data so a
  restart does not repeat it); an expired token is not used (as openHAB).
- **Discovery**: `udp-active-broadcast` of 0x44 on port 10000 (openHAB,
  nhc2-coco, node-red-contrib-nhc2), declared in the manifest. Niko documents
  a DNS-SD host name but no service type: no mDNS. A single NHC II found while
  the address is empty is saved in the configuration.
- **Gladys version**: `>=5.1.0` (scene triggers); every category and type used
  exists since 5.0.0 (checked in the core's constants of v5.0.0).
- **Languages**: the feature names follow a config select (fr by default, en,
  nl); the docs exist in English, French and Dutch (Niko is Belgian).
- **Fixtures**: written for the tests in the shape of Niko's documented
  messages (the PDF is "shared under Niko Terms and Conditions": nothing
  copied); the simulated controller (`test/helpers/simController.js`) is shared
  by the unit tests and the Mosquitto e2e.

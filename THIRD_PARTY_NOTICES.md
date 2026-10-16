# Third-party notices

## joleys/niko-home-control-II (https://github.com/joleys/niko-home-control-II)

`src/nhc2/niko-ca.pem` is the `custom_components/nhc2/nhccoco/coco_ca.pem` file
of niko-home-control-II (commit b0b2628 of 2026-09-21), unchanged: the two
public certificates of Niko's own certificate authority (the "Niko Home
Control" root and the "Niko Intermediate CA", both valid until 2037) that the
Connected Controller's TLS certificate chains to. The openHAB binding
(`src/main/resources/nikohomecontrol/certificates.properties`) embeds the very
same two certificates, and Niko offers the root for download on its Hobby API
documentation site; `test/tls.test.js` checks their fingerprints.

The rest of niko-home-control-II (its device classes and Home Assistant
entities) was read as documentation of the Hobby API behaviour (which device
models exist, which properties they carry, how routines are toggled with
"Triggered", how the live power is re-asked); no code of it is copied.

```text
MIT License

Copyright 2019 Van Ham Filip

Permission is hereby granted, free of charge,
to any person obtaining a copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom
the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Read as documentation only (no code copied)

- **Niko**: the Hobby API technical documentation (PDF v1.4, March 2025,
  "shared under Niko Terms and Conditions") and the Motiv Building Control API
  pages (https://device-api-doc.cloud.motiv.eu/, device catalog 2.27.1). The
  test fixtures are written for the tests in the shape of the documented
  messages; no text of these documents is reproduced.
- **openHAB** `org.openhab.binding.nikohomecontrol` (EPL-2.0,
  https://github.com/openhab/openhab-addons): the TLS trust (the two Niko
  certificates, no host name check), the 14-day token warning, the UDP
  discovery (0x44 to port 10000), the thermostat overrule commands, the live
  power re-asked every 25 s, the Niko Home Control I protocol summarized in
  TODO.md.
- **nhc2-coco** (MIT, https://github.com/filipvh/nhc2-coco) and
  **node-red-contrib-nhc2** (MIT, https://github.com/PLO-NIKO/node-red-contrib-nhc2):
  the command buffering (one devices.control for several devices), the
  watchdog on the 30-second time event.
- **@openhomekit/nhc2-hobby-api** (MIT, https://github.com/openhomekit/nhc2-hobby-api):
  evaluated as a dependency and not used (see TODO.md, Decisions).

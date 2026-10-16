# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added

- Niko Home Control II through the local Hobby API of the Connected Controller
  or the Wireless Smart Hub: MQTT over TLS on port 8884, the controller's
  certificate verified against Niko's own certificate authority, every change
  pushed at once, no cloud.
- Every device with a state in Discovery, named after it and its location:
  lights, dimmers (brightness), sockets and switched outputs, roll-down
  shutters, Venetian blinds, gates and sun blinds (open, close, stop,
  position), garage doors (operate, door closed), free functions, moods,
  all-off and house mode (state and a Run button), presence simulation,
  conditions, motion detection, peak and solar modes and alarm routines,
  virtual flags, fan speeds, bell buttons (every ring is an event, door lock),
  thermostats and HVAC thermostats (temperature, setpoint as a temporary
  setpoint of the configured duration, mode, program, activity, eco, fan
  speed), electricity metering clamps, smart plugs and Energy Home (power,
  production, power from and to the grid), thermometers and humidity sensors.
- The controller device: the days left before the Hobby API token expires,
  with a warning in the status, the logs and the badge from 14 days before,
  and the "Hobby API token about to expire" scene trigger once a day.
- "Find the controller" button (UDP discovery relayed by Gladys) and "Test the
  connection" button.
- Badges: a device offline for the controller, the controller not connected,
  the token about to expire.
- Feature names in French, English or Dutch; user documentation in English,
  French and Dutch.

[Unreleased]: https://github.com/LM1LC3N7/gladys-niko-home-control/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-niko-home-control/releases/tag/v0.1.1

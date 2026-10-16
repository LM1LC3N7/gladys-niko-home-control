# Niko Home Control II

This integration connects Gladys to your **Niko Home Control II** installation
through the **Hobby API** of its Connected Controller (or Wireless Smart Hub),
on your local network: no cloud, and every change made in the house (a switch
pressed, a mood started, a shutter moving) reaches Gladys at once. The lights,
dimmers, shutters, thermostats and routines of your installation show up in
the **Discovery** tab of Gladys, and Gladys controls them. Unofficial, not
affiliated with Niko.

> **Development version (0.1).** Tested against a controller simulated from
> Niko's Hobby API documentation, behind a real MQTT broker in TLS, not yet on
> a real installation. Your feedback is welcome on the GitHub repository.

## What you get

| In Niko Home Control                                                     | In Gladys                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Light (switched)                                                         | a light: on/off                                                         |
| Dimmer                                                                   | a light: on/off, brightness                                             |
| Socket, switched output, switched fan                                    | a switch: on/off                                                        |
| Roll-down shutter, Venetian blind, gate                                  | a shutter: open, close, stop, position (100 = open)                     |
| Sun blind                                                                | a curtain: open, close, stop, position                                  |
| Garage door                                                              | a button to operate it, and a door sensor (closed or open)              |
| Free function, mood, all-off, house mode                                 | a switch (active or not) and a "Run" button                             |
| Presence simulation, condition, motion detection, peak/solar mode, alarm | a switch (active or not)                                                |
| Bell button                                                              | a doorbell (every ring is an event for your scenes) and the door lock   |
| Fan (speed action)                                                       | a list of its speeds (low, medium, high, boost)                         |
| Virtual flag                                                             | a switch                                                                |
| Thermostat, touch switch thermostat, virtual thermostat                  | temperature, setpoint, mode, program, activity, temporary setpoint, eco |
| HVAC thermostat                                                          | the same, plus heating or cooling and the fan speed                     |
| Electricity metering clamp, smart plug, Energy Home                      | power (W), production, power from and to the grid; the plug's on/off    |
| Thermometer and other sensors                                            | temperature, humidity                                                   |
| The controller itself                                                    | the days left before the Hobby API token expires                        |

Each item makes **one Gladys device**, named after it and its location
("Spots (Living room)"); its Niko identifier, model and location are kept in
its parameters. The physical push buttons, modules and motion detectors are
not visible through the Hobby API (Niko only exposes what they control): to
react in Gladys to a push button, use the state of what it switches, of a free
function or of a virtual flag that the button toggles.

Not supported yet: colour and tunable white lights, audio, video door
station, access control calls, car chargers, partner heating and ventilation
units, notifications. Niko Home Control I (the older system) is not supported.

## Requirements

- A Niko Home Control **II** installation with a Connected Controller
  (550-00003) or a Wireless Smart Hub (552-00001), software 2.5.1 or later.
- The Gladys machine reaches the controller on the local network (port 8884).
  Give the controller a fixed IP address in your router.
- A **Hobby API token** (free, for private use, valid one year).

## Get the Hobby API token

- **Software 2.17 or later**: open the Niko Home Control programming
  software, connect to your installation, then **Dashboard → Manage connected
  services**. Under **Additional steps required**, choose **Manage** next to
  **Hobby API**, sign in with your Niko Home Control account, accept the
  terms, and use **Copy** to get the token.
- **Older software**: on mynikohomecontrol.niko.eu, **Connected services → Add
  a service → Hobby API**, then copy the token.

The controller must be online (connected to the Internet) the first time the
token is used. Afterwards, everything stays on your local network.

## Installation

1. In Gladys, open the integration, **Configuration**:
   - **IP address of the Connected Controller**: for example `192.168.1.50`.
     Not known? Leave it empty, save, and click **Find the controller**: Gladys
     looks for it on the network and saves its address.
   - **Hobby API token**: paste the whole token (a long text in three parts
     separated by dots).
2. Click **Test the connection**: the Niko Home Control version, the number of
   devices offered and the expiry date of the token show up.
3. Open the **Discovery** tab and add the devices you want. Their values are
   sent as soon as they are added, and every change follows at once.

## Options

- **Minimum interval between two readings of a measurement**: 10 seconds by
  default (0 to 600). Powers and temperatures can change every few seconds:
  Gladys keeps the last reading at this pace. Lights, shutters, setpoints and
  switches are never delayed.
- **Duration of a setpoint set from Gladys**: 60 minutes by default (1 to
  1439). On a Niko thermostat, a setpoint changed in Gladys is a temporary one
  (Niko calls it "overrule"); afterwards the thermostat follows its program
  again. To change the program, use the **Program** feature (Day, Night,
  Eco, Off, Prog1…).
- **Language of the feature names**: French, English or Dutch.

## Thermostats

- **Setpoint**: a temporary setpoint for the configured duration. The
  **Temporary setpoint** switch shows when one is active; turn it off to go
  back to the program at once.
- **Mode**: Off (program Off), heating (Day, Night, Eco), cooling (program
  Cool, if your thermostat has it) or automatic (the weekly programs Prog1 to
  Prog3). Setting heating while already in Night or Eco keeps that program.
  HVAC thermostats: off, heating or cooling.
- **Activity**: heating, cooling or idle, as the thermostat reports its demand.

## Meters

Niko sends the live power only for 30 seconds after it was asked: as long as
a meter or a smart plug exists in Gladys, the integration asks again every 25
seconds. Remove the device from Gladys to stop it. The energy totals are not
available through the Hobby API messages yet.

## Token expiry

The token is valid one year. The controller device shows the **days left**;
from 14 days before the expiry, the status of the integration, the badge of
the controller device and the logs warn you, and the **"Hobby API token about
to expire"** scene trigger fires once a day (with the days left and the
expiry date): use it to send yourself a message. Niko lets you renew the
token during the last month: paste the new one in the configuration. An
expired token is not used; the status says so.

## Troubleshooting

- **"The controller is unreachable"**: check its IP address and that the
  Gladys machine is on the same network. The integration retries by itself (5
  seconds, then up to 5 minutes).
- **"The controller refused the Hobby API token"**: the token expired or was
  replaced; paste a new one. The integration only retries every 30 minutes, to
  spare the controller.
- **"Its TLS certificate was not issued by Niko"**: the address is not the one
  of your controller. The integration only trusts Niko's own certificate
  authority.
- **A command has no effect**: the device may be offline for the controller
  (its badge says so). Niko accepts at most 5 applications at once on the
  Hobby API: close other ones (Home Assistant, Node-RED…) if the connection is
  refused.
- **New devices or names changed**: after you upload a new configuration to
  the controller, the integration reads the devices again; click **Scan** in
  the Discovery tab to force it.

## Privacy

The integration only talks to your controller, on your local network, with
the token you give it (kept by Gladys as a secret, never written in the logs).
The Hobby API is offered by Niko for private, non-commercial use.

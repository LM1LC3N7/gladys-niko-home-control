// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration and their scenes), the values of the Gladys core the SDK does
// not export, and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
  FIND: 'find_controller',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  TOKEN_EXPIRING: 'token_expiring',
};

/** Minimum interval between two readings of a measurement (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 600, default: 10 };

/** Duration of a setpoint set from Gladys (minutes; the thermostat's OverruleTime), mirrored by the manifest. */
export const OVERRULE_MINUTES = { min: 1, max: 1439, default: 60 };

/** Languages of the feature names. */
export const LANGUAGES = ['fr', 'en', 'nl'];

/** The Hobby API: MQTT over TLS on the Connected Controller or the Wireless Smart Hub. */
export const HOBBY_PORT = 8884;
/** The MQTT user of the Hobby API, also the first segment of every topic. */
export const HOBBY_USER = 'hobby';

/** UDP discovery of the controllers (as openHAB and nhc2-coco): one byte 0x44 to port 10000. */
export const DISCOVERY = { port: 10000, payload: 0x44, timeoutSeconds: 5 };

/** Device external id type: `ext:<selector>:nhc:<Niko Uuid>`. */
export const DEVICE_TYPE = 'nhc';
/** Platform id of the controller itself (token, versions): one per integration. */
export const CONTROLLER_ID = 'controller';

// Gladys core values (server/utils/constants.js), not exported by the SDK.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
export const THERMOSTAT_OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const LOCK_STATE = { UNLOCKED: 0, LOCKED: 1 };
export const BUTTON_PUSH = { PRESSED: 1 };
export const DOORBELL_RING = 1;

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** An MQTT message read (bytes): the device list of a big installation is a few hundred KB. */
  payloadBytes: 8 * 1024 * 1024,
  /** Devices published at once (publishDiscoveredDevices). */
  devices: 2000,
  /** Devices and properties in one devices.control message (nhc2-coco: 16 and 32). */
  controlDevices: 16,
  controlProperties: 32,
  /** Text states sent to Gladys. */
  text: 500,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** The broker accepts 1 publish per second (Niko's documentation). */
  publishGap: 1000,
  /** Commands sent within this window go in one message (nhc2-coco: 50 ms). */
  coalesce: 50,
  /** The broker accepts 1 new connection per second. */
  connectGap: 1500,
  /** MQTT connection timeout, and the wait for the device list. */
  connectTimeout: 15_000,
  listTimeout: 20_000,
  keepalive: 60,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 5 * 60_000,
  /** A refused token is retried slowly: the user has to change it. */
  authRetry: 30 * 60_000,
  /** The controller publishes time.published every 30 s: silent longer = dead link. */
  watchdog: 75_000,
  watchdogCheck: 15_000,
  /** A change of the installation (devices.added, systeminfo.published...): wait for the burst to end. */
  relistDebounce: 3000,
  /** Live power stops 30 s after ReportInstantUsage: re-asked this often (openHAB: 25 s). */
  instantUsage: 25_000,
  /** The token expiry is checked this often. */
  tokenCheck: 60 * 60_000,
  /** The connection test waits this long in all. */
  testTimeout: 30_000,
};

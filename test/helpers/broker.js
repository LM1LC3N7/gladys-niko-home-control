// -----------------------------------------------------------------------------
// Test helpers: an in-memory MQTT broker speaking the surface of an mqtt.js
// client (connect, CONNACK refusals, subscribe with + and #, publish, end),
// with the simulated controller of simController.js behind its `cmd` topics,
// and a settle() that lets the pending promises and setImmediate run.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { TOKEN } from '../fixtures/niko.js';
import { SimController } from './simController.js';

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** Does an MQTT topic match a subscription filter? */
export function matches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] === '#') {
      return true;
    }
    if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) {
      return false;
    }
  }
  return f.length === t.length;
}

/**
 * A controller behind an in-memory broker. `box.connect` is the mqtt.connect
 * of the app; `box.sim` the simulated controller; `box.published` what the
 * clients published (parsed JSON).
 */
export function fakeController({ token = TOKEN, devices } = {}) {
  const clients = new Set();
  const box = {
    token,
    clients,
    connections: [],
    published: [],
    /** The controller ignores the commands (a dead link that stays open). */
    mute: false,
    /** The host does not answer: ECONNREFUSED. */
    unreachable: false,
    deliver(topic, message) {
      const payload = Buffer.from(JSON.stringify(message));
      for (const client of clients) {
        if (client.filters.some((f) => matches(f, topic))) {
          client.emit('message', topic, payload);
        }
      }
    },
    connect(options) {
      box.connections.push(options);
      const client = new EventEmitter();
      client.filters = [];
      client.stream = {};
      client.subscribe = (filters, opts, cb) => {
        const list = Array.isArray(filters) ? filters : [filters];
        client.filters.push(...list);
        const done = typeof opts === 'function' ? opts : cb;
        setImmediate(() =>
          done?.(
            null,
            list.map((topic) => ({ topic, qos: opts?.qos ?? 0 })),
          ),
        );
      };
      client.publish = (topic, payload, opts, cb) => {
        box.published.push({ topic, message: JSON.parse(String(payload)), qos: opts?.qos });
        const done = typeof opts === 'function' ? opts : cb;
        setImmediate(() => {
          done?.(null);
          if (!box.mute && clients.has(client)) {
            box.sim.handle(topic, payload);
          }
        });
      };
      client.end = () => {
        clients.delete(client);
        client.ended = true;
      };
      setImmediate(() => {
        if (box.unreachable) {
          client.emit(
            'error',
            Object.assign(new Error(`connect ECONNREFUSED ${options.host}:${options.port}`), {
              code: 'ECONNREFUSED',
              address: options.host,
              port: options.port,
            }),
          );
          client.emit('close');
          return;
        }
        if (options.username !== 'hobby' || options.password !== box.token) {
          client.emit(
            'error',
            Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }),
          );
          client.emit('close');
          return;
        }
        clients.add(client);
        client.emit('connect', { returnCode: 0 });
      });
      return client;
    },
    /** The broker drops every client. */
    drop() {
      for (const client of clients) {
        clients.delete(client);
        client.emit('close');
      }
    },
    /** The devices.control messages received, as [uuid, { property: value }] pairs. */
    commands() {
      return box.published
        .filter((p) => p.message.Method === 'devices.control')
        .flatMap((p) =>
          p.message.Params[0].Devices.map((d) => [d.Uuid, Object.assign({}, ...d.Properties)]),
        );
    },
    count(method) {
      return box.published.filter((p) => p.message.Method === method).length;
    },
  };
  box.sim = new SimController({
    devices,
    publish: (topic, message) => box.deliver(topic, message),
  });
  return box;
}

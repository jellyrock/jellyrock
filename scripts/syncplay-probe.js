/**
 * Where a Roku's player stands against a SyncPlay group's line, measured from outside the app.
 *
 *   npm run syncplay:probe -- record --out run.jsonl             record, driving pauses and resumes
 *   npm run syncplay:probe -- record --out run.jsonl --drive seek   drive group Seeks instead
 *   npm run syncplay:probe -- record --out run.jsonl --drive none   listen only
 *   npm run syncplay:probe -- analyze run.jsonl [more.jsonl…]    summarize recorded runs
 *
 * ## Why this exists
 *
 * The app's own drift figure compares its model of the player with the group's line under its
 * own clock estimate, so it cannot see an error in either. This tool uses neither. It joins the
 * group as a silent member to hear the server's commands, and polls the Roku's ECP
 * `query/media-player` for the instants its position steps. Each step is compared with where
 * the last `Unpause` says the group is at that instant.
 *
 * ## What it needs
 *
 * - The server runs on this machine. The tool takes this machine's clock as the server's, so
 *   `record` refuses any other server (`isThisMachine()`).
 * - `RTA_SERVER_URL`, `RTA_SERVER_USER` and `RTA_SERVER_PASS` name the server, as for the RTA
 *   suite. `--roku` or `ROKU_IP` names the device. ECP needs no sign-in and no device lock.
 * - A playing group with the Roku in it, named by `--group`. The tool waits for the group to
 *   appear, gives the Roku `--settle-seconds` to load, then joins and tells the server never
 *   to wait on it.
 * - With `--drive pause` or `--drive seek`, nothing else may drive the group during the run.
 *   The seek targets reach 30 minutes into the film.
 *
 * ## What a reading is worth
 *
 * A step happened between one poll's send and the next poll's reply, and is stamped at the
 * middle of that window (`windowMs` in each record). The analysis keeps only steps of about
 * half a second between two playing readings, which is the player's own reporting interval.
 * It cannot see the TV's output delay.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import './lib/load-env.cjs';
import { resolveServer } from '../tests/rta/config.js';
import {
  authenticate,
  getJson,
  postJson,
  sessionDeviceId,
  tokenHeader,
} from '../tests/rta/lib/jellyfin.js';

/** The role this tool signs in under, so its server session never collides with a suite's. */
const ROLE = 'syncplay-probe';

/** A step counts as one position report when it is this long, in media milliseconds. */
const STEP_MIN_MS = 300;
const STEP_MAX_MS = 700;

/** Group Seek targets for `--drive seek`, in seconds. Every build under test gets the same list. */
const SEEK_TARGETS_S = [300, 900, 600, 1500, 420, 1200, 760, 1800];

/**
 * Read the player's state and position out of an ECP `query/media-player` reply.
 *
 * @param {string} xml
 * @returns {{ state: string | undefined, positionMs: number }} `positionMs` is NaN when the
 *   reply carries no position (the player is closed)
 */
export function parseMediaPlayer(xml) {
  const state = /state="(\w+)"/.exec(xml)?.[1];
  const positionMs = Number(/<position>(\d+) ms/.exec(xml)?.[1]);
  return { state, positionMs };
}

/**
 * The edge record for two polls in a row, or null when nothing changed between them.
 *
 * @param {{ positionMs: number, state: string | undefined, sentAt: number } | null} last
 * @param {{ positionMs: number, state: string | undefined, repliedAt: number }} now
 */
export function edgeBetween(last, now) {
  if (!last || !Number.isFinite(now.positionMs)) return null;
  if (now.positionMs === last.positionMs && now.state === last.state) return null;
  return {
    kind: 'edge',
    at: Math.round((last.sentAt + now.repliedAt) / 2),
    windowMs: now.repliedAt - last.sentAt,
    state: now.state,
    positionMs: now.positionMs,
    prevPositionMs: last.positionMs,
    prevState: last.state,
  };
}

/**
 * The command record for a `SyncPlayCommand` frame's `Data`.
 *
 * @param {{ Command: string, PositionTicks: number, When: string, EmittedAt: string }} data
 * @param {number} at - when the frame arrived, on this machine's clock
 */
export function commandRecord(data, at) {
  return {
    kind: 'command',
    at,
    command: data.Command,
    positionMs: data.PositionTicks / 10000,
    whenMs: Date.parse(data.When),
    emittedMs: Date.parse(data.EmittedAt),
  };
}

/**
 * Each usable step's offset from the group's line, in milliseconds. Positive is ahead.
 *
 * The line is the last `Unpause`: its position at its `When`, moving at one second a second.
 * A step is usable when it follows that `When`, sits between two playing readings and is one
 * position report long. After any other command the group is not playing, so its steps are
 * left out.
 *
 * @param {Array<Record<string, any>>} records - a recorded run, in order
 * @returns {number[]}
 */
export function offsetsFromLine(records) {
  const offsets = [];
  let command = null;
  for (const r of records) {
    if (r.kind === 'command') {
      command = r;
      continue;
    }
    if (r.kind !== 'edge' || command?.command !== 'Unpause') continue;
    if (r.state !== 'play' || r.prevState !== 'play') continue;
    const step = r.positionMs - r.prevPositionMs;
    if (step < STEP_MIN_MS || step > STEP_MAX_MS || r.at < command.whenMs) continue;
    offsets.push(r.positionMs - (command.positionMs + (r.at - command.whenMs)));
  }
  return offsets;
}

/**
 * Summary of a run's offsets, each figure rounded to a millisecond. Null when there are none.
 *
 * @param {number[]} offsets
 */
export function summarize(offsets) {
  const n = offsets.length;
  if (!n) return null;
  const s = [...offsets].sort((a, b) => a - b);
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const mean = s.reduce((sum, v) => sum + v, 0) / n;
  const stdev = Math.sqrt(s.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n);
  return {
    edges: n,
    median: Math.round(median),
    p10: Math.round(s[Math.floor(n / 10)]),
    p90: Math.round(s[Math.floor((9 * n) / 10)]),
    min: Math.round(s[0]),
    max: Math.round(s[n - 1]),
    stdev: Math.round(stdev),
  };
}

/** Parse a recorded run: one JSON record per line, blank lines skipped. */
export function parseRecords(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** One printed line for a run's summary. */
export function summaryLine(label, summary) {
  if (!summary) return `${label}: no usable steps`;
  const { edges, median, p10, p90, min, max, stdev } = summary;
  return `${label}: ${edges} steps, median ${median} ms, p10 ${p10}, p90 ${p90}, min ${min}, max ${max}, stdev ${stdev} (positive is ahead)`;
}

/**
 * Whether a server URL's host is this machine.
 *
 * @param {string} serverUrl
 * @param {ReturnType<typeof os.networkInterfaces>} interfaces
 */
export function isThisMachine(serverUrl, interfaces = os.networkInterfaces()) {
  const host = new URL(serverUrl).hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost') return true;
  return Object.values(interfaces)
    .flat()
    .some((i) => i?.address === host);
}

/**
 * The `record` options, from its arguments and the environment.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function recordOptions(argv, env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      roku: { type: 'string' },
      group: { type: 'string', default: 'RTA stress party' },
      seconds: { type: 'string', default: '260' },
      drive: { type: 'string', default: 'pause' },
      cycles: { type: 'string', default: '8' },
      'poll-ms': { type: 'string', default: '15' },
      'wait-seconds': { type: 'string', default: '420' },
      'settle-seconds': { type: 'string', default: '30' },
    },
  });
  const roku = values.roku || env.ROKU_IP;
  if (!values.out) throw new Error('record needs --out <file>');
  if (!roku) throw new Error('record needs --roku <ip> or ROKU_IP');
  if (!['pause', 'seek', 'none'].includes(values.drive)) {
    throw new Error(`--drive is pause, seek or none, not "${values.drive}"`);
  }
  const number = (name) => {
    const n = Number(values[name]);
    if (!Number.isFinite(n) || n < 0)
      throw new Error(`--${name} needs a number, not "${values[name]}"`);
    return n;
  };
  return {
    out: values.out,
    roku,
    group: values.group,
    drive: values.drive,
    seconds: number('seconds'),
    cycles: number('cycles'),
    pollMs: number('poll-ms'),
    waitSeconds: number('wait-seconds'),
    settleSeconds: number('settle-seconds'),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open the session socket and log every SyncPlay frame it carries. */
async function openSocket(session, deviceId, log) {
  // `ApiKey` is the parameter name Jellyfin 12.4.0 takes (checked 2026-11-21); `api_key` is refused there.
  const ws = new WebSocket(
    `${session.serverUrl.replace(/^http/, 'ws')}/socket?ApiKey=${session.token}&deviceId=${deviceId}`,
  );
  ws.onmessage = (event) => {
    const at = Date.now();
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.MessageType === 'ForceKeepAlive')
      ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
    if (message.MessageType === 'SyncPlayCommand') log(commandRecord(message.Data, at));
    if (message.MessageType === 'SyncPlayGroupUpdate')
      log({ kind: 'update', at, type: message.Data?.Type });
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('the session socket did not open'));
  });
  return ws;
}

/** Send the same commands to the group for every build under test. */
async function driveGroup(options, syncPlay, log) {
  await sleep(8000);
  for (let cycle = 0; cycle < options.cycles; cycle++) {
    if (options.drive === 'seek') {
      const positionTicks = SEEK_TARGETS_S[cycle % SEEK_TARGETS_S.length] * 10000000;
      await syncPlay('Seek', { PositionTicks: positionTicks });
      log({
        kind: 'drive',
        at: Date.now(),
        what: 'seek',
        cycle,
        positionMs: positionTicks / 10000,
      });
      await sleep(29000);
      continue;
    }
    await syncPlay('Pause');
    log({ kind: 'drive', at: Date.now(), what: 'pause', cycle });
    await sleep(4000);
    await syncPlay('Unpause');
    log({ kind: 'drive', at: Date.now(), what: 'unpause', cycle });
    await sleep(25000);
  }
  log({ kind: 'drive', at: Date.now(), what: 'done' });
}

/** Poll the Roku until `endAt`, logging each change of position or state. */
async function pollRoku(options, endAt, log) {
  let last = null;
  while (Date.now() < endAt) {
    const sentAt = Date.now();
    let xml;
    try {
      const reply = await fetch(`http://${options.roku}:8060/query/media-player`, {
        signal: AbortSignal.timeout(2000),
      });
      xml = await reply.text();
    } catch {
      await sleep(options.pollMs);
      continue;
    }
    const now = { ...parseMediaPlayer(xml), repliedAt: Date.now() };
    const edge = edgeBetween(last, now);
    if (edge) log(edge);
    last = { positionMs: now.positionMs, state: now.state, sentAt };
    const spent = Date.now() - sentAt;
    if (spent < options.pollMs) await sleep(options.pollMs - spent);
  }
}

async function record(argv) {
  const options = recordOptions(argv);
  const server = resolveServer();
  if (!isThisMachine(server.url)) {
    throw new Error(
      `${server.url} is not this machine. The probe takes this machine's clock as the server's, ` +
        'so set RTA_SERVER_URL to a server running here.',
    );
  }
  const session = await authenticate(server, { role: ROLE });
  const headers = { ...tokenHeader(session.token), 'Content-Type': 'application/json' };
  const syncPlay = (action, body = {}) =>
    postJson(`${session.serverUrl}/SyncPlay/${action}`, headers, body);

  const out = fs.createWriteStream(options.out);
  const log = (row) => out.write(JSON.stringify(row) + '\n');
  const ws = await openSocket(session, sessionDeviceId(ROLE), log);
  const keepAlive = setInterval(() => ws.send(JSON.stringify({ MessageType: 'KeepAlive' })), 20000);

  let group;
  const waitUntil = Date.now() + options.waitSeconds * 1000;
  while (!group && Date.now() < waitUntil) {
    const groups = await getJson(`${session.serverUrl}/SyncPlay/List`, tokenHeader(session.token));
    group = groups.find((g) => g.GroupName === options.group);
    if (!group) await sleep(1000);
  }
  if (!group) throw new Error(`no group named "${options.group}" after ${options.waitSeconds} s`);
  log({ kind: 'seen', at: Date.now(), groupState: group.State });
  // The Roku is still loading when the group first appears. A probe that joined at once never
  // heard the first Unpause, and one that waited for the group to read Playing never joined.
  await sleep(options.settleSeconds * 1000);
  await syncPlay('Join', { GroupId: group.GroupId });
  await syncPlay('SetIgnoreWait', { IgnoreWait: true });
  log({ kind: 'joined', at: Date.now() });

  const driver =
    options.drive === 'none'
      ? Promise.resolve()
      : driveGroup(options, syncPlay, log).catch((e) =>
          log({ kind: 'drive-error', at: Date.now(), message: String(e) }),
        );
  await pollRoku(options, Date.now() + options.seconds * 1000, log);
  await driver;

  clearInterval(keepAlive);
  await syncPlay('Leave').catch(() => {});
  ws.close();
  await new Promise((resolve) => out.end(resolve));
  analyze([options.out]);
}

function analyze(files) {
  if (!files.length) throw new Error('analyze needs at least one recorded file');
  for (const file of files) {
    const records = parseRecords(fs.readFileSync(file, 'utf8'));
    console.log(summaryLine(file, summarize(offsetsFromLine(records))));
  }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const [verb, ...rest] = process.argv.slice(2);
  try {
    if (verb === 'record') await record(rest);
    else if (verb === 'analyze') analyze(rest);
    else throw new Error('usage: npm run syncplay:probe -- record --out <file> | analyze <file…>');
    process.exit(0);
  } catch (e) {
    console.error(`[syncplay:probe] ${e.message}`);
    process.exit(1);
  }
}

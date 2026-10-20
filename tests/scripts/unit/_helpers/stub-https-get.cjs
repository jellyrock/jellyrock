// Preload (node --require) that replaces https.get with canned answers, so a
// spawned script's upstream-version fetches run with no network. Which answer
// each host gets comes from STUB_HTTPS_MODE: "ok" (default) serves a Jellyfin
// index with 12.0 and 12.1 and Roku release notes headed 15.4; "fail" answers
// every request with HTTP 500.

const https = require('node:https');
const { EventEmitter } = require('node:events');

const JELLYFIN_INDEX =
  '<a href="jellyfin-openapi-12.0.json">a</a><a href="jellyfin-openapi-12.1.json">b</a>';
const ROKU_NOTES = '# Release notes\n\n## Roku OS 15.4\n\n## Roku OS 15.3\n';

https.get = (url, options, callback) => {
  const cb = typeof options === 'function' ? options : callback;
  const fail = process.env.STUB_HTTPS_MODE === 'fail';
  const body = String(url).includes('api.jellyfin.org') ? JELLYFIN_INDEX : ROKU_NOTES;
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.destroy = () => {};
  setImmediate(() => {
    const res = new EventEmitter();
    res.statusCode = fail ? 500 : 200;
    res.headers = {};
    res.setEncoding = () => {};
    res.resume = () => {};
    cb(res);
    if (!fail) res.emit('data', body);
    res.emit('end');
  });
  return req;
};

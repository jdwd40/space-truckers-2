# Server stack research

Research for issue #34 (map #32). Checked 2026-11-22 against official docs, repos, specs and the npm registry.

**Question:** Which libraries should the Node authority use? It covers five choices: the WebSocket server, the session framework, SQLite access, password hashing and WebSocket authentication.

**Settled constraints (from #32):** A TypeScript authority on Node runs on the user's own VPS and shares a simulation core with the Phaser client. It simulates the world headless while clients predict their own vehicle. Clients connect over WebSockets. Sessions are private, joined by link, with at most 8 players. Accounts are username and password, stored on the VPS in SQLite.

**Vocabulary note:** In `GLOSSARY.md` (branch `docs/multiplayer-glossary`), **Session** means a shared world that players join by link, and the glossary says to avoid "room". This file therefore calls the HTTP login credential a **login cookie** and never a "session cookie".

## Runtime baseline

| Node line | Active LTS from | Maintenance from | End of life |
|---|---|---|---|
| v24 "Krypton" | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| v26 "Lithium" | 2026-10-28 | 2027-10-20 | 2029-04-30 |

Source: [nodejs/Release schedule.json](https://github.com/nodejs/Release/blob/main/schedule.json).

Node 26 has been the Active LTS line since 2026-10-28, and the dev machine already runs v26.8.1. **Target Node 26 LTS on the VPS.** Several recommendations below rely on built-in modules, so a single Node version on dev and VPS is worth keeping.

## 1. WebSocket server: `ws` vs uWebSockets.js

**Recommendation: `ws`.**

- `ws` is a pure-JavaScript implementation installed from npm. Its latest version is 8.23.0, last published 2026-11-12 ([npm](https://www.npmjs.com/package/ws)).
- `ws` used to rely on the optional native add-ons `bufferutil` and `utf-8-validate`. On newer Node versions it uses built-in equivalents and skips loading those add-ons even if they are installed, so no native build is needed ([ws README](https://github.com/websockets/ws#opt-in-for-performance)).
- The `ws` README includes a "Client authentication" example. It creates the server with `noServer: true`, listens for the HTTP server's `'upgrade'` event, and writes `HTTP/1.1 401 Unauthorized` to the socket for a failed check. Only an authenticated request reaches `wss.handleUpgrade(...)` ([ws README, client authentication](https://github.com/websockets/ws#client-authentication)). That is the hook item 5 needs.
- uWebSockets.js says "We aren't in the NPM registry". It is installed from a GitHub tag, for example `npm install uNetworking/uWebSockets.js#v20.70.0` ([uWebSockets.js README](https://github.com/uNetworking/uWebSockets.js)).
- uWebSockets.js ships prebuilt native binaries tied to particular Node majors. Release v20.67.0 "removes Node.js 25 & Node.js 20 support and adds Node.js 26 support" ([releases](https://github.com/uNetworking/uWebSockets.js/releases)), so each Node upgrade waits on a matching uWS release.
- uWS mainly offers throughput and connection density. A private session of at most 8 players is far below the load where that matters. Load testing on the real VPS is listed as still to do in #32, so this choice can be revisited if measurements call for it.

## 2. Session framework: hand-rolled vs Colyseus

**Recommendation: build our own session layer on `ws`, not Colyseus.**

- Colyseus 0.18 is current: `colyseus` is 0.18.12 and `@colyseus/core` is 0.18.29 on npm ([docs](https://docs.colyseus.io/)). It synchronises room state as "binary delta patches" generated from a declared Schema ([docs home](https://docs.colyseus.io/)).
- Colyseus only synchronises Schema state:
  - "Plain class properties are invisible to the serializer".
  - "A `Schema` type may hold up to 63 synchronizable properties". Inherited fields count towards that limit.
  - Map keys must be strings, and an `ArraySchema` can't mix types.
  - Source: [Schema](https://docs.colyseus.io/state/schema).
- That conflicts with the shared simulation core. The browser's solo authority and the server would need the same plain TypeScript state. With Colyseus, that state would be duplicated into or replaced by Schema classes with decorators, and the browser would need the Colyseus runtime even in solo.
- Room state is sent automatically every `patchRate` milliseconds, 50 by default. Setting `patchRate = null` turns this off ([Room](https://docs.colyseus.io/room)). Colyseus also supports raw `sendBytes` / `onMessageBytes` messages ([Room](https://docs.colyseus.io/room)). If we wrote our own snapshot and input protocol for prediction anyway, Colyseus would be left doing matchmaking and transport only.
- Colyseus authentication is designed around JWTs. The default static `onAuth` "verifies the JWT", and clients send `client.auth.token` as an `Authorization` header ([Room auth](https://docs.colyseus.io/auth/room)). Our own accounts with a login cookie could replace that hook, but the default doesn't fit them.
- What we would build ourselves is small: a map of session id to session, an unguessable join link id, a cap of 8 players, a role picked on join, a fixed-step tick and a broadcast of snapshots. Colyseus's matchmaker, presence and driver layers are built to scale across many processes, which a single VPS hosting a few private sessions does not need.

## 3. SQLite: `node:sqlite` vs better-sqlite3

**Recommendation: `node:sqlite`.** If it falls short, wrap access in a small repository module so better-sqlite3 can be swapped in.

- `node:sqlite` is built into Node and was added in v22.5.0. It has not needed `--experimental-sqlite` since v23.4.0 / v22.13.0. Since v25.7.0 it has been "Stability: 1.2 – Release candidate", including on the v24.x and v26.x doc branches ([sqlite docs](https://nodejs.org/api/sqlite.html)).
- Its API is synchronous. In current docs the class is `Database`, and `DatabaseSync` remains as a deprecated alias (DEP0210). It supports prepared statements (`prepare`, `run` / `get` / `all` / `iterate`), named and positional parameters, and `database.isTransaction` ([sqlite docs](https://nodejs.org/api/sqlite.html)). The docs show no transaction helper, so transactions use `BEGIN` / `COMMIT` SQL.
- Node v26.8.1 bundles SQLite 3.53.4 (`process.versions.sqlite`, checked locally).
- better-sqlite3 is a native add-on at version 13.2.0, with `engines: node >=22`. It provides "prebuilt binaries" for major platforms and falls back to a source build otherwise ([README](https://github.com/WiseLibs/better-sqlite3), [npm](https://www.npmjs.com/package/better-sqlite3)). It is mature, and it has a `.transaction()` helper and published benchmarks. However, it adds a native build step to deployment on the VPS.
- This workload is small: accounts, two careers per account, and saves at session boundaries. Performance does not decide the choice. "Release candidate" status, with no dependency and no native build, is enough. The risk is API renames before the module becomes stable, such as the `DatabaseSync` to `Database` rename above, so keep every SQL call behind one module.

## 4. Password hashing: scrypt vs argon2

**Recommendation: Argon2id through the built-in `crypto.argon2`. Use at least OWASP's parameters, `memory: 19456` (19 MiB), `passes: 2`, `parallelism: 1`, with a random 16-byte nonce.**

- OWASP puts Argon2id first, with scrypt for when Argon2id is unavailable. Its Argon2id minimum is "19 MiB of memory, an iteration count of 2, and 1 degree of parallelism". Its scrypt minimum is N=2^17 (128 MiB), r=8, p=1 ([OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)).
- Node has had `crypto.argon2(algorithm, parameters, callback)` and `argon2Sync` since **v24.7.0**. Supported variants include `"argon2id"`. The docs recommend "a nonce is random and at least 16 bytes long", and `memory` is given in 1 KiB blocks ([crypto docs](https://nodejs.org/api/crypto.html#cryptoargon2algorithm-parameters-callback)). No native `argon2` npm package is needed.
- `crypto.argon2` returns a raw derived key, not an encoded hash string. Store the algorithm, parameters, nonce and key together, for example in PHC string format, so parameters can be raised later and old hashes rehashed on login.
- scrypt remains a dependency-free fallback. Node's default scrypt cost is N=16384 and its default `maxmem` is 32 MiB ([crypto docs](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)). That is below OWASP's N=2^17, so using scrypt would mean raising both `cost` and `maxmem`.
- Use the async `crypto.argon2`, not `argon2Sync`, so login hashing never stalls the session tick.
- Use `crypto.timingSafeEqual` to compare keys. Node documents it as suitable for comparing "secret values like authentication cookies" ([crypto docs](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)).

## 5. Authenticating a WebSocket connection: login cookie vs token

**Recommendation: use an HttpOnly, Secure, `SameSite=Strict` (or Lax) login cookie. Check it during the HTTP upgrade, together with an exact `Origin` allowlist, and reject the request before `handleUpgrade`.**

- RFC 6455 doesn't prescribe a method. Servers can use "any client authentication mechanism available to a generic HTTP server, such as cookies, HTTP authentication, or TLS authentication" (§10.5). Servers "SHOULD verify the |Origin| field" and answer an unacceptable origin with 403 (§10.2) ([RFC 6455](https://www.rfc-editor.org/rfc/rfc6455#section-10.5)).
- Browsers send cookies on the WebSocket handshake, so a cookie-authenticated socket is open to cross-site WebSocket hijacking unless the server validates `Origin` on every handshake. Use an allowlist, not substring matching, and use `SameSite=Lax` or `Strict` ([OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)).
- The browser `WebSocket` API can't set an `Authorization` header. A token would therefore go in the URL query string, which OWASP says to avoid because tokens "can leak into access logs", or in a first message after the socket opens (same OWASP page). A cookie avoids both.
- The cookie fits the setup. The VPS can serve the client and the authority from one origin, and accounts are username and password with a login form, so an HTTP login endpoint that sets the cookie is natural. The `ws` `'upgrade'` hook (item 1) reads the cookie and `Origin` and looks up the account in SQLite. It writes 401 or 403 on failure, or calls `handleUpgrade` and attaches the account on success.
- Store only a random cookie value on the client, kept in a login table in SQLite. Compare it in constant time. Close the account's sockets on logout or expiry, as OWASP advises: "When users log out, close all their WebSocket connections immediately."
- Reconsider tokens only if the client is ever hosted on a different site from the authority. In that case, send a short-lived token in the first message over WSS, as OWASP describes.

## Summary

| Item | Choice | One-line reason |
|---|---|---|
| WebSocket server | `ws` | Pure JS on npm with an upgrade hook for auth. uWS is off-registry, ties binaries to Node majors, and its speed isn't needed for 8 players. |
| Session framework | Own session layer on `ws` | Colyseus needs its own Schema state classes (63-field cap), which fight the shared plain-TS simulation core. |
| SQLite | `node:sqlite` | Built in, release-candidate stability, synchronous, no native build. Keep it behind one module. |
| Password hashing | Argon2id via `crypto.argon2` | OWASP's first choice, built into Node since v24.7.0, no native add-on. |
| WS auth | HttpOnly login cookie + `Origin` allowlist at upgrade | RFC 6455 allows cookies. Browsers can't set WS headers, and query tokens leak into logs. |

# Psst! (provisional name)

Online party game of hide-and-seek **by ear**, 3D (tilted top-down camera), 2–12 players (bots included).
Hiders are invisible chameleons; every noise fires a sonar ring that briefly reveals whoever is near it.

Name options: **Psst!** (pt: **Psiu!**), **Camaleco**.

## Stack
TypeScript end to end: Node + Colyseus 0.16 authoritative server (room codes, 30 Hz tick, per-viewer
snapshots) and a Three.js browser client with prediction/reconciliation; rules live in `packages/shared`
so both sides run the same code. Voice chat: LiveKit (optional). All sprites, sounds and music are
generated procedurally by the game code (3D models are built from primitives, textures painted on canvas).

```
packages/shared   settings (MatchSettings), maps, collision, movement, visibility, sound table, protocol
packages/server   Colyseus room + sim/Match (pure simulation) + tests
packages/client   Three.js view (src/game/GameView.ts, src/render/*), DOM UI/HUD, audio synth, voice, i18n (src/locales/en.json, pt.json)
```

## Run locally
```bash
npm install
npm run dev          # server on :2567 + Vite client on :5173
```
Open http://localhost:5173, create a room, share the 6-letter code (or the `?room=CODE` link).
Friends on other networks need the server reachable from the internet (see Hosting).

Production-style (single process serving the built client):
```bash
npm run build && npm start   # http://localhost:2567
```

## Docker
One image with the game server and the built client (the Electron workspace is left out):
```bash
docker build -t psst .
docker run --rm -p 2567:2567 psst    # http://localhost:2567
```
Voice: pass `-e LIVEKIT_URL=... -e LIVEKIT_API_KEY=... -e LIVEKIT_API_SECRET=...`. The port comes from `$PORT` (default 2567).

## Checks
```bash
npm test          # unit + per-setting + HUD checklist + end-to-end network test
npm run lint
npm run typecheck
```

## Voice chat (free)
Voice is optional; without it the game runs and the HUD shows "voice unavailable".
- Local dev: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0`
  then start the server with `LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npm run dev`.
- Internet: LiveKit Cloud free tier (create a project, copy URL/key/secret into the same env vars).

## Hosting (free options)
One Node process with WebSockets: Render (free web service), Koyeb (free instance) or Fly.io.
Build command `npm install && npm run build`, start command `npm start`, port from `$PORT`.
Players only open the URL — no port forwarding.

## Controls
- Keyboard + mouse (rebindable in Settings → Controls).
- Gamepad (standard / Xbox layout, also PlayStation, Switch Pro, Steam Deck): left stick moves, right stick
  turns the camera / aims, RT fire, LT pounce, B jump, LB or L3 run, RB taunt, X refill, Y power-up,
  Back push-to-talk, Start pause. Menus: D-pad / left stick + A / B.
- Touch (phones/tablets): joystick on the left, drag on the right to look/aim, buttons on the right.

## Phone (PWA)
Open the hosted URL on the phone (HTTPS is required for the microphone) and use "Add to Home Screen" /
"Install app": it opens fullscreen in landscape.

## Desktop app (Electron)
```bash
npm run desktop                                        # dev: Electron window on the Vite client (run `npm run dev` too)
VITE_SERVER_URL=wss://your-server npm run dist:desktop # installers in packages/desktop/release
```
The app only contains the client; it connects to the hosted game server given by `VITE_SERVER_URL`.
Targets: macOS dmg/zip, Windows nsis/zip (`npm run dist:win -w @psst/desktop`), Linux AppImage
(`npm run dist:linux -w @psst/desktop`, runs on Steam Deck). Builds are unsigned (macOS: right-click → Open).
Steam Deck / Steam Input without publishing: add the app as a "Non-Steam game" in the Steam library.

## Docs
Spec and plan: `docs/specs/mvp.md`, `docs/plans/mvp.md` (HUD checklist, maps, decisions).
Game reference (settings, sonar, power-ups, events): `docs/specs/game-reference.md`.

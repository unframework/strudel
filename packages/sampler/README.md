# @strudel/sampler

This package allows you to serve your samples on disk to the strudel REPL. 

```sh
cd ~/your/samples/ 
npx @strudel/sampler
```

This will run a server on `http://localhost:5432`. 
You can now load the samples via:

```js
samples('http://localhost:5432')
```

## Options

```sh
LOG=1 npx @strudel/sampler # adds logging
PORT=5555 npx @strudel/sampler # changes port
```

## static json

when running with `--json`, you will simply get the json logged back:

```sh
npx --yes @strudel/sampler --json > strudel.json
```

this is useful if you want to create a sample pack from the current folder.
## markers and warping

Each audio file can have a sidecar `<file>.json` with cue markers, beat markers and an optional bpm (see `@strudel/sample-meta`). Sidecars are included in the served map under `_meta`.

```sh
npx @strudel/sampler --writable # allows saving sidecars from the REPL via PUT /<file>.json
```

`GET /<file>?bpm=<target>` returns the file time-stretched (pitch preserved) so that its beat markers land on the target tempo's grid. Renders need `ffmpeg` with the `rubberband` filter and are cached in `.warp-cache/`, keyed by audio content, markers and bpm. The `X-Warp-Path` response header holds the rendered file's path on disk.

In patterns, `s("voice").beatsync()` plays the warp for the current tempo (`beatwarp(bpm)` for a fixed one), `cue("accent")` starts the sample early so the named marker falls on the event onset, and `fitbpm()` resamples to the current tempo instead of warping. Markers are edited in the REPL's annotate tab.

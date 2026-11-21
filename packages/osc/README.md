# @strudel/osc

OSC output for strudel patterns! Currently only tested with super collider / super dirt.

## Usage

Assuming you have [node.js](https://nodejs.org/) installed, you can run the osc bridge server via:

```sh
npx @strudel/osc
```

You should see something like:

```log
osc client running on port 57120
osc server running on port 57121
websocket server running on port 8080
```

### --port

By default it will use port 57120 for the osc client, which is what [superdirt](https://github.com/musikinformatik/SuperDirt) uses. You can change it via the `--port` option:

```sh
npx @strudel/osc --port 7771 # classic dirt
```

### --debug

To log all incoming osc messages, add the `--debug` flag:

```sh
npx @strudel/osc --debug
```

## Usage in Strudel

To test it in strudel, you have can use `all(osc)` to send all events through osc:

```js
$: s("bd*4")

all(osc)
```

[open in repl](https://strudel.cc/#JDogcygiYmQqNCIpCgphbGwob3NjKQ%3D%3D)

You can read more about [how to use Superdirt with Strudel](https://strudel.cc/learn/input-output/#oscsuperdirtstrudeldirt) in  the tutorial.

## Visualizer feed

The REPL can send the sketch source and the code ranges that are currently sounding to a visualizer, as OSC through the same bridge. To try it with the terminal reference visualizer:

```sh
pnpm vis-tty # listens on UDP 57140, or set VIS_PORT
```

Then in the REPL settings, under Visualizer, check "Send source and highlights". The address defaults to `127.0.0.1:57140`; a custom `host:port` is resolved by the bridge, so give the visualizer's address as seen from the bridge's machine.

To get a feed without a browser or bridge, play a sketch headlessly:

```sh
pnpm vis-feed sketch.js [host:port] # defaults to 127.0.0.1:57140
```

It evaluates the sketch with the REPL's scheduler in Node, sends the source, locations and timetagged highlights straight over UDP, and re-evaluates whenever the file changes. Audio and drawing calls are no-ops, and packages that only load in a browser (webaudio, soundfonts, hydra, etc.) are not available.

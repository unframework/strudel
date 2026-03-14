#!/usr/bin/env bash
set -euo pipefail

# Render a Strudel sketch to a seamless-loop WAV + video.
# 1. Renders audio with pre-start margin, crossfades for gapless looping
# 2. Renders video keyframes from the hap timeline
# 3. Stitches into final video with ffmpeg
#
# Usage: bash loop.sh -i sketch.js --cycles 8 [--margin 1] [--fade 0.25] [-o output]
#
# Requires: node, ffmpeg

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=""
CYCLES=4
MARGIN=1
FADE=0.25
OUTPUT=""
SAMPLE_RATE=44100
FPS=25
WIDTH=640
HEIGHT=900
VIDEO=true

while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--input)   INPUT="$2"; shift 2;;
    --cycles)     CYCLES="$2"; shift 2;;
    --margin)     MARGIN="$2"; shift 2;;
    --fade)       FADE="$2"; shift 2;;
    -o|--output)  OUTPUT="$2"; shift 2;;
    --sample-rate) SAMPLE_RATE="$2"; shift 2;;
    --fps)        FPS="$2"; shift 2;;
    --width)      WIDTH="$2"; shift 2;;
    --height)     HEIGHT="$2"; shift 2;;
    --no-video)   VIDEO=false; shift;;
    -h|--help)
      echo "Usage: bash loop.sh -i <sketch> --cycles <n> [options]"
      echo ""
      echo "Options:"
      echo "  -i, --input <path>     Strudel sketch file"
      echo "  --cycles <n>           Number of cycles (default: 4)"
      echo "  --margin <n>           Pre-start margin in cycles (default: 1)"
      echo "  --fade <s>             Crossfade duration in seconds (default: 0.25)"
      echo "  --sample-rate <n>      Sample rate (default: 44100)"
      echo "  --fps <n>              Video frame rate (default: 25)"
      echo "  --width <n>            Video width (default: 1280)"
      echo "  --height <n>           Video height (default: 720)"
      echo "  --no-video             Skip video rendering, audio only"
      echo "  -o, --output <name>    Output base name (default: <input> without ext)"
      exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "Error: provide -i <sketch file>"
  exit 1
fi

if [[ -z "$OUTPUT" ]]; then
  OUTPUT="${INPUT%.*}"
fi

WORKDIR=$(mktemp -d)
trap "rm -rf $WORKDIR" EXIT

# ========== AUDIO ==========

BEGIN="-${MARGIN}"

echo "=== Rendering audio: cycles ${BEGIN}..${CYCLES} (margin=${MARGIN}) ==="
node "$SCRIPT_DIR/cli.mjs" \
  -i "$INPUT" \
  "--begin=$BEGIN" \
  --cycles "$CYCLES" \
  --sample-rate "$SAMPLE_RATE" \
  -o "$WORKDIR/raw.wav"

# Read CPS from the JSONL metadata line
CPS=$(head -1 "$WORKDIR/raw.jsonl" | node -e "
  const line = require('fs').readFileSync('/dev/stdin','utf8');
  process.stdout.write(String(JSON.parse(line)._cps));
")

MS=$(node -e "process.stdout.write(String($MARGIN / $CPS))")   # margin seconds
BS=$(node -e "process.stdout.write(String($CYCLES / $CPS))")   # body seconds

echo "=== Crossfading (fade=${FADE}s at end of ${BS}s body) ==="

# raw.wav: [MARGIN | BODY]
# 1. Extract body (from margin_sec onwards), fade out the last FADE seconds
# 2. Extract lead (last FADE seconds of margin, just before body), fade it in
# 3. Overlay faded lead at end of body
OVERLAY_AT=$(node -e "process.stdout.write(String($BS - $FADE))")
LEAD_START=$(node -e "process.stdout.write(String($MS - $FADE))")
DELAY_MS=$(node -e "process.stdout.write(String(($BS - $FADE) * 1000))")

ffmpeg -y -i "$WORKDIR/raw.wav" -filter_complex "
  [0]atrim=${MS},asetpts=PTS-STARTPTS,afade=t=out:st=${OVERLAY_AT}:d=${FADE}[body];
  [0]atrim=${LEAD_START}:${MS},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE}[lead];
  [lead]adelay=${DELAY_MS}|${DELAY_MS}[lead_delayed];
  [body][lead_delayed]amix=inputs=2:duration=first:normalize=0
" -t "$BS" "$WORKDIR/loop.wav" 2>/dev/null

cp "$WORKDIR/loop.wav" "${OUTPUT}.wav"
cp "$WORKDIR/raw.jsonl" "${OUTPUT}.jsonl"
echo "=== Audio: ${OUTPUT}.wav ==="

# ========== VIDEO ==========

if [[ "$VIDEO" == "false" ]]; then
  echo "=== Done (no video) ==="
  exit 0
fi

echo "=== Rendering video keyframes ==="
FRAMES_DIR="$WORKDIR/frames"
mkdir -p "$FRAMES_DIR"

node "$SCRIPT_DIR/render-video.mjs" \
  --jsonl "$WORKDIR/raw.jsonl" \
  --code "$INPUT" \
  --begin 0 \
  --end "$CYCLES" \
  --fps "$FPS" \
  --width "$WIDTH" \
  --height "$HEIGHT" \
  -o "$FRAMES_DIR"

echo "=== Stitching video ==="
ffmpeg -y \
  -framerate "$FPS" -i "$FRAMES_DIR/frame_%05d.png" \
  -i "$WORKDIR/loop.wav" \
  -c:v libx264 -pix_fmt yuv420p \
  -c:a aac -shortest \
  "${OUTPUT}.mp4" 2>/dev/null

echo "=== Done: ${OUTPUT}.wav ${OUTPUT}.mp4 ==="

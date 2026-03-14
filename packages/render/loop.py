#!/usr/bin/env python3
"""
Render a Strudel sketch to a seamless-loop WAV + video.
1. Renders audio with pre-start margin, crossfades for gapless looping
2. Renders video keyframes from the hap timeline
3. Stitches into final video with ffmpeg

Usage: python loop.py -i sketch.js --cycles 8 [--margin 1] [--fade 0.25] [-o output]

Requires: node, ffmpeg
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def run(cmd, **kwargs):
    """Run a subprocess, raising on failure."""
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0:
        sys.exit(result.returncode)
    return result


def main():
    script_dir = Path(__file__).parent.resolve()

    parser = argparse.ArgumentParser(
        description="Render a Strudel sketch to a seamless-loop WAV + video."
    )
    parser.add_argument("-i", "--input", required=True, help="Strudel sketch file")
    parser.add_argument("--cycles", type=float, default=4, help="Number of cycles (default: 4)")
    parser.add_argument("--margin", type=float, default=1, help="Pre-start margin in cycles (default: 1)")
    parser.add_argument("--fade", type=float, default=0.25, help="Crossfade duration in seconds (default: 0.25)")
    parser.add_argument("-o", "--output", default="", help="Output base name (default: input without ext)")
    parser.add_argument("--sample-rate", type=int, default=44100, help="Sample rate (default: 44100)")
    parser.add_argument("--fps", type=int, default=25, help="Video frame rate (default: 25)")
    parser.add_argument("--width", type=int, default=640, help="Video width (default: 640)")
    parser.add_argument("--height", type=int, default=900, help="Video height (default: 900)")
    parser.add_argument("--no-video", action="store_true", help="Skip video rendering, audio only")
    args = parser.parse_args()

    input_path = args.input
    cycles = args.cycles
    margin = args.margin
    fade = args.fade
    output = args.output or str(Path(input_path).with_suffix(""))
    sample_rate = args.sample_rate
    fps = args.fps
    width = args.width
    height = args.height
    video = not args.no_video

    workdir = tempfile.mkdtemp()
    try:
        # ========== AUDIO ==========

        begin = str(-margin)
        print(f"=== Rendering audio: cycles {begin}..{cycles} (margin={margin}) ===")

        run([
            "node", str(script_dir / "cli.mjs"),
            "-i", input_path,
            f"--begin={begin}",
            "--cycles", str(cycles),
            "--sample-rate", str(sample_rate),
            "-o", os.path.join(workdir, "raw.wav"),
        ])

        # Read CPS from the JSONL metadata line
        with open(os.path.join(workdir, "raw.jsonl"), "r", encoding="utf-8") as f:
            first_line = f.readline()
        cps = float(json.loads(first_line)["_cps"])

        ms = margin / cps    # margin seconds
        bs = cycles / cps    # body seconds

        print(f"=== Crossfading (fade={fade}s at end of {bs}s body) ===")

        overlay_at = bs - fade
        lead_start = ms - fade
        delay_ms = (bs - fade) * 1000

        filter_complex = (
            f"[0]atrim={ms},asetpts=PTS-STARTPTS,afade=t=out:st={overlay_at}:d={fade}[body];"
            f"[0]atrim={lead_start}:{ms},asetpts=PTS-STARTPTS,afade=t=in:d={fade}[lead];"
            f"[lead]adelay={delay_ms}|{delay_ms}[lead_delayed];"
            f"[body][lead_delayed]amix=inputs=2:duration=first:normalize=0"
        )

        run([
            "ffmpeg", "-y",
            "-i", os.path.join(workdir, "raw.wav"),
            "-filter_complex", filter_complex,
            "-t", str(bs),
            os.path.join(workdir, "loop.wav"),
        ], stderr=subprocess.DEVNULL)

        shutil.copy(os.path.join(workdir, "loop.wav"), f"{output}.wav")
        shutil.copy(os.path.join(workdir, "raw.jsonl"), f"{output}.jsonl")
        print(f"=== Audio: {output}.wav ===")

        # ========== VIDEO ==========

        if not video:
            print("=== Done (no video) ===")
            return

        print("=== Rendering video keyframes ===")
        frames_dir = os.path.join(workdir, "frames")
        os.makedirs(frames_dir, exist_ok=True)

        run([
            "node", str(script_dir / "render-video.mjs"),
            "--jsonl", os.path.join(workdir, "raw.jsonl"),
            "--code", input_path,
            "--begin", "0",
            "--end", str(cycles),
            "--fps", str(fps),
            "--width", str(width),
            "--height", str(height),
            "-o", frames_dir,
        ])

        print("=== Stitching video ===")
        run([
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", os.path.join(frames_dir, "frame_%05d.png"),
            "-i", os.path.join(workdir, "loop.wav"),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-shortest",
            f"{output}.mp4",
        ], stderr=subprocess.DEVNULL)

        print(f"=== Done: {output}.wav {output}.mp4 ===")

    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()

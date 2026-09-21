#!/usr/bin/env bash
# Generates the sample media used by the unit/E2E tests and by the manual
# smoke checks described in README.md. Requires a full ffmpeg build on PATH
# (set FFMPEG to point at one).
set -euo pipefail
FFMPEG="${FFMPEG:-ffmpeg}"
OUT="${1:-tests/fixtures}"
mkdir -p "$OUT"

# 3 s stereo tone -> MP3 / WAV / OGG / FLAC / M4A
"$FFMPEG" -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=3:sample_rate=44100" \
  -f lavfi -i "sine=frequency=660:duration=3:sample_rate=44100" \
  -filter_complex "[0:a][1:a]amerge=inputs=2,volume=8[a]" -map "[a]" -ac 2 -b:a 128k "$OUT/tone.mp3"
"$FFMPEG" -y -hide_banner -loglevel error -i "$OUT/tone.mp3" -c:a pcm_s16le "$OUT/tone.wav"

# 2 s 320x240 test pattern with audio -> MP4 (H.264 + AAC) and WebM (VP8 + Opus)
"$FFMPEG" -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=320x240:rate=25:duration=2" \
  -f lavfi -i "sine=frequency=440:duration=2" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT/clip.mp4"
"$FFMPEG" -y -hide_banner -loglevel error -i "$OUT/clip.mp4" -c:v libvpx -b:v 300k -c:a libopus "$OUT/clip.webm"

# Images
"$FFMPEG" -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=640x480:duration=1" -frames:v 1 "$OUT/photo.png"
"$FFMPEG" -y -hide_banner -loglevel error -i "$OUT/photo.png" "$OUT/photo.jpg"
"$FFMPEG" -y -hide_banner -loglevel error -i "$OUT/photo.png" "$OUT/photo.webp"
# Flat green backdrop with a red square: exercises the colour-key tool.
"$FFMPEG" -y -hide_banner -loglevel error -f lavfi -i "color=c=0x00b140:size=400x300:duration=1" \
  -vf "drawbox=x=120:y=80:w=160:h=140:color=0xd62828:t=fill" -frames:v 1 "$OUT/greenscreen.png"

# The unit tests only ever read the first few kilobytes, which is what the
# format detector looks at. Committing just those slices keeps `npm test`
# working on a fresh clone without putting media binaries in the repository.
mkdir -p "$OUT/headers"
for file in "$OUT"/*.mp3 "$OUT"/*.wav "$OUT"/*.mp4 "$OUT"/*.webm "$OUT"/*.png "$OUT"/*.jpg "$OUT"/*.webp; do
  [ -e "$file" ] || continue
  head -c 4096 "$file" > "$OUT/headers/$(basename "$file").head"
done

ls -la "$OUT"

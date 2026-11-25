#!/usr/bin/env bash
# Validates the spans done-gate emits with OpenTelemetry Weaver live-check, against the done-gate
# registry (conformance/registry), which depends on semantic-conventions-genai at v0.1.0.
# Weaver receives OTLP over gRPC, checks every span and attribute, and writes a JSON report.
# Usage: conformance/run.sh        (needs Docker, and `pnpm build` done)
# https://github.com/open-telemetry/weaver/blob/v0.28.0/crates/weaver_live_check/README.md
set -euo pipefail
cd "$(dirname "$0")"

WEAVER_IMAGE="otel/weaver:v0.28.0@sha256:5857bb81d8cc7ed608cdcae37c4b459eb020f21dd4acade35f7933cd6762fbcc"
NAME=done-gate-weaver
REPORT_DIR=report

docker rm -f "$NAME" >/dev/null 2>&1 || true
rm -rf "$REPORT_DIR" && mkdir -p "$REPORT_DIR"

docker run -d --name "$NAME" -p 4317:4317 -p 4320:4320 \
  -v "$PWD/registry:/registry:ro" -v "$PWD/.weaver.toml:/work/.weaver.toml:ro" -w /work \
  "$WEAVER_IMAGE" registry live-check \
  --registry /registry --v2 --search-all-attributes \
  --config /work/.weaver.toml \
  --otlp-grpc-address 0.0.0.0 --inactivity-timeout 120 \
  --format json --output /tmp/report --no-stream >/dev/null

for _ in $(seq 1 60); do
  curl -sf http://localhost:4320/health >/dev/null && break
  sleep 1
done
curl -sf http://localhost:4320/health >/dev/null || { docker logs "$NAME"; exit 1; }

node "${EMITTER:-emit.ts}"

# /stop makes Weaver write the report and exit. Its exit code is non-zero on any violation.
curl -sf -X POST http://localhost:4320/stop >/dev/null || true
WEAVER_EXIT=$(docker wait "$NAME")
docker cp "$NAME:/tmp/report/live_check.json" "$REPORT_DIR/live_check.json"
docker logs "$NAME" > "$REPORT_DIR/weaver.log" 2>&1 || true
docker rm -f "$NAME" >/dev/null

node summarize.ts "$REPORT_DIR/live_check.json" "$WEAVER_EXIT"

#!/usr/bin/env bash

set -ex

UV_THREADPOOL_SIZE=$(nproc) \
    node \
    --experimental-transform-types \
    --no-warnings \
    src/main.ts

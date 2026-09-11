#!/bin/sh
# Builds the lid-angle CLI with swiftc.
#
# Deliberately not a SwiftPM package: this machine has only the Command Line Tools, whose
# bundled PackageDescription library fails to link a manifest. swiftc needs no manifest,
# and the tool is two dependency-free files, so there is nothing SwiftPM would add.
set -eu

cd "$(dirname "$0")"
mkdir -p bin
swiftc -O -o bin/lid-angle src/LidAngleSensor.swift src/main.swift
echo "built $(pwd)/bin/lid-angle"

//
//  main.swift
//
//  Prints the MacBook lid angle as NDJSON, one object per line, for whatever is
//  reading this process's stdout.
//

import Foundation

let usage = """
usage: lid-angle [--once] [--hz N] [--all]

Prints the lid angle as NDJSON on stdout: {"angle":101,"t":12345.678}

  --once    print a single reading and exit
  --hz N    polling rate in Hz (default 30, max 240)
  --all     emit every poll instead of only when the angle changes
"""

// MARK: - Arguments

var once = false
var emitEveryPoll = false
var hz = 30.0

var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    switch argument {
    case "--once":
        once = true
    case "--all":
        emitEveryPoll = true
    case "--hz":
        guard let value = arguments.next(), let parsed = Double(value), parsed > 0 else {
            FileHandle.standardError.write(Data("lid-angle: --hz needs a positive number\n".utf8))
            exit(2)
        }
        hz = min(parsed, 240)
    case "-h", "--help":
        print(usage)
        exit(0)
    default:
        FileHandle.standardError.write(Data("lid-angle: unknown argument '\(argument)'\n\(usage)\n".utf8))
        exit(2)
    }
}

// MARK: - Output

/// Print one line and flush, so a parent process reading the pipe sees it immediately
/// rather than when a 4 KB block fills up.
func emit(angle: Double) {
    print("{\"angle\":\(angle),\"t\":\(Date().timeIntervalSince1970)}")
    fflush(stdout)
}

// MARK: - Run

let sensor: LidAngleSensor
do {
    sensor = try LidAngleSensor()
} catch {
    FileHandle.standardError.write(Data("lid-angle: \(error)\n".utf8))
    exit(1)
}

if once {
    guard let angle = sensor.read() else {
        FileHandle.standardError.write(Data("lid-angle: the sensor did not return a reading\n".utf8))
        exit(1)
    }
    emit(angle: angle)
    exit(0)
}

// Streaming. SIGPIPE is left at its default disposition, so this exits on its own once
// the reader goes away.
let interval = UInt32(1_000_000 / hz)
var lastEmitted: Double?

while true {
    if let angle = sensor.read(), emitEveryPoll || angle != lastEmitted {
        emit(angle: angle)
        lastEmitted = angle
    }
    usleep(interval)
}

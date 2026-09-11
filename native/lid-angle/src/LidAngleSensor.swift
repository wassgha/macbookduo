//
//  LidAngleSensor.swift
//
//  Reads the MacBook lid angle sensor over IOKit HID.
//
//  The device-matching dictionary and the feature-report layout are taken from
//  samhenrigold/LidAngleSensor (Apache-2.0) — see native/lid-angle/README.md.
//

import Foundation
import IOKit.hid

/// Why the sensor could not be read, in terms the caller can report to a user.
enum LidAngleError: Error, CustomStringConvertible {
    case hidManagerUnavailable
    case noMatchingDevice
    case noReadableDevice
    case cannotOpenDevice

    var description: String {
        switch self {
        case .hidManagerUnavailable:
            "Could not open the IOKit HID manager."
        case .noMatchingDevice:
            "No lid angle sensor found. It was introduced on the 2019 16-inch MacBook Pro; "
                + "desktops, older laptops, and the 13-inch MacBook Pro do not have one."
        case .noReadableDevice:
            "A lid angle sensor was found but none of its HID interfaces returned a reading."
        case .cannotOpenDevice:
            "Found the lid angle sensor but could not open it for reading."
        }
    }
}

/// The lid angle sensor, exposed as a synchronous "read the current angle" handle.
///
/// The sensor is an Apple HID device (vendor `0x05AC`, product `0x8104`) that reports the
/// angle in a feature report rather than through input events, so there is nothing to
/// subscribe to — every reading is an explicit `IOHIDDeviceGetReport` call, and callers
/// poll at whatever rate they need.
final class LidAngleSensor {
    private static let noOptions = IOOptionBits(kIOHIDOptionsTypeNone)

    /// Apple's HID vendor ID.
    private static let vendorID = 0x05AC
    /// Product ID of the lid angle sensor.
    private static let productID = 0x8104
    /// HID Sensor usage page.
    private static let usagePage = 0x0020
    /// "Orientation" usage within the Sensor page.
    private static let usage = 0x008A
    /// The sensor answers on feature report 1.
    private static let reportID: CFIndex = 1

    private let device: IOHIDDevice
    private var report = [UInt8](repeating: 0, count: 8)

    /// Find the sensor and keep it open for the lifetime of this object.
    init() throws {
        // Discovery and opening are separate steps on purpose. Closing the HID manager
        // invalidates the device handles it handed out, so a device opened during
        // discovery stops answering as soon as the manager goes away — it has to be
        // reopened afterwards.
        let found = try Self.discover()

        guard IOHIDDeviceOpen(found, Self.noOptions) == kIOReturnSuccess else {
            throw LidAngleError.cannotOpenDevice
        }
        device = found

        guard read() != nil else {
            IOHIDDeviceClose(found, Self.noOptions)
            throw LidAngleError.noReadableDevice
        }
    }

    /// The HID interface that answers feature report 1.
    ///
    /// The match returns several interfaces on the same physical device, most of which
    /// answer `kIOReturnUnsupported`, so each one is opened and probed and the first that
    /// produces a reading wins. Every interface is closed again before returning: the
    /// caller reopens the winner once the manager is out of the picture.
    private static func discover() throws -> IOHIDDevice {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, noOptions)
        guard IOHIDManagerOpen(manager, noOptions) == kIOReturnSuccess else {
            throw LidAngleError.hidManagerUnavailable
        }
        defer { IOHIDManagerClose(manager, noOptions) }

        let matching: [String: Any] = [
            kIOHIDVendorIDKey as String: vendorID,
            kIOHIDProductIDKey as String: productID,
            "UsagePage": usagePage,
            "Usage": usage,
        ]
        IOHIDManagerSetDeviceMatching(manager, matching as CFDictionary)

        guard let devices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>,
              !devices.isEmpty
        else {
            throw LidAngleError.noMatchingDevice
        }

        var probe = [UInt8](repeating: 0, count: 8)
        var winner: IOHIDDevice?
        for candidate in devices {
            guard IOHIDDeviceOpen(candidate, noOptions) == kIOReturnSuccess else { continue }
            if winner == nil, readRaw(from: candidate, into: &probe) != nil {
                winner = candidate
            }
            IOHIDDeviceClose(candidate, noOptions)
        }

        guard let winner else { throw LidAngleError.noReadableDevice }
        return winner
    }

    deinit {
        IOHIDDeviceClose(device, Self.noOptions)
    }

    /// The current lid angle in degrees, or `nil` if this read failed.
    ///
    /// Roughly 0° with the lid shut and ~130° at the hinge stop. Individual reads can fail
    /// transiently (notably while the lid is closed), so a `nil` here means "no reading
    /// this time", not "sensor gone".
    func read() -> Double? {
        Self.readRaw(from: device, into: &report).map(Double.init)
    }

    /// One feature-report read, decoded as a little-endian degree value in bytes 1...2.
    private static func readRaw(from device: IOHIDDevice, into report: inout [UInt8]) -> UInt16? {
        var length = CFIndex(report.count)
        let result = IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, reportID, &report, &length)
        guard result == kIOReturnSuccess, length >= 3 else { return nil }
        return UInt16(report[2]) << 8 | UInt16(report[1])
    }
}

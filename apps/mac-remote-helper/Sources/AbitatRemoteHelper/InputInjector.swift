import AppKit
import CoreGraphics
import Foundation

final class InputInjector {
    private let displayId = CGMainDisplayID()

    func handle(signal: RemoteSignal) {
        guard
            signal.type == "input",
            let payload = signal.payload["event"]?.objectValue,
            let type = payload["type"]?.stringValue
        else {
            return
        }

        switch type {
        case "pointer":
            handlePointer(payload)
        case "text":
            if let value = payload["value"]?.stringValue {
                postText(value)
            }
        case "key":
            if let key = payload["key"]?.stringValue {
                postKey(key)
            }
        default:
            return
        }
    }

    private func handlePointer(_ payload: [String: JSONValue]) {
        guard
            let phase = payload["phase"]?.stringValue,
            let x = payload["x"]?.doubleValue,
            let y = payload["y"]?.doubleValue
        else {
            return
        }

        let bounds = CGDisplayBounds(displayId)
        let point = CGPoint(
            x: bounds.origin.x + bounds.width * CGFloat(max(0, min(1, x))),
            y: bounds.origin.y + bounds.height * CGFloat(max(0, min(1, y)))
        )

        if phase == "scroll" {
            let dy = Int32(payload["dy"]?.doubleValue ?? 0)
            let event = CGEvent(
                scrollWheelEvent2Source: nil,
                units: .pixel,
                wheelCount: 1,
                wheel1: dy,
                wheel2: 0,
                wheel3: 0
            )
            event?.post(tap: .cghidEventTap)
            return
        }

        let mouseType: CGEventType =
            phase == "down" ? .leftMouseDown : phase == "up" ? .leftMouseUp : .mouseMoved
        let event = CGEvent(mouseEventSource: nil, mouseType: mouseType, mouseCursorPosition: point, mouseButton: .left)
        event?.post(tap: .cghidEventTap)
    }

    private func postText(_ value: String) {
        for scalar in value.unicodeScalars {
            var character = UniChar(scalar.value)
            let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
            down?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &character)
            down?.post(tap: .cghidEventTap)

            let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
            up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &character)
            up?.post(tap: .cghidEventTap)
        }
    }

    private func postKey(_ key: String) {
        guard let virtualKey = virtualKeyCode(for: key) else {
            postText(key)
            return
        }

        CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: true)?.post(tap: .cghidEventTap)
        CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: false)?.post(tap: .cghidEventTap)
    }

    private func virtualKeyCode(for key: String) -> CGKeyCode? {
        switch key.lowercased() {
        case "return", "enter":
            return 36
        case "tab":
            return 48
        case "escape":
            return 53
        case "delete", "backspace":
            return 51
        case "arrowleft":
            return 123
        case "arrowright":
            return 124
        case "arrowdown":
            return 125
        case "arrowup":
            return 126
        default:
            return nil
        }
    }
}

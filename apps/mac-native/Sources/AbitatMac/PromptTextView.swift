import AppKit
import SwiftUI

struct PromptTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var selectedRange: NSRange
    let autocompleteIsActive: Bool
    let onAutocompleteMove: (Int) -> Void
    let onAutocompleteAccept: () -> Bool
    let onAutocompleteDismiss: () -> Void
    let onSubmit: () -> Void

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .noBorder

        let textView = PromptNSTextView()
        textView.delegate = context.coordinator
        textView.onSubmit = onSubmit
        textView.autocompleteIsActive = { autocompleteIsActive }
        textView.onAutocompleteMove = onAutocompleteMove
        textView.onAutocompleteAccept = onAutocompleteAccept
        textView.onAutocompleteDismiss = onAutocompleteDismiss
        textView.drawsBackground = true
        textView.backgroundColor = NSColor(
            red: 0x20 / 255,
            green: 0x26 / 255,
            blue: 0x32 / 255,
            alpha: 1
        )
        textView.textColor = NSColor(
            red: 0xF7 / 255,
            green: 0xF8 / 255,
            blue: 0xFB / 255,
            alpha: 1
        )
        textView.insertionPointColor = textView.textColor
        textView.font = .systemFont(ofSize: 14, weight: .regular)
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.textContainerInset = NSSize(width: 12, height: 11)
        textView.textContainer?.lineFragmentPadding = 0
        textView.minSize = NSSize(width: 0, height: 86)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.string = text

        scrollView.documentView = textView
        scrollView.wantsLayer = true
        scrollView.layer?.cornerRadius = 7
        scrollView.layer?.borderWidth = 1
        scrollView.layer?.borderColor = NSColor(
            red: 0x25 / 255,
            green: 0x2B / 255,
            blue: 0x36 / 255,
            alpha: 1
        ).cgColor
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? PromptNSTextView else {
            return
        }
        textView.onSubmit = onSubmit
        textView.autocompleteIsActive = { autocompleteIsActive }
        textView.onAutocompleteMove = onAutocompleteMove
        textView.onAutocompleteAccept = onAutocompleteAccept
        textView.onAutocompleteDismiss = onAutocompleteDismiss
        if textView.string != text {
            textView.string = text
        }
        let textLength = (textView.string as NSString).length
        let clampedLocation = min(selectedRange.location, textLength)
        let clampedRange = NSRange(
            location: clampedLocation,
            length: min(selectedRange.length, textLength - clampedLocation)
        )
        if textView.selectedRange() != clampedRange {
            textView.setSelectedRange(clampedRange)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, selectedRange: $selectedRange)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        private var text: Binding<String>
        private var selectedRange: Binding<NSRange>

        init(text: Binding<String>, selectedRange: Binding<NSRange>) {
            self.text = text
            self.selectedRange = selectedRange
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else {
                return
            }
            text.wrappedValue = textView.string
            selectedRange.wrappedValue = textView.selectedRange()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else {
                return
            }
            selectedRange.wrappedValue = textView.selectedRange()
        }
    }
}

final class PromptNSTextView: NSTextView {
    var autocompleteIsActive: (() -> Bool)?
    var onAutocompleteMove: ((Int) -> Void)?
    var onAutocompleteAccept: (() -> Bool)?
    var onAutocompleteDismiss: (() -> Void)?
    var onSubmit: (() -> Void)?

    override func keyDown(with event: NSEvent) {
        let isAutocompleteActive = autocompleteIsActive?() == true
        if isAutocompleteActive {
            if event.keyCode == 53 {
                onAutocompleteDismiss?()
                return
            }
            if event.keyCode == 126 {
                onAutocompleteMove?(-1)
                return
            }
            if event.keyCode == 125 {
                onAutocompleteMove?(1)
                return
            }
            if event.keyCode == 48, onAutocompleteAccept?() == true {
                return
            }
        }

        if event.keyCode == 36 || event.keyCode == 76 {
            if isAutocompleteActive, onAutocompleteAccept?() == true {
                return
            }

            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if modifiers.contains(.shift) || modifiers.contains(.command) {
                insertNewline(nil)
                return
            }

            onSubmit?()
            return
        }

        super.keyDown(with: event)
    }
}

import SwiftUI

enum AbitatTheme {
    static let canvas = Color(red: 0x0E / 255, green: 0x11 / 255, blue: 0x16 / 255)
    static let canvasRaised = Color(red: 0x12 / 255, green: 0x16 / 255, blue: 0x1D / 255)
    static let surface = Color(red: 0x17 / 255, green: 0x1B / 255, blue: 0x23 / 255)
    static let surfaceHigh = Color(red: 0x20 / 255, green: 0x26 / 255, blue: 0x32 / 255)
    static let surfaceSelected = Color(red: 0x25 / 255, green: 0x30 / 255, blue: 0x44 / 255)
    static let border = Color(red: 0x30 / 255, green: 0x38 / 255, blue: 0x46 / 255)
    static let borderSoft = Color(red: 0x25 / 255, green: 0x2B / 255, blue: 0x36 / 255)
    static let text = Color(red: 0xF1 / 255, green: 0xF3 / 255, blue: 0xF5 / 255)
    static let muted = Color(red: 0xA0 / 255, green: 0xA7 / 255, blue: 0xB2 / 255)
    static let subdued = Color(red: 0x73 / 255, green: 0x7B / 255, blue: 0x87 / 255)
    static let primary = Color(red: 0x7E / 255, green: 0xA0 / 255, blue: 0xC4 / 255)
    static let primarySoft = Color(red: 0x26 / 255, green: 0x34 / 255, blue: 0x45 / 255)
    static let success = Color(red: 0x7D / 255, green: 0xA9 / 255, blue: 0x87 / 255)
    static let warning = Color(red: 0xC8 / 255, green: 0xA1 / 255, blue: 0x5A / 255)
    static let danger = Color(red: 0xD0 / 255, green: 0x6B / 255, blue: 0x6B / 255)

    static let panelRadius = 8.0
    static let controlRadius = 7.0

    enum Fonts {
        static let appTitle = Font.system(size: 21, weight: .semibold, design: .default)
        static let screenTitle = Font.system(size: 18, weight: .semibold, design: .default)
        static let panelTitle = Font.system(size: 15, weight: .semibold, design: .default)
        static let rowTitle = Font.system(size: 13, weight: .semibold, design: .default)
        static let body = Font.system(size: 13, weight: .regular, design: .default)
        static let message = Font.system(size: 14, weight: .regular, design: .default)
        static let caption = Font.system(size: 12, weight: .regular, design: .default)
        static let label = Font.system(size: 11, weight: .medium, design: .default)
        static let smallLabel = Font.system(size: 10, weight: .medium, design: .default)
        static let metric = Font.system(size: 15, weight: .semibold, design: .default)
        static let mono = Font.system(size: 12, weight: .regular, design: .monospaced)
        static let monoEmphasis = Font.system(size: 20, weight: .semibold, design: .monospaced)
    }
}

struct BorderedPanel<Content: View>: View {
    let content: Content
    var padding = 14.0

    init(padding: Double = 14, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .background(AbitatTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.panelRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AbitatTheme.panelRadius, style: .continuous)
                    .stroke(AbitatTheme.borderSoft, lineWidth: 1)
            )
    }
}

struct StatusPill: View {
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(AbitatTheme.Fonts.label)
                .foregroundStyle(AbitatTheme.text)
                .lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(AbitatTheme.surfaceHigh)
        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                .stroke(AbitatTheme.borderSoft, lineWidth: 1)
        )
    }
}

struct IconActionButton: View {
    @Environment(\.isEnabled) private var isEnabled

    let title: String
    let systemName: String
    var isPrimary = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemName)
                .font(AbitatTheme.Fonts.rowTitle)
                .lineLimit(1)
                .frame(minHeight: 36)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 13)
        .background(isPrimary ? AbitatTheme.primary : AbitatTheme.surfaceHigh)
        .foregroundStyle(AbitatTheme.text)
        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                .stroke(isPrimary ? AbitatTheme.primary : AbitatTheme.border, lineWidth: 1)
        )
        .opacity(isEnabled ? 1 : 0.45)
        .help(title)
    }
}

struct EmptyStateView: View {
    let systemName: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemName)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(AbitatTheme.subdued)
            Text(title)
                .font(AbitatTheme.Fonts.panelTitle)
                .foregroundStyle(AbitatTheme.text)
            Text(message)
                .font(AbitatTheme.Fonts.body)
                .foregroundStyle(AbitatTheme.muted)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

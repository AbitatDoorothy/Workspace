import AbitatMacCore
import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 0) {
            SidebarView()
                .frame(width: 304)

            Divider()
                .overlay(AbitatTheme.borderSoft)

            VStack(spacing: 0) {
                TopBarView()
                Divider()
                    .overlay(AbitatTheme.border)
                WorkspaceView()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(AbitatTheme.canvas)
        .foregroundStyle(AbitatTheme.text)
        .font(AbitatTheme.Fonts.body)
        .tint(AbitatTheme.primary)
        .overlay(alignment: .bottomTrailing) {
            if let error = model.errorMessage {
                ErrorToast(message: error) {
                    model.errorMessage = nil
                }
                .padding(18)
            }
        }
    }
}

private struct SidebarView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 10) {
                Image(systemName: "hexagon.fill")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(AbitatTheme.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Abitat")
                        .font(AbitatTheme.Fonts.appTitle)
                    Text(model.status?.macName ?? "Mac")
                        .font(AbitatTheme.Fonts.label)
                        .foregroundStyle(AbitatTheme.muted)
                        .lineLimit(1)
                }
                Spacer()
                Button {
                    Task { await model.refreshAll() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .foregroundStyle(AbitatTheme.text)
                .background(AbitatTheme.surfaceHigh)
                .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: AbitatTheme.controlRadius)
                        .stroke(AbitatTheme.borderSoft, lineWidth: 1)
                )
                .help("Refresh")
            }

            StatusStrip()

            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Projects", systemName: "folder")
                ScrollView {
                    LazyVStack(spacing: 7) {
                        ForEach(model.projects) { project in
                            SidebarRow(
                                title: project.name,
                                subtitle: project.hostLocalPath ?? project.id,
                                badge: project.conversationCount.map(String.init),
                                isSelected: project.id == model.selectedProjectId
                            ) {
                                model.selectProject(project)
                            }
                        }
                    }
                    .padding(.vertical, 1)
                }
                .frame(maxHeight: 220)
            }

            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Threads", systemName: "text.bubble")
                ScrollView {
                    LazyVStack(spacing: 7) {
                        ForEach(model.conversations) { conversation in
                            SidebarRow(
                                title: conversation.prompt,
                                subtitle: conversation.status,
                                badge: nil,
                                isSelected: conversation.id == model.selectedConversationId
                            ) {
                                model.selectConversation(conversation)
                            }
                        }
                    }
                    .padding(.vertical, 1)
                }
            }

            Spacer(minLength: 0)

            BorderedPanel {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Tokens")
                        .font(AbitatTheme.Fonts.label)
                        .foregroundStyle(AbitatTheme.muted)
                    HStack(spacing: 8) {
                        TokenMetric(title: "1D", value: model.tokenUsage?.timeframes.oneDay.totalTokens)
                        TokenMetric(title: "7D", value: model.tokenUsage?.timeframes.sevenDays.totalTokens)
                        TokenMetric(title: "ALL", value: model.tokenUsage?.timeframes.all.totalTokens)
                    }
                }
            }
        }
        .padding(14)
        .background(AbitatTheme.canvasRaised)
    }
}

private struct StatusStrip: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 8) {
            switch model.phase {
            case .idle:
                StatusPill(label: "Idle", color: AbitatTheme.muted)
            case .starting:
                StatusPill(label: "Starting", color: AbitatTheme.warning)
            case .online:
                StatusPill(
                    label: model.status?.codex.available == true ? "Codex online" : "Codex issue",
                    color: model.status?.codex.available == true ? AbitatTheme.success : AbitatTheme.warning
                )
            case .failed:
                StatusPill(label: "Offline", color: AbitatTheme.danger)
            }
            StatusPill(
                label: model.status?.relayConnected == true ? "Relay" : "Local",
                color: model.status?.relayConnected == true ? AbitatTheme.primary : AbitatTheme.muted
            )
        }
    }
}

private struct SectionHeader: View {
    let title: String
    let systemName: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .medium))
            Text(title)
                .font(AbitatTheme.Fonts.label)
        }
        .foregroundStyle(AbitatTheme.subdued)
        .accessibilityElement(children: .combine)
    }
}

private struct TopBarView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(model.selectedProject?.name ?? "No project selected")
                    .font(AbitatTheme.Fonts.screenTitle)
                    .lineLimit(1)
                Text(model.selectedConversation?.prompt ?? "New thread")
                    .font(AbitatTheme.Fonts.caption)
                    .foregroundStyle(AbitatTheme.muted)
                    .lineLimit(1)
            }
            .frame(minWidth: 220, maxWidth: 360, alignment: .leading)

            Spacer()

            Picker("", selection: $model.selectedPanel) {
                ForEach(AppModel.Panel.allCases) { panel in
                    Label(panel.rawValue, systemImage: panel.icon)
                        .tag(panel)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 560)

            IconActionButton(title: "Pair", systemName: "qrcode", isPrimary: true) {
                model.createPairing()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(AbitatTheme.canvasRaised)
    }
}

private struct WorkspaceView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            switch model.selectedPanel {
            case .chat:
                ChatPanel()
            case .files:
                FilesPanel()
            case .automations:
                AutomationsPanel()
            case .pairing:
                PairingPanel()
            case .logs:
                LogsPanel()
            case .remote:
                RemotePanel()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AbitatTheme.canvas)
    }
}

private struct ChatPanel: View {
    @EnvironmentObject private var model: AppModel
    @State private var chatScrollHeight = 0.0
    @State private var isAtBottom = true

    private let bottomAnchorId = "chat-bottom-anchor"
    private let bottomVisibilityTolerance = 4.0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                StatusPill(label: model.selectedConversationStatus, color: statusColor(model.selectedConversationStatus))
                Text(model.visibleMessages.isEmpty ? "No synced messages yet" : "\(model.visibleMessages.count) messages")
                    .font(AbitatTheme.Fonts.caption)
                    .foregroundStyle(AbitatTheme.muted)
                Spacer()
                ModelPicker()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(AbitatTheme.canvas)

            ScrollViewReader { proxy in
                ZStack(alignment: .bottomTrailing) {
                    GeometryReader { viewport in
                        Group {
                            if hasChatContent {
                                ScrollView {
                                    LazyVStack(alignment: .leading, spacing: 12) {
                                        ForEach(model.visibleMessages) { message in
                                            MessageBubble(message: message)
                                        }
                                        ForEach(model.queuedTurnsForSelectedConversation) { turn in
                                            QueuedTurnRow(turn: turn)
                                        }
                                        Color.clear
                                            .frame(height: 1)
                                            .id(bottomAnchorId)
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 16)
                                    .background(
                                        GeometryReader { content in
                                            Color.clear.preference(
                                                key: ChatBottomOffsetPreferenceKey.self,
                                                value: content.frame(in: .named("chat-scroll")).maxY
                                            )
                                        }
                                    )
                                }
                                .coordinateSpace(name: "chat-scroll")
                            } else {
                                EmptyStateView(
                                    systemName: "text.bubble",
                                    title: "No messages selected",
                                    message: "Choose a thread from the sidebar or start a new one from the composer."
                                )
                            }
                        }
                        .onAppear {
                            chatScrollHeight = viewport.size.height
                            scrollToBottom(proxy)
                        }
                        .onChange(of: viewport.size.height) { _, height in
                            chatScrollHeight = height
                            if isAtBottom {
                                scrollToBottom(proxy)
                            }
                        }
                        .onPreferenceChange(ChatBottomOffsetPreferenceKey.self) { bottomOffset in
                            isAtBottom = bottomOffset <= chatScrollHeight + bottomVisibilityTolerance
                        }
                    }

                    if hasChatContent && !isAtBottom {
                        Button {
                            scrollToBottom(proxy)
                        } label: {
                            Label("Latest", systemImage: "arrow.down")
                                .font(AbitatTheme.Fonts.rowTitle)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 34)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(AbitatTheme.text)
                        .background(Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(AbitatTheme.primary.opacity(0.9), lineWidth: 1.25)
                        )
                        .padding(.bottom, 12)
                        .padding(.trailing, 18)
                        .help("Jump to latest message")
                        .accessibilityLabel("Jump to latest message")
                        .zIndex(10)
                    }
                }
                .onChange(of: model.visibleMessages.map(\.id)) { _, _ in
                    if isAtBottom {
                        scrollToBottom(proxy)
                    }
                }
                .onChange(of: model.queuedTurnsForSelectedConversation.map(\.id)) { _, _ in
                    scrollToBottom(proxy)
                }
                .onChange(of: model.selectedConversationId) { _, _ in
                    scrollToBottom(proxy)
                }
            }

            Divider()
                .overlay(AbitatTheme.borderSoft)

            ComposerView()
        }
    }

    private var hasChatContent: Bool {
        !model.visibleMessages.isEmpty || !model.queuedTurnsForSelectedConversation.isEmpty
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            proxy.scrollTo(bottomAnchorId, anchor: .bottom)
            isAtBottom = true
        }
    }
}

private struct ChatBottomOffsetPreferenceKey: PreferenceKey {
    static let defaultValue = 0.0

    static func reduce(value: inout Double, nextValue: () -> Double) {
        value = nextValue()
    }
}

private struct ModelPicker: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 8) {
            Picker("Model", selection: $model.selectedModelId) {
                ForEach(model.models) { option in
                    Text(option.displayName)
                        .tag(option.id)
                }
            }
            .frame(width: 190)

            Picker("Effort", selection: $model.selectedReasoningEffort) {
                let efforts = model.models.first(where: { $0.id == model.selectedModelId })?.supportedReasoningEfforts
                    ?? ["medium", "high"]
                ForEach(efforts, id: \.self) { effort in
                    Text(effort.uppercased())
                        .tag(effort)
                }
            }
            .frame(width: 150)
        }
        .labelsHidden()
        .tint(AbitatTheme.primary)
    }
}

private struct ComposerView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 10) {
            if !model.activePluginSuggestions.isEmpty {
                PluginSuggestionPopup()
            }

            PromptTextView(
                text: $model.prompt,
                selectedRange: $model.promptSelectionRange,
                autocompleteIsActive: !model.activePluginSuggestions.isEmpty,
                onAutocompleteMove: { delta in model.moveActivePluginSuggestion(by: delta) },
                onAutocompleteAccept: { model.acceptActivePluginSuggestion() },
                onAutocompleteDismiss: { model.dismissPluginSuggestions() }
            ) {
                model.sendPrompt()
            }
            .frame(minHeight: 92, maxHeight: 140)

            HStack(spacing: 10) {
                Picker("", selection: $model.deliveryMode) {
                    ForEach(AppModel.DeliveryMode.allCases) { mode in
                        Text(mode.label)
                            .tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 162)

                Text(model.isBusy ? "Busy" : "Ready")
                    .font(AbitatTheme.Fonts.label)
                    .foregroundStyle(model.isBusy ? AbitatTheme.warning : AbitatTheme.success)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(AbitatTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius))

                Spacer()

                IconActionButton(
                    title: model.selectedConversation == nil ? "Start" : "Send",
                    systemName: "paperplane.fill",
                    isPrimary: true
                ) {
                    model.sendPrompt()
                }
                .disabled(model.isSending)
            }
        }
        .padding(14)
        .background(AbitatTheme.canvasRaised)
    }
}

private struct PluginSuggestionPopup: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(model.activePluginSuggestions.enumerated()), id: \.element.id) { index, suggestion in
                Button {
                    model.activePluginSuggestionIndex = index
                    model.acceptActivePluginSuggestion()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: suggestion.kind == "plugin" ? "shippingbox" : "sparkle.magnifyingglass")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(index == model.activePluginSuggestionIndex ? AbitatTheme.text : AbitatTheme.muted)
                            .frame(width: 22)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(suggestion.displayName)
                                .font(AbitatTheme.Fonts.rowTitle)
                                .foregroundStyle(AbitatTheme.text)
                                .lineLimit(1)
                            if !suggestion.description.isEmpty {
                                Text(suggestion.description)
                                    .font(AbitatTheme.Fonts.caption)
                                    .foregroundStyle(AbitatTheme.muted)
                                    .lineLimit(1)
                            }
                        }

                        Spacer()

                        Text("@\(suggestion.invocationName)")
                            .font(AbitatTheme.Fonts.mono)
                            .foregroundStyle(AbitatTheme.subdued)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 11)
                    .frame(minHeight: 42)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(index == model.activePluginSuggestionIndex ? AbitatTheme.primarySoft : Color.clear)
            }
        }
        .background(AbitatTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                .stroke(AbitatTheme.borderSoft, lineWidth: 1)
        )
    }
}

private struct MessageBubble: View {
    let message: DesktopMessage

    var body: some View {
        HStack(alignment: .top) {
            if message.role == "user" {
                Spacer(minLength: 60)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(message.role.uppercased())
                        .font(AbitatTheme.Fonts.label)
                        .foregroundStyle(roleColor(message.role))
                    Spacer()
                    Text("#\(message.sequence)")
                        .font(.caption2)
                        .foregroundStyle(AbitatTheme.muted)
                }
                Text(message.content)
                    .font(AbitatTheme.Fonts.message)
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(message.role == "user" ? AbitatTheme.surfaceSelected : AbitatTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.panelRadius))
            .overlay(
                RoundedRectangle(cornerRadius: AbitatTheme.panelRadius)
                    .stroke(message.role == "user" ? AbitatTheme.primary.opacity(0.38) : AbitatTheme.borderSoft, lineWidth: 1)
            )
            .frame(maxWidth: 820, alignment: .leading)

            if message.role != "user" {
                Spacer(minLength: 60)
            }
        }
    }
}

private struct QueuedTurnRow: View {
    @EnvironmentObject private var model: AppModel
    let turn: AppModel.QueuedTurnDraft
    @State private var prompt: String

    init(turn: AppModel.QueuedTurnDraft) {
        self.turn = turn
        _prompt = State(initialValue: turn.prompt)
    }

    var body: some View {
        BorderedPanel {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    StatusPill(label: "QUEUED", color: AbitatTheme.warning)
                    Spacer()
                    Button {
                        model.updateQueuedTurn(turn, prompt: prompt)
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.plain)
                    .help("Update queued prompt")

                    Button {
                        model.deleteQueuedTurn(turn)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(AbitatTheme.danger)
                    .help("Remove queued prompt")
                }

                TextField("Queued prompt", text: $prompt, axis: .vertical)
                    .textFieldStyle(.plain)
                    .foregroundStyle(AbitatTheme.text)
                    .padding(10)
                    .background(AbitatTheme.surfaceHigh)
                    .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: AbitatTheme.controlRadius)
                            .stroke(AbitatTheme.borderSoft, lineWidth: 1)
                    )
            }
        }
    }
}

private struct FilesPanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if model.generatedFiles.isEmpty {
                EmptyStateView(
                    systemName: "doc.text.magnifyingglass",
                    title: "No generated files",
                    message: "Files created by the selected thread will appear here."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(model.generatedFiles) { file in
                            BorderedPanel {
                                HStack(spacing: 12) {
                                    Image(systemName: "doc")
                                        .font(.system(size: 18, weight: .medium))
                                        .foregroundStyle(AbitatTheme.muted)
                                        .frame(width: 28)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(file.name)
                                            .font(AbitatTheme.Fonts.rowTitle)
                                            .lineLimit(1)
                                        Text(file.path)
                                            .font(AbitatTheme.Fonts.caption)
                                            .foregroundStyle(AbitatTheme.muted)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))
                                        .font(AbitatTheme.Fonts.label)
                                        .foregroundStyle(AbitatTheme.muted)
                                    IconActionButton(title: "Reveal", systemName: "magnifyingglass") {
                                        model.reveal(file)
                                    }
                                }
                            }
                        }
                    }
                    .padding(16)
                }
            }
        }
    }
}

private struct AutomationsPanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 0) {
            Group {
                if model.automations.isEmpty {
                    EmptyStateView(
                        systemName: "clock.arrow.circlepath",
                        title: "No automations",
                        message: "Create a local automation for recurring Codex work on this Mac."
                    )
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(model.automations) { automation in
                                AutomationRow(automation: automation)
                            }
                        }
                        .padding(16)
                    }
                }
            }

            Divider()
                .overlay(AbitatTheme.borderSoft)

            AutomationForm()
                .frame(width: 340)
        }
    }
}

private struct AutomationRow: View {
    @EnvironmentObject private var model: AppModel
    let automation: AutomationSummary

    private var isActive: Bool {
        automation.status == "ACTIVE"
    }

    var body: some View {
        BorderedPanel {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: isActive ? "clock.badge.checkmark" : "pause.circle")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(isActive ? AbitatTheme.success : AbitatTheme.warning)
                    .frame(width: 30, height: 30)
                    .background(AbitatTheme.surfaceHigh)
                    .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))

                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(automation.name)
                            .font(AbitatTheme.Fonts.panelTitle)
                            .lineLimit(1)
                        StatusPill(
                            label: automation.status,
                            color: isActive ? AbitatTheme.success : AbitatTheme.warning
                        )
                    }

                    Text(automation.prompt)
                        .font(AbitatTheme.Fonts.body)
                        .foregroundStyle(AbitatTheme.muted)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 8) {
                        metadataChip(systemName: "calendar", text: automation.rrule)
                        metadataChip(systemName: "cpu", text: automation.model)
                        metadataChip(systemName: "speedometer", text: automation.reasoningEffort.uppercased())
                    }
                }

                Spacer(minLength: 12)

                IconActionButton(
                    title: isActive ? "Pause" : "Resume",
                    systemName: isActive ? "pause.fill" : "play.fill"
                ) {
                    model.toggleAutomation(automation)
                }
            }
        }
    }

    private func metadataChip(systemName: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: systemName)
                .font(.system(size: 10, weight: .medium))
            Text(text)
                .font(AbitatTheme.Fonts.label)
                .lineLimit(1)
        }
        .foregroundStyle(AbitatTheme.muted)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(AbitatTheme.canvasRaised)
        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                .stroke(AbitatTheme.borderSoft, lineWidth: 1)
        )
    }
}

private struct AutomationForm: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle")
                    .foregroundStyle(AbitatTheme.muted)
                Text("New Automation")
                    .font(AbitatTheme.Fonts.panelTitle)
            }

            field("Name", text: $model.automationDraft.name)
            field("Schedule", text: $model.automationDraft.rrule)
            field("Working Directory", text: $model.automationDraft.cwd)

            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Model")
                Picker("Model", selection: $model.automationDraft.model) {
                    ForEach(model.models) { option in
                        Text(option.displayName)
                            .tag(option.id)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Effort")
                Picker("Effort", selection: $model.automationDraft.reasoningEffort) {
                    ForEach(["none", "minimal", "low", "medium", "high", "xhigh"], id: \.self) { effort in
                        Text(effort.uppercased())
                            .tag(effort)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Prompt")
                TextEditor(text: $model.automationDraft.prompt)
                    .font(AbitatTheme.Fonts.body)
                    .scrollContentBackground(.hidden)
                    .foregroundStyle(AbitatTheme.text)
                    .padding(8)
                    .frame(minHeight: 178)
                    .background(AbitatTheme.surfaceHigh)
                    .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                            .stroke(AbitatTheme.borderSoft, lineWidth: 1)
                    )
            }

            IconActionButton(title: "Create", systemName: "checkmark.circle.fill", isPrimary: true) {
                model.createAutomation()
            }
            .disabled(model.isCreatingAutomation)

            Spacer()
        }
        .padding(16)
        .background(AbitatTheme.canvasRaised)
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel(title)
            TextField(title, text: text)
                .textFieldStyle(.plain)
                .padding(10)
                .background(AbitatTheme.surfaceHigh)
                .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                        .stroke(AbitatTheme.borderSoft, lineWidth: 1)
                )
        }
    }

    private func fieldLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(AbitatTheme.Fonts.smallLabel)
            .foregroundStyle(AbitatTheme.subdued)
    }
}

private struct PairingPanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            BorderedPanel {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Label("Phone Pairing", systemImage: "iphone.gen2")
                            .font(AbitatTheme.Fonts.panelTitle)
                        Spacer()
                        IconActionButton(title: "New", systemName: "qrcode", isPrimary: true) {
                            model.createPairing()
                        }
                    }

                    if let pairing = model.pairing {
                        VStack(spacing: 12) {
                            QRCodeView(payload: pairing.payloadJson)
                                .frame(width: 246, height: 246)

                            Text(pairing.manualCode)
                                .font(AbitatTheme.Fonts.monoEmphasis)
                                .textSelection(.enabled)

                            Text("Expires \(pairing.expiresAt)")
                                .font(AbitatTheme.Fonts.caption)
                                .foregroundStyle(AbitatTheme.muted)

                            IconActionButton(title: "Copy Payload", systemName: "doc.on.doc") {
                                copyToPasteboard(pairing.payloadJson)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        VStack(spacing: 10) {
                            Image(systemName: "qrcode.viewfinder")
                                .font(.system(size: 30, weight: .regular))
                                .foregroundStyle(AbitatTheme.subdued)
                            Text("No active pairing payload")
                                .font(AbitatTheme.Fonts.rowTitle)
                            Text("Create a pairing code to connect the iPhone app to this Mac.")
                                .font(AbitatTheme.Fonts.body)
                                .foregroundStyle(AbitatTheme.muted)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: 260)
                        }
                        .frame(maxWidth: .infinity, minHeight: 280)
                    }
                }
            }
            .frame(width: 376)

            BorderedPanel {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Endpoints", systemImage: "network")
                        .font(AbitatTheme.Fonts.panelTitle)
                    endpointRow("Desktop", model.ready?.desktopEndpoint.absoluteString)
                    endpointRow("Phone", model.ready?.localEndpoint.absoluteString)
                    endpointRow("Relay", model.ready?.relayEndpoint.absoluteString)
                    endpointRow("Relay ID", model.ready?.relayId)
                }
            }

            Spacer()
        }
        .padding(16)
    }

    private func endpointRow(_ title: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(AbitatTheme.Fonts.smallLabel)
                .foregroundStyle(AbitatTheme.subdued)
            Text(value ?? "-")
                .font(AbitatTheme.Fonts.mono)
                .textSelection(.enabled)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(AbitatTheme.canvasRaised)
        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                .stroke(AbitatTheme.borderSoft, lineWidth: 1)
        )
    }
}

private struct LogsPanel: View {
    @EnvironmentObject private var model: AppModel
    private let maxRenderedLogCharacters = 80_000

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Diagnostics", systemImage: "terminal")
                        .font(AbitatTheme.Fonts.panelTitle)
                    Text(logSubtitle)
                        .font(AbitatTheme.Fonts.caption)
                        .foregroundStyle(AbitatTheme.muted)
                        .lineLimit(1)
                }
                Spacer()
                IconActionButton(title: "Load", systemName: "arrow.down.doc") {
                    model.loadDiagnostics()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(AbitatTheme.canvasRaised)

            Divider()
                .overlay(AbitatTheme.borderSoft)

            ScrollView {
                if !renderedLogData.isEmpty {
                    Text(renderedLogData)
                        .font(AbitatTheme.Fonts.mono)
                        .foregroundStyle(AbitatTheme.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                } else {
                    EmptyStateView(
                        systemName: "terminal",
                        title: "No diagnostics loaded",
                        message: "Load the local diagnostics log for this Mac session."
                    )
                }
            }
            .background(AbitatTheme.canvas)
        }
        .onAppear {
            model.loadDiagnostics()
        }
    }

    private var logSubtitle: String {
        guard let diagnostics = model.diagnostics else {
            return "Local helper logs"
        }
        let size = ByteCountFormatter.string(fromByteCount: Int64(diagnostics.size), countStyle: .file)
        if diagnostics.size > maxRenderedLogCharacters {
            return "\(size), rendering latest \(maxRenderedLogCharacters.formatted()) characters"
        }
        return diagnostics.truncated ? "\(size), showing latest entries" : "\(size), full log"
    }

    private var renderedLogData: String {
        guard let diagnostics = model.diagnostics else {
            return ""
        }
        guard diagnostics.size > maxRenderedLogCharacters else {
            return diagnostics.data
        }
        return String(diagnostics.data.suffix(maxRenderedLogCharacters))
    }
}

private struct RemotePanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            BorderedPanel {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Label("Remote Control", systemImage: "display")
                            .font(AbitatTheme.Fonts.panelTitle)
                        Spacer()
                        IconActionButton(title: "Pair Phone", systemName: "iphone.gen2") {
                            model.createPairing()
                        }
                    }

                    HStack(spacing: 10) {
                        StatusPill(label: model.status?.transport.uppercased() ?? "RELAY", color: AbitatTheme.primary)
                        StatusPill(label: model.status?.relayConnected == true ? "CONNECTED" : "LOCAL", color: model.status?.relayConnected == true ? AbitatTheme.success : AbitatTheme.muted)
                    }

                    endpointLine("Host", model.status?.macId)
                    endpointLine("Local", model.status?.localEndpoint)
                    endpointLine("Relay", model.status?.relayEndpoint)
                }
            }
            .frame(maxWidth: 720)
            Spacer()
        }
        .padding(16)
    }

    private func endpointLine(_ title: String, _ value: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title.uppercased())
                .font(AbitatTheme.Fonts.smallLabel)
                .foregroundStyle(AbitatTheme.subdued)
                .frame(width: 58, alignment: .leading)
            Text(value ?? "-")
                .font(AbitatTheme.Fonts.mono)
                .textSelection(.enabled)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(AbitatTheme.canvasRaised)
        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous)
                .stroke(AbitatTheme.borderSoft, lineWidth: 1)
        )
    }
}

private struct SidebarRow: View {
    let title: String
    let subtitle: String
    let badge: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(AbitatTheme.Fonts.rowTitle)
                        .foregroundStyle(AbitatTheme.text)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(AbitatTheme.Fonts.caption)
                        .foregroundStyle(AbitatTheme.muted)
                        .lineLimit(1)
                }
                Spacer()
                if let badge {
                    Text(badge)
                        .font(AbitatTheme.Fonts.label)
                        .foregroundStyle(isSelected ? AbitatTheme.text : AbitatTheme.muted)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(isSelected ? AbitatTheme.primary.opacity(0.16) : AbitatTheme.surfaceHigh)
                        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.controlRadius, style: .continuous))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
            .background(isSelected ? AbitatTheme.surfaceSelected : AbitatTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.panelRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AbitatTheme.panelRadius, style: .continuous)
                    .stroke(isSelected ? AbitatTheme.primary.opacity(0.75) : AbitatTheme.borderSoft, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .help(title)
    }
}

private struct TokenMetric: View {
    let title: String
    let value: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(AbitatTheme.Fonts.smallLabel)
                .foregroundStyle(AbitatTheme.muted)
            Text(TokenFormatter.compact(value ?? 0))
                .font(AbitatTheme.Fonts.metric)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ErrorToast: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(AbitatTheme.warning)
            Text(message)
                .font(AbitatTheme.Fonts.caption)
                .lineLimit(3)
            Button(action: dismiss) {
                Image(systemName: "xmark")
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .frame(maxWidth: 480, alignment: .leading)
        .background(AbitatTheme.surfaceHigh)
        .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.panelRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AbitatTheme.panelRadius, style: .continuous)
                .stroke(AbitatTheme.borderSoft, lineWidth: 1)
        )
    }
}

private struct QRCodeView: View {
    let payload: String

    var body: some View {
        if let image = QRCode.make(payload) {
            Image(nsImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: AbitatTheme.panelRadius, style: .continuous))
        } else {
            Rectangle()
                .fill(AbitatTheme.surfaceHigh)
                .overlay(Image(systemName: "qrcode"))
        }
    }
}

private enum QRCode {
    static func make(_ value: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)) else {
            return nil
        }
        let rep = NSCIImageRep(ciImage: output)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }
}

private func roleColor(_ role: String) -> Color {
    switch role {
    case "user": return AbitatTheme.primary
    case "assistant": return AbitatTheme.muted
    case "runtime": return AbitatTheme.warning
    default: return AbitatTheme.muted
    }
}

private func statusColor(_ status: String) -> Color {
    switch status {
    case "running", "queued", "awaiting_approval", "preparing":
        return AbitatTheme.warning
    case "failed", "error":
        return AbitatTheme.danger
    case "complete", "completed", "approved":
        return AbitatTheme.success
    default:
        return AbitatTheme.muted
    }
}

private func copyToPasteboard(_ value: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
}

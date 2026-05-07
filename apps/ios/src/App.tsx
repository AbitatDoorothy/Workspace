import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { PairingScreen } from "./screens/PairingScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { ProjectDetailScreen } from "./screens/ProjectDetailScreen";
import { ConversationScreen } from "./screens/ConversationScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { useThreadCompletionNotifications } from "./notifications/thread-completion-notifications";
import { useMobileStore } from "./state/mobile-store";
import { colors } from "./theme";
import type { ConversationSummary, ProjectSummary, RouteName } from "./types";

export default function App() {
  const store = useMobileStore();
  const [route, setRoute] = useState<RouteName>("workspace");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  useThreadCompletionNotifications(store.api, store.isPaired);

  if (store.isRestoring) {
    return (
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.canvas,
          flex: 1,
          justifyContent: "center"
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!store.isPaired) {
    return (
      <PairingScreen
        api={store.api}
        apiUrl={store.apiUrl}
        onApiUrlChange={store.setApiUrl}
        onPaired={(pairing) => {
          void store.savePairing(pairing);
          setRoute("workspace");
        }}
      />
    );
  }

  return (
    <View style={{ backgroundColor: colors.canvas, flex: 1 }}>
      {route === "workspace" ? (
        <WorkspaceScreen
          bootstrap={store.bootstrap}
          error={store.bootstrapError}
          onNavigate={setRoute}
        />
      ) : null}
      {route === "projects" ? (
        <ProjectsScreen
          api={store.api}
          onProject={(nextProject) => {
            setProject(nextProject);
            setRoute("project");
          }}
        />
      ) : null}
      {route === "project" && project ? (
        <ProjectDetailScreen
          api={store.api}
          onBack={() => setRoute("projects")}
          onConversation={(nextConversation) => {
            setConversation(nextConversation);
            setRoute("conversation");
          }}
          project={project}
        />
      ) : null}
      {route === "conversation" && conversation ? (
        <ConversationScreen
          api={store.api}
          conversation={conversation}
          onBack={() => setRoute(project ? "project" : "projects")}
        />
      ) : null}
      {route === "settings" ? (
        <SettingsScreen
          onSignOut={() => {
            void store.signOut();
            setRoute("workspace");
          }}
          pairing={store.pairing}
        />
      ) : null}

      <View
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderTopWidth: 1,
          flexDirection: "row",
          paddingBottom: 18,
          paddingTop: 8
        }}
      >
        {(["workspace", "projects", "settings"] as RouteName[]).map((item) => (
          <Pressable
            key={item}
            onPress={() => setRoute(item)}
            style={{ alignItems: "center", flex: 1 }}
          >
            <Text
              style={{
                color: route === item ? colors.primary : colors.muted,
                fontSize: 12,
                fontWeight: "800",
                textTransform: "capitalize"
              }}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

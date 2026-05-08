import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiClient } from "../api/client";
import { Header } from "../components/Controls";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { ProjectSummary } from "../types";

interface ProjectsScreenProps {
  api: ApiClient;
  onProject(project: ProjectSummary): void;
}

export function ProjectsScreen({ api, onProject }: ProjectsScreenProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      try {
        const nextProjects = await api.listProjects();

        if (!cancelled) {
          setProjects(nextProjects);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load projects");
        }
      }
    }

    void loadProjects();
    const timer = setInterval(loadProjects, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api]);

  return (
    <Screen>
      <Header
        eyebrow="Projects"
        title="Codex Projects"
        subtitle="Folders are synced from the Codex desktop app on your Mac."
      />

      <View style={styles.folderGrid}>
        {projects.map((project) => (
          <Pressable
            key={project.id}
            onPress={() => onProject(project)}
            style={({ pressed }) => [styles.folderTile, pressed && styles.folderTilePressed]}
          >
            <View style={styles.folderIcon} accessibilityLabel={`${project.name} folder`}>
              <View style={styles.folderTab} />
              <View style={styles.folderBody}>
                <View style={styles.folderShine} />
              </View>
            </View>
            <Text numberOfLines={2} style={styles.folderName}>
              {project.name}
            </Text>
            <Text numberOfLines={1} style={styles.folderMeta}>
              {project.conversationCount ?? 0} conversations
            </Text>
          </Pressable>
        ))}
      </View>

      {projects.length === 0 && !error ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.subtitle}>No Codex projects are available yet.</Text>
        </View>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  folderBody: {
    backgroundColor: "#e6ad3f",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderTopRightRadius: 8,
    height: 64,
    overflow: "hidden",
    width: 96
  },
  folderGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    justifyContent: "space-between"
  },
  folderIcon: {
    height: 82,
    justifyContent: "flex-end",
    width: 104
  },
  folderMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
    textAlign: "center"
  },
  folderName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 10,
    minHeight: 36,
    textAlign: "center"
  },
  folderShine: {
    backgroundColor: "rgba(255,255,255,0.22)",
    height: 18,
    width: "100%"
  },
  folderTab: {
    backgroundColor: "#f4c45f",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    height: 20,
    left: 0,
    position: "absolute",
    top: 0,
    width: 48
  },
  folderTile: {
    alignItems: "center",
    minHeight: 150,
    width: "47%"
  },
  folderTilePressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }]
  }
});

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { ApiClient } from "../api/client";
import { Header, StatusPill } from "../components/Controls";
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
    api
      .listProjects()
      .then(setProjects)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Unable to load projects")
      );
  }, [api]);

  return (
    <Screen>
      <Header
        eyebrow="Projects"
        title="Mac Projects"
        subtitle="Projects created in Abitat Workspace are available here."
      />

      {projects.map((project) => (
        <Pressable key={project.id} onPress={() => onProject(project)} style={sharedStyles.card}>
          <View style={[sharedStyles.row, { justifyContent: "space-between" }]}>
            <Text style={sharedStyles.value}>{project.name}</Text>
            <StatusPill status={project.repoSyncStatus} />
          </View>
          <Text style={[sharedStyles.subtitle, { color: colors.muted }]} numberOfLines={2}>
            {project.hostLocalPath ?? project.repoUrl}
          </Text>
        </Pressable>
      ))}

      {projects.length === 0 && !error ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.subtitle}>No Mac projects are available yet.</Text>
        </View>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </Screen>
  );
}

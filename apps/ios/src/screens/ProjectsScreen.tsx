import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";

import type { ApiClient } from "../api/client";
import { colors } from "../theme";
import type { ProjectSummary } from "../types";

interface ProjectsScreenProps {
  api: ApiClient;
  initialProjects?: ProjectSummary[];
  onProject(project: ProjectSummary): void;
  onProjectsLoaded?(projects: ProjectSummary[]): void;
  onSettings(): void;
  refreshEnabled?: boolean;
}

const CELESTIAL_STARS = [
  { left: "4%", opacity: 0.22, size: 1, top: "8%" },
  { left: "14%", opacity: 0.38, size: 1.5, top: "24%" },
  { left: "28%", opacity: 0.24, size: 1, top: "6%" },
  { left: "42%", opacity: 0.32, size: 1, top: "16%" },
  { left: "58%", opacity: 0.18, size: 1, top: "5%" },
  { left: "74%", opacity: 0.34, size: 1.5, top: "12%" },
  { left: "88%", opacity: 0.2, size: 1, top: "20%" },
  { left: "10%", opacity: 0.3, size: 1, top: "34%" },
  { left: "31%", opacity: 0.5, size: 2, top: "30%" },
  { left: "50%", opacity: 0.28, size: 1, top: "38%" },
  { left: "67%", opacity: 0.34, size: 1.5, top: "32%" },
  { left: "91%", opacity: 0.42, size: 1, top: "37%" },
  { left: "6%", opacity: 0.2, size: 1, top: "48%" },
  { left: "22%", opacity: 0.38, size: 1.5, top: "54%" },
  { left: "39%", opacity: 0.28, size: 1, top: "50%" },
  { left: "59%", opacity: 0.24, size: 1, top: "58%" },
  { left: "82%", opacity: 0.36, size: 1.5, top: "52%" },
  { left: "96%", opacity: 0.22, size: 1, top: "61%" },
  { left: "13%", opacity: 0.3, size: 1, top: "70%" },
  { left: "34%", opacity: 0.2, size: 1, top: "76%" },
  { left: "53%", opacity: 0.38, size: 1.5, top: "72%" },
  { left: "71%", opacity: 0.24, size: 1, top: "80%" },
  { left: "90%", opacity: 0.36, size: 2, top: "75%" },
  { left: "8%", opacity: 0.28, size: 1, top: "88%" },
  { left: "26%", opacity: 0.42, size: 1.5, top: "94%" },
  { left: "46%", opacity: 0.22, size: 1, top: "90%" },
  { left: "64%", opacity: 0.28, size: 1, top: "96%" },
  { left: "86%", opacity: 0.2, size: 1, top: "91%" }
] as const;

const BIG_DIPPER_STARS = [
  { left: "59%", top: "24%" },
  { left: "64%", top: "27%" },
  { left: "69%", top: "31%" },
  { left: "75%", top: "37%" },
  { left: "73%", top: "45%" },
  { left: "82%", top: "48%" },
  { left: "85%", top: "40%" }
] as const;

export function ProjectsScreen({
  api,
  initialProjects = [],
  onProject,
  onProjectsLoaded,
  onSettings,
  refreshEnabled = true
}: ProjectsScreenProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  useEffect(() => {
    if (!refreshEnabled) {
      return;
    }

    let cancelled = false;

    async function loadProjects() {
      try {
        const nextProjects = await api.listProjects();

        if (!cancelled) {
          setProjects(nextProjects);
          onProjectsLoaded?.(nextProjects);
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
  }, [api, onProjectsLoaded, refreshEnabled]);

  return (
    <SafeAreaView style={styles.voidScreen}>
      <StatusBar barStyle="light-content" />
      <View pointerEvents="none" style={styles.starField}>
        {CELESTIAL_STARS.map((star, index) => (
          <View
            key={`star-${star.left}-${star.top}-${index}`}
            style={[
              styles.star,
              {
                height: star.size,
                left: star.left,
                opacity: star.opacity,
                top: star.top,
                width: star.size
              }
            ]}
          />
        ))}
        {BIG_DIPPER_STARS.map((star, index) => (
          <View
            key={`dipper-${star.left}-${star.top}-${index}`}
            style={[styles.constellationStar, { left: star.left, top: star.top }]}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={styles.brand}>
            ABITAT
          </Text>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            hitSlop={12}
            onPress={onSettings}
            style={({ pressed }) => [
              styles.settingsButton,
              pressed ? styles.settingsButtonPressed : null
            ]}
          >
            <Feather color="#ffffff" name="settings" size={19} />
          </Pressable>
        </View>

        <View style={styles.projectsSection}>
          <Text style={styles.sectionTitle}>PROJECTS</Text>
          <View style={styles.projectList}>
            {projects.map((project) => (
              <Pressable
                accessibilityLabel={`Open ${project.name}`}
                accessibilityRole="button"
                key={project.id}
                onPress={() => onProject(project)}
                style={({ pressed }) => [
                  styles.projectRow,
                  pressed ? styles.projectRowPressed : null
                ]}
              >
                <Feather name="folder" size={24} color="#f2f2f2" />
                <Text numberOfLines={1} style={styles.projectName}>
                  {project.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {projects.length === 0 && !error ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No projects are available yet.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 30
  },
  constellationStar: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    height: 4,
    opacity: 0.96,
    position: "absolute",
    shadowColor: "#ffffff",
    shadowOpacity: 0.72,
    shadowRadius: 7,
    width: 4
  },
  content: {
    minHeight: "100%",
    paddingBottom: 96,
    paddingHorizontal: 24,
    paddingTop: 28
  },
  emptyState: {
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 30,
    padding: 16
  },
  emptyStateText: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 13,
    lineHeight: 18
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 24
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  projectList: {
    gap: 22
  },
  projectName: {
    color: "#f7f7f7",
    flex: 1,
    fontSize: 20,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 27
  },
  projectRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 20,
    minHeight: 32
  },
  projectRowPressed: {
    opacity: 0.62,
    transform: [{ scale: 0.99 }]
  },
  projectsSection: {
    gap: 24,
    marginTop: 38
  },
  scroll: {
    flex: 1
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 20
  },
  settingsButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  settingsButtonPressed: {
    opacity: 0.62,
    transform: [{ scale: 0.98 }]
  },
  star: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    position: "absolute"
  },
  starField: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000"
  },
  voidScreen: {
    backgroundColor: "#000000",
    flex: 1
  }
});

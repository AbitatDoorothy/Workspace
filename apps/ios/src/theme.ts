import { StyleSheet } from "react-native";

export const colors = {
  canvas: "#080a0f",
  surface: "#121620",
  surfaceHigh: "#1b2130",
  border: "#283244",
  text: "#f7f8fb",
  muted: "#9ca7bd",
  primary: "#4f8df7",
  primarySoft: "#173158",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444"
};

export const sharedStyles = StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 18
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 16
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  value: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700"
  },
  input: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    minHeight: 46,
    paddingHorizontal: 12
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  buttonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800"
  }
});

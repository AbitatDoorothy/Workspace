import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { colors, sharedStyles } from "../theme";

interface ButtonProps {
  accessibilityLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  onPress(): void;
  variant?: "primary" | "secondary" | "danger";
}

export function Button({
  accessibilityLabel,
  children,
  disabled,
  onPress,
  variant = "primary"
}: ButtonProps) {
  const baseStyle =
    variant === "primary" ? sharedStyles.primaryButton : sharedStyles.secondaryButton;
  const dangerStyle =
    variant === "danger"
      ? {
          backgroundColor: "#3a1418",
          borderColor: "#7f1d1d"
        }
      : null;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[baseStyle, dangerStyle, disabled && { opacity: 0.5 }]}
    >
      <Text style={sharedStyles.buttonText}>{children}</Text>
    </Pressable>
  );
}

export function Header({
  eyebrow,
  subtitle,
  title
}: {
  eyebrow?: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <View>
      {eyebrow ? <Text style={sharedStyles.label}>{eyebrow}</Text> : null}
      <Text style={sharedStyles.title}>{title}</Text>
      {subtitle ? <Text style={sharedStyles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const color =
    status === "online" || status === "active"
      ? colors.success
      : status === "failed" || status === "error"
        ? colors.danger
        : colors.warning;

  return (
    <View
      style={{
        alignItems: "center",
        borderColor: color,
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 5
      }}
    >
      <Text style={{ color, fontSize: 12, fontWeight: "800", textTransform: "uppercase" }}>
        {status}
      </Text>
    </View>
  );
}

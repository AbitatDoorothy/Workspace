import { access } from "node:fs/promises";
import { join } from "node:path";

const requiredFiles = [
  "app.json",
  "src/App.tsx",
  "src/api/client.ts",
  "src/state/mobile-store.ts",
  "src/screens/PairingScreen.tsx",
  "src/screens/WorkspaceScreen.tsx",
  "src/screens/ProjectsScreen.tsx",
  "src/screens/ProjectDetailScreen.tsx",
  "src/screens/ConversationScreen.tsx",
  "src/screens/RemoteControlScreen.tsx",
  "src/screens/SettingsScreen.tsx"
];

await Promise.all(requiredFiles.map((file) => access(join(process.cwd(), file))));
console.log(`validated ${requiredFiles.length} iPhone app files`);

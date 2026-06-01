import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listPluginSuggestions,
  publicPluginSuggestions,
  resolvePluginSkillSelections
} from "../src/local-control/plugin-suggestions";

describe("local plugin suggestions", () => {
  it("discovers plugin manifests, bundled skills, and local skills without exposing paths publicly", async () => {
    const root = await createCatalogFixture();

    const suggestions = await listPluginSuggestions({
      agentsHome: join(root, ".agents"),
      codexHome: join(root, ".codex")
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        description: "Use Browser to inspect local apps.",
        displayName: "Browser",
        id: "plugin:browser",
        invocationName: "browser",
        kind: "plugin",
        pluginName: "browser",
        source: "plugin"
      }),
      expect.objectContaining({
        description: "Browser automation for local web targets.",
        displayName: "Browser",
        id: "skill:browser:browser",
        invocationName: "browser:browser",
        kind: "skill",
        pluginName: "browser",
        skillName: "browser",
        source: "plugin-skill"
      }),
      expect.objectContaining({
        description: "Read and review PDF files.",
        displayName: "Pdf",
        id: "skill:codex:pdf",
        invocationName: "pdf",
        kind: "skill",
        skillName: "pdf",
        source: "codex-skill"
      }),
      expect.objectContaining({
        description: "Build HyperFrames videos.",
        displayName: "Hyperframes",
        id: "skill:agents:hyperframes",
        invocationName: "hyperframes",
        kind: "skill",
        skillName: "hyperframes",
        source: "agents-skill"
      })
    ]);

    expect(publicPluginSuggestions(suggestions)).toEqual(
      suggestions.map(({ path: _path, ...suggestion }) => suggestion)
    );
  });

  it("resolves only known skill-capable ids for Codex app-server input", async () => {
    const root = await createCatalogFixture();

    await expect(
      resolvePluginSkillSelections(
        [{ id: "skill:browser:browser" }, { id: "plugin:browser" }, { id: "skill:evil:bad" }],
        {
          agentsHome: join(root, ".agents"),
          codexHome: join(root, ".codex")
        }
      )
    ).resolves.toEqual([
      {
        name: "browser",
        path: join(
          root,
          ".codex",
          "plugins",
          "cache",
          "openai-bundled",
          "browser",
          "1",
          "skills",
          "browser",
          "SKILL.md"
        ),
        type: "skill"
      },
      {
        name: "browser",
        path: join(
          root,
          ".codex",
          "plugins",
          "cache",
          "openai-bundled",
          "browser",
          "1",
          "skills",
          "browser",
          "SKILL.md"
        ),
        type: "skill"
      }
    ]);
  });
});

async function createCatalogFixture() {
  const root = await mkdtemp(join(tmpdir(), "abitat-plugin-suggestions-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const pluginRoot = join(
    codexHome,
    "plugins",
    "cache",
    "openai-bundled",
    "browser",
    "1"
  );

  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
  await mkdir(join(pluginRoot, "skills", "browser"), { recursive: true });
  await mkdir(join(codexHome, "skills", "pdf"), { recursive: true });
  await mkdir(join(agentsHome, "skills", "hyperframes"), { recursive: true });

  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "browser",
      description: "Browser plugin fallback description.",
      keywords: ["browser", "local"],
      skills: "./skills/",
      interface: {
        displayName: "Browser",
        shortDescription: "Use Browser to inspect local apps."
      }
    }),
    "utf8"
  );
  await writeFile(
    join(pluginRoot, "skills", "browser", "SKILL.md"),
    `---
name: browser
description: "Browser automation for local web targets."
---

# Browser
`,
    "utf8"
  );
  await writeFile(
    join(codexHome, "skills", "pdf", "SKILL.md"),
    `---
name: pdf
description: "Read and review PDF files."
---
`,
    "utf8"
  );
  await writeFile(
    join(agentsHome, "skills", "hyperframes", "SKILL.md"),
    `---
name: hyperframes
description: "Build HyperFrames videos."
---
`,
    "utf8"
  );

  return root;
}

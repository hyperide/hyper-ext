import { describe, expect, it, mock } from "bun:test";

// Control which files "exist" and their content
const fsFiles = new Map<string, string>();

mock.module("node:fs/promises", () => ({
  readFile: async (p: string) => {
    const content = fsFiles.get(p);
    if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return content;
  },
  access: async (p: string) => {
    if (!fsFiles.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  },
  readdir: async (p: string) => {
    const prefix = p.endsWith("/") ? p : `${p}/`;
    const entries = new Set<string>();
    for (const key of fsFiles.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment) entries.add(segment);
      }
    }
    return [...entries];
  },
}));

function pkg(deps: Record<string, string> = {}, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ dependencies: deps, ...extra });
}

function setup(files: Record<string, string>) {
  fsFiles.clear();
  for (const [p, content] of Object.entries(files)) fsFiles.set(p, content);
}

const { detectRepoType, detectProjectType, detectCssSystem } = await import("../services/ProjectDetector");

const ROOT = "/workspace";

// ─── detectRepoType ──────────────────────────────────────────────────────────

describe("detectRepoType", () => {
  it("returns simple for a plain project", async () => {
    setup({ [`${ROOT}/package.json`]: pkg({ vite: "^5" }) });
    expect(await detectRepoType(ROOT)).toBe("simple");
  });

  it("returns mono-nx when nx.json present", async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/nx.json`]: "{}" });
    expect(await detectRepoType(ROOT)).toBe("mono-nx");
  });

  it("returns mono-nx when nx in root devDeps", async () => {
    setup({ [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^19" } }) });
    expect(await detectRepoType(ROOT)).toBe("mono-nx");
  });

  it("returns mono-turbo when turbo.json present", async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/turbo.json`]: "{}" });
    expect(await detectRepoType(ROOT)).toBe("mono-turbo");
  });

  it("returns mono-pnpm when pnpm-workspace.yaml present", async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/pnpm-workspace.yaml`]: "packages:\n  - apps/*" });
    expect(await detectRepoType(ROOT)).toBe("mono-pnpm");
  });

  it("returns mono-lerna when lerna.json present", async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/lerna.json`]: "{}" });
    expect(await detectRepoType(ROOT)).toBe("mono-lerna");
  });

  it("returns mono-generic when root package.json has workspaces field", async () => {
    setup({ [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ["packages/*"] }) });
    expect(await detectRepoType(ROOT)).toBe("mono-generic");
  });

  it("returns simple when no monorepo signals", async () => {
    setup({ [`${ROOT}/package.json`]: pkg({ react: "^19" }) });
    expect(await detectRepoType(ROOT)).toBe("simple");
  });
});

// ─── monorepo-aware detectProjectType ────────────────────────────────────────

describe("detectProjectType — monorepo-aware (Nx)", () => {
  it("falls back to sub-package when root has no bundler dep (nx monorepo)", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^19" } }),
      [`${ROOT}/nx.json`]: "{}",
      [`${ROOT}/apps/conloca-app/package.json`]: pkg({ astro: "^4" }),
    });
    expect(await detectProjectType(ROOT)).toBe("vite");
  });

  it("falls back to sub-package for pnpm workspace", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ["apps/*"] }),
      [`${ROOT}/pnpm-workspace.yaml`]: "packages:\n  - apps/*",
      [`${ROOT}/apps/web/package.json`]: pkg({ vite: "^5" }),
    });
    expect(await detectProjectType(ROOT)).toBe("vite");
  });

  it("root package.json wins if it has bundler dep (no sub-package scan)", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^19", vite: "^5" } }),
      [`${ROOT}/apps/other/package.json`]: pkg({ next: "^15" }),
    });
    // root has vite → returns vite without scanning sub-packages
    expect(await detectProjectType(ROOT)).toBe("vite");
  });

  it("returns unknown when no bundler found anywhere in monorepo", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^19" } }),
      [`${ROOT}/nx.json`]: "{}",
      [`${ROOT}/apps/lib/package.json`]: JSON.stringify({ dependencies: { react: "^19" } }),
    });
    expect(await detectProjectType(ROOT)).toBe("unknown");
  });
});

// ─── targets/ directory scanning ─────────────────────────────────────────────

describe("detectCssSystem — targets/ directory (Conloca pattern)", () => {
  it("detects tailwind in targets/ sub-package when root has none", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^22", vite: "^7" } }),
      [`${ROOT}/nx.json`]: "{}",
      [`${ROOT}/targets/conloca-app/package.json`]: pkg({ tailwindcss: "^4", "@tailwindcss/vite": "^4" }),
    });
    expect(await detectCssSystem(ROOT)).toBe("tailwind");
  });

  it("detects tailwind in libs/ sub-package", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^22" } }),
      [`${ROOT}/nx.json`]: "{}",
      [`${ROOT}/libs/ui/package.json`]: pkg({ tailwindcss: "^3" }),
    });
    expect(await detectCssSystem(ROOT)).toBe("tailwind");
  });
});

// ─── monorepo-aware detectCssSystem ──────────────────────────────────────────

describe("detectCssSystem — monorepo-aware (Nx)", () => {
  it("detects tailwind in sub-package when root has none", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^19" } }),
      [`${ROOT}/nx.json`]: "{}",
      [`${ROOT}/apps/app/package.json`]: pkg({ tailwindcss: "^3" }),
    });
    expect(await detectCssSystem(ROOT)).toBe("tailwind");
  });

  it("detects @astrojs/tailwind in sub-package", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^19" } }),
      [`${ROOT}/nx.json`]: "{}",
      [`${ROOT}/apps/app/package.json`]: pkg({ "@astrojs/tailwind": "^5" }),
    });
    expect(await detectCssSystem(ROOT)).toBe("tailwind");
  });

  it("root package.json wins if it has CSS dep", async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: "^19", "styled-components": "^6" } }),
      [`${ROOT}/apps/app/package.json`]: pkg({ tailwindcss: "^3" }),
    });
    expect(await detectCssSystem(ROOT)).toBe("styled-components");
  });

  // Regression: extension.ts pre-resolves pkg and passes it as 2nd arg.
  // Without the fix, the sub-package fallback was gated on `if (!packageJson)`
  // and would NEVER fire on the production path — Conloca's tailwindcss in
  // targets/ stayed invisible → cssSystem: 'unknown' → readonly mode.
  it("finds tailwind in sub-package even when root pkg is pre-passed (production path)", async () => {
    const rootPkg = { devDependencies: { nx: "^22", vite: "^7" } };
    setup({
      [`${ROOT}/package.json`]: JSON.stringify(rootPkg),
      [`${ROOT}/nx.json`]: "{}",
      [`${ROOT}/targets/conloca-app/package.json`]: pkg({ tailwindcss: "^4", "@tailwindcss/vite": "^4" }),
    });
    // Simulate extension.ts: pre-pass pkg as second argument
    expect(await detectCssSystem(ROOT, rootPkg)).toBe("tailwind");
  });
});

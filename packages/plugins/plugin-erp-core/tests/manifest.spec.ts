import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.js";
import { ERP_NAMESPACE, NAMESPACE_SLUG, PLUGIN_ID } from "../src/constants.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("plugin manifest", () => {
  it("satisfies the host manifest schema", () => {
    // The host rejects an invalid manifest at install time. Catching it here
    // turns a failed install into a failed test.
    const parsed = pluginManifestV1Schema.safeParse(manifest);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("declares the identity the namespace was derived from", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.database?.namespaceSlug).toBe(NAMESPACE_SLUG);
    // If either changed, ERP_NAMESPACE - and every migration - would be wrong.
    expect(ERP_NAMESPACE).toContain(NAMESPACE_SLUG);
  });

  it("declares every capability its surfaces need", () => {
    const capabilities = new Set<string>(manifest.capabilities);
    const required = [
      "api.routes.register",
      "database.namespace.migrate",
      "database.namespace.read",
      "database.namespace.write",
      "activity.log.write",
    ];
    for (const capability of required) {
      expect(capabilities.has(capability), `missing capability ${capability}`).toBe(true);
    }
    if ((manifest.tools?.length ?? 0) > 0) {
      expect(capabilities.has("agent.tools.register")).toBe(true);
    }
    if ((manifest.agents?.length ?? 0) > 0) {
      expect(capabilities.has("agents.managed")).toBe(true);
    }
    if ((manifest.jobs?.length ?? 0) > 0) {
      expect(capabilities.has("jobs.schedule")).toBe(true);
    }
  });

  it("exposes every agent-facing operation as a route, because plugin tools are board-only", () => {
    // Core gates /api/plugins/tools and /plugins/tools/execute behind
    // assertBoardOrgAccess, so an agent cannot invoke a plugin tool. Any
    // operation an agent needs must therefore exist as an apiRoute that admits
    // an agent actor.
    const agentReachable = (manifest.apiRoutes ?? []).filter(
      (route) => route.auth === "agent" || route.auth === "board-or-agent",
    );
    const agentOperations = [
      "list-documents",
      "get-document",
      "get-provenance",
      "submit-extraction",
      "compute-diff",
      "transition-revision",
      "verify-asset",
    ];
    const reachableKeys = new Set(agentReachable.map((route) => route.routeKey));
    for (const key of agentOperations) {
      expect(reachableKeys.has(key), `${key} must be reachable by an agent`).toBe(true);
    }
  });

  it("keeps release and grant management out of agent reach", () => {
    const humanOnly = ["prepare-release-approval", "link-release-approval", "bootstrap"];
    for (const routeKey of humanOnly) {
      const route = (manifest.apiRoutes ?? []).find((entry) => entry.routeKey === routeKey);
      expect(route, `${routeKey} route missing`).toBeDefined();
      expect(route?.auth, `${routeKey} must be board-only`).toBe("board");
    }
  });

  it("gives every route a unique method+path and every tool a unique name", () => {
    const routeSignatures = (manifest.apiRoutes ?? []).map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(new Set(routeSignatures).size, "duplicate method+path").toBe(routeSignatures.length);

    const routeKeys = (manifest.apiRoutes ?? []).map((route) => route.routeKey);
    expect(new Set(routeKeys).size, "duplicate routeKey").toBe(routeKeys.length);

    const toolNames = (manifest.tools ?? []).map((tool) => tool.name);
    expect(new Set(toolNames).size, "duplicate tool name").toBe(toolNames.length);
  });

  it("points every managed agent at instructions that exist on disk", () => {
    expect(manifest.agents?.length).toBe(3);
    for (const agent of manifest.agents ?? []) {
      const assetPath = agent.instructions?.assetPath;
      expect(assetPath, `${agent.agentKey} has no instructions assetPath`).toBeTruthy();
      expect(
        existsSync(path.join(packageRoot, assetPath!, "AGENTS.md")),
        `${agent.agentKey}: ${assetPath}/AGENTS.md is missing`,
      ).toBe(true);
    }
  });

  it("starts every managed agent paused with a zero budget", () => {
    // An ERP agent that wakes up and starts spending the moment the plugin is
    // installed would be a surprise. Operators opt in.
    for (const agent of manifest.agents ?? []) {
      expect(agent.status, `${agent.agentKey} should start paused`).toBe("paused");
      expect(agent.budgetMonthlyCents, `${agent.agentKey} should start at zero budget`).toBe(0);
    }
  });

  it("claims a single top-level UI route with a matching sidebar", () => {
    const slots = manifest.ui?.slots ?? [];
    const page = slots.find((slot) => slot.type === "page");
    const routeSidebar = slots.find((slot) => slot.type === "routeSidebar");
    expect(page?.routePath).toBe("erp");
    // A routeSidebar only takes over the sidebar when its routePath matches the
    // page's; a mismatch silently leaves the host sidebar in place.
    expect(routeSidebar?.routePath).toBe(page?.routePath);
  });
});

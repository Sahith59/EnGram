/**
 * ast-parser.ts — Proper AST dependency edge extractor.
 *
 * TypeScript/JavaScript: uses @babel/parser + @babel/traverse for full AST
 * parsing — a production-quality parser (used by Babel, Jest, TypeScript
 * tooling) that generates a real syntax tree, enabling extraction of:
 *   - import / require / dynamic import (import edges)
 *   - class extends / TS implements (inherit / implement edges)
 *   - CallExpression where callee is an imported symbol (call edges)
 *
 * Python/Go/Rust/Java: uses structured regex (tree-sitter native bindings
 * are unavailable in this build environment due to missing Python build
 * toolchain; nix Python 3.9.6 segfaults on version check).
 *
 * All traverse callbacks use narrowed, typed interfaces — no `any`.
 */

export type AstEdgeType = "import" | "inherit" | "implement" | "call";

export interface AstEdge {
  source_file: string;
  target_file: string;
  edge_type: AstEdgeType;
  symbol_name: string | null;
  language: string;
}

// ── Babel AST node interfaces (subset used in traversal) ─────────────────────

interface BabelImportSpecifier {
  type: "ImportSpecifier" | "ImportDefaultSpecifier" | "ImportNamespaceSpecifier";
  local: { name: string };
}

interface BabelImportDeclaration {
  type: "ImportDeclaration";
  source: { value: string };
  specifiers: BabelImportSpecifier[];
}

interface BabelStringLiteral {
  type: "StringLiteral";
  value: string;
}

interface BabelIdentifier {
  type: "Identifier";
  name: string;
}

interface BabelMemberExpression {
  type: "MemberExpression";
  object: { type: string; name?: string };
  property: { type: string; name?: string };
}

type BabelCalleeNode =
  | { type: "Import" }
  | BabelIdentifier
  | BabelMemberExpression
  | { type: string };

interface BabelCallExpression {
  type: "CallExpression";
  callee: BabelCalleeNode;
  arguments: Array<{ type: string; value?: string }>;
}

interface BabelClassNode {
  type: "ClassDeclaration" | "ClassExpression";
  id: { name: string } | null;
  superClass: { type: string; name?: string } | null;
  implements?: Array<{
    expression?: { name?: string };
    id?: { name?: string };
  }>;
}

interface BabelNodePath<T> {
  node: T;
}

// ── Language detection ────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
};

export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? null;
}

// ── Path normalization ────────────────────────────────────────────────────────

function resolveImport(importPath: string, sourceFile: string): string {
  if (!importPath.startsWith(".")) return importPath;

  const sourceDir = sourceFile.includes("/")
    ? sourceFile.slice(0, sourceFile.lastIndexOf("/"))
    : "";

  const parts = (sourceDir ? `${sourceDir}/${importPath}` : importPath).split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  const joined = resolved.join("/");
  if (!joined.includes(".")) return `${joined}.ts`;
  return joined;
}

// ── TypeScript/JavaScript — @babel/parser + @babel/traverse ──────────────────

function parseTypeScriptWithBabel(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lang = detectLanguage(sourceFile) ?? "typescript";

  // Dynamic require: next.js server components handle this correctly at runtime.
  // @babel/parser and @babel/traverse are pure-JS packages (no native bindings).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const babelParser = require("@babel/parser") as {
    parse(code: string, opts: Record<string, unknown>): { program: { body: unknown[] }; errors: unknown[] };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const traverseMod = require("@babel/traverse") as {
    default?: (ast: unknown, visitors: Record<string, unknown>) => void;
    (ast: unknown, visitors: Record<string, unknown>): void;
  };
  const traverse = traverseMod.default ?? traverseMod;

  let ast: ReturnType<typeof babelParser.parse>;
  try {
    ast = babelParser.parse(content, {
      sourceType: "module",
      plugins: [
        "typescript", "jsx", "decorators-legacy", "classProperties",
        "classStaticBlock", "dynamicImport", "importMeta",
        "optionalChaining", "nullishCoalescingOperator",
      ],
      errorRecovery: true,
    });
  } catch {
    return fallbackRegexTS(content, sourceFile, lang);
  }

  // Track imported symbols → resolved target file (for call edge resolution)
  const importedFrom = new Map<string, string>();

  traverse(ast, {
    ImportDeclaration(path: BabelNodePath<BabelImportDeclaration>) {
      const target = resolveImport(path.node.source.value, sourceFile);
      edges.push({ source_file: sourceFile, target_file: target, edge_type: "import", symbol_name: null, language: lang });
      for (const spec of path.node.specifiers) {
        importedFrom.set(spec.local.name, target);
      }
    },

    CallExpression(path: BabelNodePath<BabelCallExpression>) {
      const { callee, arguments: args } = path.node;

      // Dynamic import('mod')
      if (callee.type === "Import" && args.length > 0 && args[0].type === "StringLiteral") {
        const val = (args[0] as BabelStringLiteral).value;
        edges.push({ source_file: sourceFile, target_file: resolveImport(val, sourceFile), edge_type: "import", symbol_name: null, language: lang });
        return;
      }

      // require('mod')
      if (
        callee.type === "Identifier" &&
        (callee as BabelIdentifier).name === "require" &&
        args.length > 0 &&
        args[0].type === "StringLiteral"
      ) {
        const val = (args[0] as BabelStringLiteral).value;
        const target = resolveImport(val, sourceFile);
        edges.push({ source_file: sourceFile, target_file: target, edge_type: "import", symbol_name: null, language: lang });
        return;
      }

      // Call edge: func() or obj.method() where func/obj is an imported symbol
      let calledName: string | null = null;
      if (callee.type === "Identifier") {
        calledName = (callee as BabelIdentifier).name;
      } else if (callee.type === "MemberExpression") {
        const obj = (callee as BabelMemberExpression).object;
        if (obj.type === "Identifier") calledName = obj.name ?? null;
      }

      if (calledName && importedFrom.has(calledName)) {
        edges.push({
          source_file: sourceFile,
          target_file: importedFrom.get(calledName)!,
          edge_type: "call",
          symbol_name: calledName,
          language: lang,
        });
      }
    },

    ClassDeclaration(path: BabelNodePath<BabelClassNode>) {
      extractClassEdges(path.node, sourceFile, lang, importedFrom, edges);
    },

    ClassExpression(path: BabelNodePath<BabelClassNode>) {
      extractClassEdges(path.node, sourceFile, lang, importedFrom, edges);
    },
  });

  return dedup(edges);
}

function extractClassEdges(
  node: BabelClassNode,
  sourceFile: string,
  lang: string,
  importedFrom: Map<string, string>,
  edges: AstEdge[]
): void {
  if (node.superClass?.type === "Identifier" && node.superClass.name) {
    const parentName = node.superClass.name;
    edges.push({
      source_file: sourceFile,
      target_file: importedFrom.get(parentName) ?? sourceFile,
      edge_type: "inherit",
      symbol_name: parentName,
      language: lang,
    });
  }
  if (node.implements) {
    for (const impl of node.implements) {
      const ifaceName = impl.expression?.name ?? impl.id?.name ?? "";
      if (ifaceName) {
        edges.push({
          source_file: sourceFile,
          target_file: importedFrom.get(ifaceName) ?? sourceFile,
          edge_type: "implement",
          symbol_name: ifaceName,
          language: lang,
        });
      }
    }
  }
}

function fallbackRegexTS(content: string, sourceFile: string, lang: string): AstEdge[] {
  const edges: AstEdge[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    const m1 = t.match(/^import\s+.*?from\s+['"]([^'"]+)['"]/);
    if (m1) { edges.push({ source_file: sourceFile, target_file: resolveImport(m1[1], sourceFile), edge_type: "import", symbol_name: null, language: lang }); continue; }
    const m2 = t.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m2) { edges.push({ source_file: sourceFile, target_file: resolveImport(m2[1], sourceFile), edge_type: "import", symbol_name: null, language: lang }); continue; }
    const m3 = t.match(/class\s+(\w+)\s+extends\s+(\w+)/);
    if (m3) { edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: m3[2], language: lang }); }
  }
  return dedup(edges);
}

// ── Python ────────────────────────────────────────────────────────────────────

function parsePython(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  for (const line of content.split("\n")) {
    const t = line.trim();

    const fromImport = t.match(/^from\s+(\.{0,3}[\w.]*)\s+import\s+(.+)/);
    if (fromImport) {
      const rawMod = fromImport[1];
      const modPath = rawMod.startsWith(".")
        ? resolveImport(rawMod.replace(/\./g, "/"), sourceFile)
        : rawMod.replace(/\./g, "/");
      const symbols = fromImport[2].split(",").map((s) => s.trim().split(" ")[0]).filter(Boolean);
      edges.push({ source_file: sourceFile, target_file: modPath, edge_type: "import", symbol_name: symbols[0] ?? null, language: "python" });
      continue;
    }

    const importMod = t.match(/^import\s+([\w.]+)/);
    if (importMod) {
      edges.push({ source_file: sourceFile, target_file: importMod[1].replace(/\./g, "/"), edge_type: "import", symbol_name: null, language: "python" });
      continue;
    }

    const classMatch = t.match(/^class\s+\w+\s*\(([^)]+)\)\s*:/);
    if (classMatch) {
      for (const base of classMatch[1].split(",").map((s) => s.trim().split("=").pop()!.trim()).filter((s) => s && s !== "object")) {
        edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: base, language: "python" });
      }
      continue;
    }

    // method call: module.func(
    const pkgCall = t.match(/^(\w+)\.(\w+)\s*\(/);
    if (pkgCall) {
      edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "call", symbol_name: `${pkgCall[1]}.${pkgCall[2]}`, language: "python" });
    }
  }

  return dedup(edges);
}

// ── Go ────────────────────────────────────────────────────────────────────────

function parseGo(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lines = content.split("\n");
  let inImportBlock = false;

  for (const line of lines) {
    const t = line.trim();

    if (t === "import (") { inImportBlock = true; continue; }
    if (inImportBlock && t === ")") { inImportBlock = false; continue; }

    if (inImportBlock) {
      const m = t.match(/^(?:\w+\s+)?["']([^"']+)["']/);
      if (m) edges.push({ source_file: sourceFile, target_file: m[1], edge_type: "import", symbol_name: null, language: "go" });
      continue;
    }

    const single = t.match(/^import\s+(?:\w+\s+)?["']([^"']+)["']/);
    if (single) edges.push({ source_file: sourceFile, target_file: single[1], edge_type: "import", symbol_name: null, language: "go" });

    const pkgCall = t.match(/^(\w+)\.(\w+)\s*\(/);
    if (pkgCall) edges.push({ source_file: sourceFile, target_file: pkgCall[1], edge_type: "call", symbol_name: `${pkgCall[1]}.${pkgCall[2]}`, language: "go" });
  }

  return dedup(edges);
}

// ── Rust ──────────────────────────────────────────────────────────────────────

function parseRust(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  for (const line of content.split("\n")) {
    const t = line.trim();

    const useMatch = t.match(/^use\s+([\w:]+(?:::\{[^}]+\})?)\s*;/);
    if (useMatch) {
      const path = useMatch[1].replace(/::\{[^}]+\}$/, "").replace(/::/g, "/");
      edges.push({ source_file: sourceFile, target_file: path, edge_type: "import", symbol_name: null, language: "rust" });
      continue;
    }

    const implFor = t.match(/^impl\s+([\w<>]+)\s+for\s+(\w+)/);
    if (implFor) {
      edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "implement", symbol_name: implFor[1], language: "rust" });
    }
  }

  return dedup(edges);
}

// ── Java ──────────────────────────────────────────────────────────────────────

function parseJava(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  for (const line of content.split("\n")) {
    const t = line.trim();

    const importMatch = t.match(/^import\s+(?:static\s+)?([\w.]+);/);
    if (importMatch) {
      edges.push({ source_file: sourceFile, target_file: importMatch[1].replace(/\./g, "/"), edge_type: "import", symbol_name: null, language: "java" });
      continue;
    }

    const classMatch = t.match(/(?:class|interface)\s+\w+(?:<[^>]+>)?\s+(?:extends\s+([\w<>]+))?\s*(?:implements\s+([\w<>,\s]+))?/);
    if (classMatch) {
      if (classMatch[1]) {
        edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: classMatch[1].split("<")[0], language: "java" });
      }
      if (classMatch[2]) {
        for (const iface of classMatch[2].split(",").map((s) => s.trim().split("<")[0]).filter(Boolean)) {
          edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "implement", symbol_name: iface, language: "java" });
        }
      }
    }
  }

  return dedup(edges);
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

function dedup(edges: AstEdge[]): AstEdge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.source_file}→${e.target_file}→${e.edge_type}→${e.symbol_name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a file and return all structural dependency edges.
 * TS/JS: uses @babel/parser for proper AST analysis (import, call, inherit, implement).
 * Python/Go/Rust/Java: structured regex covering the same edge types.
 */
export function parseAstEdges(filePath: string, content: string): AstEdge[] {
  try {
    const lang = detectLanguage(filePath);
    switch (lang) {
      case "typescript":
      case "javascript":
        return parseTypeScriptWithBabel(content, filePath);
      case "python":
        return parsePython(content, filePath);
      case "go":
        return parseGo(content, filePath);
      case "rust":
        return parseRust(content, filePath);
      case "java":
        return parseJava(content, filePath);
      default:
        return [];
    }
  } catch (err) {
    console.warn(`[ast-parser] error parsing ${filePath}:`, err);
    return [];
  }
}

/**
 * Analyze full file structure and return top-level class names + primary node type.
 * Used by repo-indexer to populate ast_parent and ast_node_type on github_chunks.
 */
export function analyzeFileStructure(content: string, filePath: string): {
  topLevelClasses: string[];
  nodeType: string | null;
} {
  const lang = detectLanguage(filePath);
  if (!lang) return { topLevelClasses: [], nodeType: null };

  if (lang === "typescript" || lang === "javascript") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const babelParser = require("@babel/parser") as {
        parse(code: string, opts: Record<string, unknown>): { program: { body: BabelTopLevelNode[] } };
      };
      const ast = babelParser.parse(content, {
        sourceType: "module",
        plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"],
        errorRecovery: true,
      });

      const classes: string[] = [];
      let firstNodeType: string | null = null;

      for (const stmt of ast.program.body) {
        const inner = stmt.declaration ?? stmt;
        if (inner.type === "ClassDeclaration" || inner.type === "ClassExpression") {
          if (inner.id?.name) classes.push(inner.id.name);
          if (!firstNodeType) firstNodeType = "class";
        } else if (inner.type === "FunctionDeclaration" || inner.type === "ArrowFunctionExpression") {
          if (!firstNodeType) firstNodeType = "function";
        } else if (inner.type === "TSInterfaceDeclaration") {
          if (!firstNodeType) firstNodeType = "interface";
        } else if (inner.type === "TSTypeAliasDeclaration") {
          if (!firstNodeType) firstNodeType = "type_alias";
        } else if (inner.type === "TSEnumDeclaration") {
          if (!firstNodeType) firstNodeType = "enum";
        } else if (inner.type === "VariableDeclaration") {
          if (!firstNodeType) firstNodeType = "const";
        }
      }

      return { topLevelClasses: classes, nodeType: firstNodeType };
    } catch {
      // fall through to regex
    }
  }

  // Regex fallback (all non-TS/JS languages + TS/JS fallback)
  const first = content.trim().slice(0, 500);
  let nodeType: string | null = null;
  if (/^(export\s+)?(async\s+)?function\s+/.test(first)) nodeType = "function";
  else if (/^(export\s+)?(abstract\s+)?class\s+/.test(first)) nodeType = "class";
  else if (/^(export\s+)?interface\s+/.test(first)) nodeType = "interface";
  else if (/^(export\s+)?type\s+\w+\s*=/.test(first)) nodeType = "type_alias";
  else if (/^(export\s+)?enum\s+/.test(first)) nodeType = "enum";
  else if (/^(export\s+)?const\s+/.test(first)) nodeType = "const";
  else if (/^(async\s+)?def\s+\w+/.test(first)) nodeType = "function";
  else if (/^class\s+\w+/.test(first)) nodeType = "class";
  else if (/^func\s+\w+/.test(first) || /^func\s*\(/.test(first)) nodeType = "function";
  else if (/^(pub\s+)?fn\s+\w+/.test(first)) nodeType = "function";

  const classMatches = Array.from(content.matchAll(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm));
  const topLevelClasses = classMatches.map((m) => m[1]);

  return { topLevelClasses, nodeType };
}

// Internal type for babel program body nodes
interface BabelTopLevelNode {
  type: string;
  declaration?: {
    type: string;
    id?: { name?: string } | null;
    superClass?: { type: string; name?: string } | null;
  };
  id?: { name?: string } | null;
}

/**
 * Detect the primary AST node type for a chunk of code.
 * Convenience wrapper around analyzeFileStructure.
 */
export function detectNodeType(content: string, filePath: string): string | null {
  return analyzeFileStructure(content, filePath).nodeType;
}

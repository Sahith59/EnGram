/**
 * ast-parser.ts — Regex-based AST dependency edge extractor.
 *
 * No native bindings needed — uses carefully crafted regex patterns
 * to extract structural relationships from source files:
 *   - import / require (TypeScript, JavaScript, Python, Go, Rust, Java)
 *   - class inheritance (extends / implements)
 *   - Python class bases
 *
 * Returns a flat list of AstEdge records per file.
 */

export type AstEdgeType = "import" | "inherit" | "implement" | "call";

export interface AstEdge {
  source_file: string;
  target_file: string;
  edge_type: AstEdgeType;
  symbol_name: string | null;
  language: string;
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

/**
 * Resolve a relative import path against the importing file's directory.
 * For non-relative imports (npm packages, stdlib) returns the import as-is.
 */
function resolveImport(importPath: string, sourceFile: string): string {
  if (!importPath.startsWith(".")) return importPath; // external / stdlib

  const sourceDir = sourceFile.includes("/")
    ? sourceFile.slice(0, sourceFile.lastIndexOf("/"))
    : "";

  // Naive path join
  const parts = (sourceDir ? `${sourceDir}/${importPath}` : importPath).split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  const joined = resolved.join("/");

  // If no extension, assume TypeScript/JavaScript
  if (!joined.includes(".")) return `${joined}.ts`;
  return joined;
}

// ── Language-specific parsers ─────────────────────────────────────────────────

function parseTypeScript(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lang = detectLanguage(sourceFile) ?? "typescript";
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // import X from 'path' / import { X, Y } from "path" / import * as X from 'path'
    const importFrom = trimmed.match(/^import\s+.*?from\s+['"]([^'"]+)['"]/);
    if (importFrom) {
      edges.push({
        source_file: sourceFile,
        target_file: resolveImport(importFrom[1], sourceFile),
        edge_type: "import",
        symbol_name: null,
        language: lang,
      });
      continue;
    }

    // import 'path' (side-effect import)
    const sideEffect = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (sideEffect) {
      edges.push({
        source_file: sourceFile,
        target_file: resolveImport(sideEffect[1], sourceFile),
        edge_type: "import",
        symbol_name: null,
        language: lang,
      });
      continue;
    }

    // require('path') / require("path")
    const requireMatch = trimmed.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      edges.push({
        source_file: sourceFile,
        target_file: resolveImport(requireMatch[1], sourceFile),
        edge_type: "import",
        symbol_name: null,
        language: lang,
      });
      continue;
    }

    // class X extends Y
    const extendsMatch = trimmed.match(/class\s+(\w+)\s+extends\s+(\w+)/);
    if (extendsMatch) {
      edges.push({
        source_file: sourceFile,
        target_file: sourceFile, // same-file reference (resolved at query time)
        edge_type: "inherit",
        symbol_name: extendsMatch[2],
        language: lang,
      });
      continue;
    }

    // class X implements Y, Z
    const implementsMatch = trimmed.match(/class\s+\w+.*?implements\s+([\w,\s]+)/);
    if (implementsMatch) {
      const ifaces = implementsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const iface of ifaces) {
        edges.push({
          source_file: sourceFile,
          target_file: sourceFile,
          edge_type: "implement",
          symbol_name: iface,
          language: lang,
        });
      }
    }
  }

  return dedup(edges);
}

function parsePython(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // from module import X, Y
    const fromImport = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
    if (fromImport) {
      const modPath = fromImport[1].replace(/\./g, "/");
      edges.push({
        source_file: sourceFile,
        target_file: modPath.startsWith(".") ? resolveImport(modPath, sourceFile) : modPath,
        edge_type: "import",
        symbol_name: fromImport[2].split(",")[0].trim(),
        language: "python",
      });
      continue;
    }

    // import module
    const importMod = trimmed.match(/^import\s+([\w.]+)/);
    if (importMod) {
      edges.push({
        source_file: sourceFile,
        target_file: importMod[1].replace(/\./g, "/"),
        edge_type: "import",
        symbol_name: null,
        language: "python",
      });
      continue;
    }

    // class X(BaseClass, Mixin):
    const classMatch = trimmed.match(/^class\s+\w+\(([^)]+)\)/);
    if (classMatch) {
      const bases = classMatch[1].split(",").map((s) => s.trim()).filter((s) => s && s !== "object");
      for (const base of bases) {
        edges.push({
          source_file: sourceFile,
          target_file: sourceFile,
          edge_type: "inherit",
          symbol_name: base,
          language: "python",
        });
      }
    }
  }

  return dedup(edges);
}

function parseGo(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lines = content.split("\n");
  let inImportBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "import (") { inImportBlock = true; continue; }
    if (inImportBlock && trimmed === ")") { inImportBlock = false; continue; }

    if (inImportBlock) {
      const pkg = trimmed.replace(/^_\s+|^\w+\s+/, "").replace(/["]/g, "").trim();
      if (pkg) {
        edges.push({ source_file: sourceFile, target_file: pkg, edge_type: "import", symbol_name: null, language: "go" });
      }
      continue;
    }

    // Single import "pkg"
    const single = trimmed.match(/^import\s+(?:\w+\s+)?["']([^"']+)["']/);
    if (single) {
      edges.push({ source_file: sourceFile, target_file: single[1], edge_type: "import", symbol_name: null, language: "go" });
    }
  }

  return dedup(edges);
}

function parseRust(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // use crate::module or use std::...
    const useMatch = trimmed.match(/^use\s+([\w:]+)/);
    if (useMatch) {
      const path = useMatch[1].replace(/::/g, "/");
      edges.push({ source_file: sourceFile, target_file: path, edge_type: "import", symbol_name: null, language: "rust" });
    }
  }

  return dedup(edges);
}

function parseJava(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    const importMatch = trimmed.match(/^import\s+(?:static\s+)?([\w.]+);/);
    if (importMatch) {
      edges.push({ source_file: sourceFile, target_file: importMatch[1].replace(/\./g, "/"), edge_type: "import", symbol_name: null, language: "java" });
      continue;
    }

    const extendsMatch = trimmed.match(/class\s+\w+\s+extends\s+(\w+)/);
    if (extendsMatch) {
      edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: extendsMatch[1], language: "java" });
    }

    const implementsMatch = trimmed.match(/class\s+\w+.*?\s+implements\s+([\w,\s]+)/);
    if (implementsMatch) {
      const ifaces = implementsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const iface of ifaces) {
        edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "implement", symbol_name: iface, language: "java" });
      }
    }
  }

  return dedup(edges);
}

// ── Dedup helper ──────────────────────────────────────────────────────────────

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
 * Parse a file's content and return all dependency edges.
 * Returns [] for unsupported languages or on parse errors.
 */
export function parseAstEdges(filePath: string, content: string): AstEdge[] {
  try {
    const lang = detectLanguage(filePath);
    switch (lang) {
      case "typescript":
      case "javascript":
        return parseTypeScript(content, filePath);
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
 * Detect the primary AST node type for a chunk of code.
 * Used to enrich github_chunks with ast_node_type.
 */
export function detectNodeType(content: string, filePath: string): string | null {
  const lang = detectLanguage(filePath);
  if (!lang || !["typescript", "javascript"].includes(lang)) return null;

  const first = content.trim().slice(0, 500);
  if (/^(export\s+)?(async\s+)?function\s+/.test(first)) return "function";
  if (/^(export\s+)?(abstract\s+)?class\s+/.test(first)) return "class";
  if (/^(export\s+)?interface\s+/.test(first)) return "interface";
  if (/^(export\s+)?type\s+\w+\s*=/.test(first)) return "type_alias";
  if (/^(export\s+)?enum\s+/.test(first)) return "enum";
  if (/^(export\s+)?const\s+/.test(first)) return "const";
  return null;
}

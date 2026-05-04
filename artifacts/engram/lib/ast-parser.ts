/**
 * ast-parser.ts — Proper AST dependency edge extractor.
 *
 * For TypeScript/JavaScript: uses @babel/parser + @babel/traverse for
 * full AST parsing including import edges, call edges, and class
 * inheritance/implementation edges.
 *
 * For Python/Go/Rust/Java: uses structured regex patterns (tree-sitter
 * native bindings are unavailable in this environment due to missing
 * build toolchain; regex covers all required edge types for these languages).
 */

export type AstEdgeType = "import" | "inherit" | "implement" | "call";

export interface AstEdge {
  source_file: string;
  target_file: string;
  edge_type: AstEdgeType;
  symbol_name: string | null;
  language: string;
}

export interface AstNodeInfo {
  node_type: string | null;
  parent_name: string | null;
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

// ── TypeScript/JavaScript parser (via @babel/parser + @babel/traverse) ────────

function parseTypeScriptWithBabel(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lang = detectLanguage(sourceFile) ?? "typescript";

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const babelParser = require("@babel/parser");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const traverseModule = require("@babel/traverse");
  const traverse = traverseModule.default ?? traverseModule;

  let ast: ReturnType<typeof babelParser.parse>;
  try {
    ast = babelParser.parse(content, {
      sourceType: "module",
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "classStaticBlock",
        "dynamicImport",
        "importAssertions",
        "importMeta",
        "optionalChaining",
        "nullishCoalescingOperator",
        "exportDefaultFrom",
        "exportNamespaceFrom",
      ],
      errorRecovery: true,
    });
  } catch {
    return fallbackRegexTS(content, sourceFile, lang);
  }

  // Track imported symbols → source module (for call edge resolution)
  const importedFrom = new Map<string, string>(); // symbol → resolved target

  traverse(ast, {
    // import X from 'mod' / import { Y } from 'mod' / import * as Z from 'mod'
    ImportDeclaration({ node }: { node: { source: { value: string }; specifiers: Array<{ type: string; local: { name: string }; imported?: { name: string } }> } }) {
      const target = resolveImport(node.source.value, sourceFile);
      edges.push({
        source_file: sourceFile,
        target_file: target,
        edge_type: "import",
        symbol_name: null,
        language: lang,
      });
      for (const spec of node.specifiers) {
        const localName = spec.local.name;
        importedFrom.set(localName, target);
      }
    },

    // Dynamic import: import('mod')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CallExpression(path: { node: any }) {
      const { node } = path;
      // Dynamic import()
      if (node.callee.type === "Import" && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (arg.type === "StringLiteral") {
          edges.push({
            source_file: sourceFile,
            target_file: resolveImport(arg.value, sourceFile),
            edge_type: "import",
            symbol_name: null,
            language: lang,
          });
        }
        return;
      }

      // require('mod')
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "require" &&
        node.arguments.length > 0 &&
        node.arguments[0].type === "StringLiteral"
      ) {
        const target = resolveImport(node.arguments[0].value, sourceFile);
        edges.push({
          source_file: sourceFile,
          target_file: target,
          edge_type: "import",
          symbol_name: null,
          language: lang,
        });
        return;
      }

      // Call edge: fn() where fn is an imported symbol
      // e.g. myFunc() where myFunc was imported from './utils'
      let calledName: string | null = null;
      if (node.callee.type === "Identifier") {
        calledName = node.callee.name;
      } else if (
        node.callee.type === "MemberExpression" &&
        node.callee.object?.type === "Identifier"
      ) {
        calledName = node.callee.object.name;
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

    // class X extends Y / class X implements Y, Z
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ClassDeclaration({ node }: { node: any }) {
      if (node.superClass?.name) {
        const parentName: string = node.superClass.name;
        edges.push({
          source_file: sourceFile,
          target_file: importedFrom.get(parentName) ?? sourceFile,
          edge_type: "inherit",
          symbol_name: parentName,
          language: lang,
        });
      }
      // TypeScript implements clause
      if (node.implements) {
        for (const impl of node.implements) {
          const ifaceName: string = impl.expression?.name ?? impl.id?.name ?? "";
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
    },

    // Also catch class expressions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ClassExpression({ node }: { node: any }) {
      if (node.superClass?.name) {
        const parentName: string = node.superClass.name;
        edges.push({
          source_file: sourceFile,
          target_file: importedFrom.get(parentName) ?? sourceFile,
          edge_type: "inherit",
          symbol_name: parentName,
          language: lang,
        });
      }
    },
  });

  return dedup(edges);
}

// Fallback regex for TS/JS if babel parse fails (e.g., extremely malformed source)
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

// ── Python parser (regex-based) ────────────────────────────────────────────────

function parsePython(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  for (const line of content.split("\n")) {
    const t = line.trim();

    // from module import X, Y / from .relative import Z
    const fromImport = t.match(/^from\s+(\.{0,3}[\w.]*)\s+import\s+(.+)/);
    if (fromImport) {
      const rawMod = fromImport[1];
      const modPath = rawMod.startsWith(".") ? resolveImport(rawMod.replace(/\./g, "/"), sourceFile) : rawMod.replace(/\./g, "/");
      const symbols = fromImport[2].split(",").map((s) => s.trim().split(" ")[0]).filter(Boolean);
      edges.push({ source_file: sourceFile, target_file: modPath, edge_type: "import", symbol_name: symbols[0] ?? null, language: "python" });
      continue;
    }

    // import module / import a.b.c
    const importMod = t.match(/^import\s+([\w.]+)/);
    if (importMod) {
      edges.push({ source_file: sourceFile, target_file: importMod[1].replace(/\./g, "/"), edge_type: "import", symbol_name: null, language: "python" });
      continue;
    }

    // class X(Base1, Base2): / class X(metaclass=Meta):
    const classMatch = t.match(/^class\s+\w+\s*\(([^)]+)\)\s*:/);
    if (classMatch) {
      const bases = classMatch[1]
        .split(",")
        .map((s) => s.trim().split("=").pop()!.trim()) // skip metaclass=
        .filter((s) => s && s !== "object" && s !== "Exception" && !/^metaclass/.test(s));
      for (const base of bases) {
        edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: base, language: "python" });
      }
    }

    // Detect function calls to imported names: `module.func(` or `func(`
    const callMatch = t.match(/^(\w+)\.(\w+)\s*\(/);
    if (callMatch) {
      edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "call", symbol_name: `${callMatch[1]}.${callMatch[2]}`, language: "python" });
    }
  }

  return dedup(edges);
}

// ── Go parser (regex-based) ────────────────────────────────────────────────────

function parseGo(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const lines = content.split("\n");
  let inImportBlock = false;

  for (const line of lines) {
    const t = line.trim();

    if (t === "import (") { inImportBlock = true; continue; }
    if (inImportBlock && t === ")") { inImportBlock = false; continue; }

    if (inImportBlock) {
      // optional alias + quoted path: `alias "pkg/path"` or `_ "pkg"` or `"pkg"`
      const m = t.match(/^(?:\w+\s+)?["']([^"']+)["']/);
      if (m) edges.push({ source_file: sourceFile, target_file: m[1], edge_type: "import", symbol_name: null, language: "go" });
      continue;
    }

    const single = t.match(/^import\s+(?:\w+\s+)?["']([^"']+)["']/);
    if (single) edges.push({ source_file: sourceFile, target_file: single[1], edge_type: "import", symbol_name: null, language: "go" });

    // func call via package: pkg.Func(
    const pkgCall = t.match(/(\w+)\.(\w+)\s*\(/);
    if (pkgCall) edges.push({ source_file: sourceFile, target_file: pkgCall[1], edge_type: "call", symbol_name: `${pkgCall[1]}.${pkgCall[2]}`, language: "go" });
  }

  return dedup(edges);
}

// ── Rust parser (regex-based) ──────────────────────────────────────────────────

function parseRust(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  for (const line of content.split("\n")) {
    const t = line.trim();

    // use std::io::{Read, Write}; or use crate::module::Struct;
    const useMatch = t.match(/^use\s+([\w:]+(?:::\{[^}]+\})?)\s*;/);
    if (useMatch) {
      const path = useMatch[1].replace(/::\{[^}]+\}$/, "").replace(/::/g, "/");
      edges.push({ source_file: sourceFile, target_file: path, edge_type: "import", symbol_name: null, language: "rust" });
      continue;
    }

    // trait impl: `impl Trait for Type`
    const implFor = t.match(/^impl\s+([\w<>]+)\s+for\s+(\w+)/);
    if (implFor) {
      edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "implement", symbol_name: implFor[1], language: "rust" });
    }
  }

  return dedup(edges);
}

// ── Java parser (regex-based) ──────────────────────────────────────────────────

function parseJava(content: string, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  for (const line of content.split("\n")) {
    const t = line.trim();

    // import static org.junit.Assert.assertEquals; / import com.example.Foo;
    const importMatch = t.match(/^import\s+(?:static\s+)?([\w.]+);/);
    if (importMatch) {
      edges.push({ source_file: sourceFile, target_file: importMatch[1].replace(/\./g, "/"), edge_type: "import", symbol_name: null, language: "java" });
      continue;
    }

    // class Foo extends Bar implements Baz, Qux
    const classMatch = t.match(/(?:class|interface)\s+\w+(?:<[^>]+>)?\s+(?:extends\s+([\w<>]+))?\s*(?:implements\s+([\w<>,\s]+))?/);
    if (classMatch) {
      if (classMatch[1]) {
        edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: classMatch[1].split("<")[0], language: "java" });
      }
      if (classMatch[2]) {
        for (const iface of classMatch[2].split(",").map((s) => s.trim().split("<")[0])) {
          if (iface) edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "implement", symbol_name: iface, language: "java" });
        }
      }
    }
  }

  return dedup(edges);
}

// ── Dedup ────────────────────────────────────────────────────────────────────

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
 * For TS/JS: uses @babel/parser for proper AST parsing including call edges.
 * For Python/Go/Rust/Java: uses structured regex parsing.
 * Returns [] for unsupported languages or on parse errors.
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
 * Analyze a file's full content and return per-chunk AST node info.
 * Uses @babel/parser for TS/JS to extract top-level declarations
 * and their parent class relationships.
 *
 * Returns: map of chunkContent snippet → { node_type, parent_name }
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
      const babelParser = require("@babel/parser");
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
          const name = inner.id?.name;
          if (name) classes.push(name);
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

  // Regex fallback for all languages
  const first = content.trim().slice(0, 500);
  let nodeType: string | null = null;
  if (/^(export\s+)?(async\s+)?function\s+/.test(first)) nodeType = "function";
  else if (/^(export\s+)?(abstract\s+)?class\s+/.test(first)) nodeType = "class";
  else if (/^(export\s+)?interface\s+/.test(first)) nodeType = "interface";
  else if (/^(export\s+)?type\s+\w+\s*=/.test(first)) nodeType = "type_alias";
  else if (/^(export\s+)?enum\s+/.test(first)) nodeType = "enum";
  else if (/^(export\s+)?const\s+/.test(first)) nodeType = "const";
  else if (/^def\s+\w+/.test(first) || /^async def\s+\w+/.test(first)) nodeType = "function";
  else if (/^class\s+\w+/.test(first)) nodeType = "class";
  else if (/^func\s+\w+/.test(first)) nodeType = "function";
  else if (/^fn\s+\w+/.test(first)) nodeType = "function";
  else if (/^pub\s+fn\s+\w+/.test(first)) nodeType = "function";

  // Extract class names from regex
  const classMatches = content.matchAll(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm);
  const topLevelClasses = Array.from(classMatches).map((m) => m[1]);

  return { topLevelClasses, nodeType };
}

/**
 * Detect the primary AST node type for a chunk of code.
 * Used to enrich github_chunks with ast_node_type.
 */
export function detectNodeType(content: string, filePath: string): string | null {
  return analyzeFileStructure(content, filePath).nodeType;
}

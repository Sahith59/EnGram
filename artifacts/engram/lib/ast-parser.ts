/**
 * ast-parser.ts — Structural dependency edge extractor using tree-sitter WASM grammars.
 *
 * Uses `web-tree-sitter` (WebAssembly build — no native compilation required) with
 * pre-built grammar WASM files from `tree-sitter-wasms` for all 6 supported languages:
 *   TypeScript, JavaScript, Python, Go, Rust, Java.
 *
 * Extracts four edge types from real AST nodes (not regex):
 *   import   — module/package imports and requires
 *   call     — call sites where the callee is an imported symbol
 *   inherit  — class extends / impl for
 *   implement — class implements (TypeScript, Java, Rust traits)
 *
 * Initialization: Parser.init() is called once (lazy, cached). Language WASM
 * files are loaded from the tree-sitter-wasms package on first use per language.
 */

import Parser from "web-tree-sitter";
import type { SyntaxNode } from "web-tree-sitter";
import { readFileSync } from "fs";
import { resolve as pathResolve } from "path";

export type AstEdgeType = "import" | "inherit" | "implement" | "call";

export interface AstEdge {
  source_file: string;
  target_file: string;
  edge_type: AstEdgeType;
  symbol_name: string | null;
  language: string;
}

// ── Extension → language map ──────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
};

// ── Language → WASM grammar file name map ────────────────────────────────────

const LANG_WASM: Record<string, string> = {
  typescript: "tree-sitter-typescript.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
};

// ── Parser / Language caches ──────────────────────────────────────────────────

let parserInitPromise: Promise<void> | null = null;
const languageCache = new Map<string, Parser.Language>();

function getWasmDir(): string {
  return pathResolve(
    require.resolve("tree-sitter-wasms/package.json"),
    "..",
    "out"
  );
}

async function ensureParserReady(): Promise<void> {
  if (!parserInitPromise) {
    parserInitPromise = Parser.init();
  }
  return parserInitPromise;
}

async function getLanguage(name: string): Promise<Parser.Language | null> {
  if (languageCache.has(name)) return languageCache.get(name)!;

  const wasmFile = LANG_WASM[name];
  if (!wasmFile) return null;

  try {
    const wasmBinary = readFileSync(pathResolve(getWasmDir(), wasmFile));
    const lang = await Parser.Language.load(wasmBinary);
    languageCache.set(name, lang);
    return lang;
  } catch (err) {
    console.warn(`[ast-parser] failed to load grammar for ${name}:`, err);
    return null;
  }
}

// ── Path resolution ───────────────────────────────────────────────────────────

function resolveImport(importPath: string, sourceFile: string): string {
  if (!importPath.startsWith(".")) return importPath;

  const sourceDir = sourceFile.includes("/")
    ? sourceFile.slice(0, sourceFile.lastIndexOf("/"))
    : "";

  const raw = sourceDir ? `${sourceDir}/${importPath}` : importPath;
  const parts = raw.split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  const joined = resolved.join("/");
  return joined.includes(".") ? joined : `${joined}.ts`;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function dedup(edges: AstEdge[]): AstEdge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.source_file}→${e.target_file}→${e.edge_type}→${e.symbol_name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Tree traversal helper ─────────────────────────────────────────────────────

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) out.push(c);
  }
  return out;
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === type) return c;
  }
  return null;
}

function findAllChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === type) out.push(c);
  }
  return out;
}

/** Walk the tree depth-first and collect all nodes matching any of the given types. */
function walkCollect(root: SyntaxNode, types: Set<string>): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (types.has(node.type)) results.push(node);
    for (let i = node.childCount - 1; i >= 0; i--) {
      const c = node.child(i);
      if (c) stack.push(c);
    }
  }
  return results;
}

// ── JavaScript / TypeScript edge extraction ───────────────────────────────────

function extractJsEdges(tree: Parser.Tree, sourceFile: string, lang: string): AstEdge[] {
  const edges: AstEdge[] = [];
  const importedSymbols = new Map<string, string>(); // symbol → resolved target file

  const targetTypes = new Set([
    "import_statement",
    "call_expression",
    "class_declaration",
    "class",
  ]);
  const nodes = walkCollect(tree.rootNode, targetTypes);

  for (const node of nodes) {
    switch (node.type) {
      case "import_statement": {
        // import { foo } from "./bar"   or   import foo from "./bar"
        const stringNode = findChild(node, "string");
        if (!stringNode) break;
        const fragment = findChild(stringNode, "string_fragment");
        const modPath = (fragment ?? stringNode).text.replace(/^['"]|['"]$/g, "");
        const target = resolveImport(modPath, sourceFile);
        edges.push({ source_file: sourceFile, target_file: target, edge_type: "import", symbol_name: null, language: lang });

        // Track which local names come from which module (for call edge resolution)
        const clauseNode = findChild(node, "import_clause");
        if (clauseNode) {
          // Default import: identifier child
          const defaultId = findChild(clauseNode, "identifier");
          if (defaultId) importedSymbols.set(defaultId.text, target);

          // Named imports: named_imports → import_specifier → identifier
          const namedImports = findChild(clauseNode, "named_imports");
          if (namedImports) {
            for (const spec of findAllChildren(namedImports, "import_specifier")) {
              const id = findChild(spec, "identifier");
              if (id) importedSymbols.set(id.text, target);
            }
          }

          // Namespace import: namespace_import → identifier
          const nsImport = findChild(clauseNode, "namespace_import");
          if (nsImport) {
            const id = findChild(nsImport, "identifier");
            if (id) importedSymbols.set(id.text, target);
          }
        }
        break;
      }

      case "call_expression": {
        const callee = node.child(0);
        if (!callee) break;
        const args = findChild(node, "arguments");

        // Dynamic import('path') — callee type is "import"
        if (callee.type === "import" && args) {
          const strArg = findChild(args, "string");
          if (strArg) {
            const frag = findChild(strArg, "string_fragment");
            const modPath = (frag ?? strArg).text.replace(/^['"]|['"]$/g, "");
            edges.push({ source_file: sourceFile, target_file: resolveImport(modPath, sourceFile), edge_type: "import", symbol_name: null, language: lang });
          }
          break;
        }

        // require('path')
        if (callee.type === "identifier" && callee.text === "require" && args) {
          const strArg = findChild(args, "string");
          if (strArg) {
            const frag = findChild(strArg, "string_fragment");
            const modPath = (frag ?? strArg).text.replace(/^['"]|['"]$/g, "");
            const target = resolveImport(modPath, sourceFile);
            edges.push({ source_file: sourceFile, target_file: target, edge_type: "import", symbol_name: null, language: lang });
            importedSymbols.set("require", target);
          }
          break;
        }

        // Call edge: identifier() where identifier is an imported symbol
        if (callee.type === "identifier" && importedSymbols.has(callee.text)) {
          edges.push({
            source_file: sourceFile,
            target_file: importedSymbols.get(callee.text)!,
            edge_type: "call",
            symbol_name: callee.text,
            language: lang,
          });
          break;
        }

        // Call edge: obj.method() where obj is an imported symbol
        if (callee.type === "member_expression") {
          const obj = callee.child(0);
          if (obj?.type === "identifier" && importedSymbols.has(obj.text)) {
            const prop = callee.child(2); // dot is child(1)
            edges.push({
              source_file: sourceFile,
              target_file: importedSymbols.get(obj.text)!,
              edge_type: "call",
              symbol_name: prop ? `${obj.text}.${prop.text}` : obj.text,
              language: lang,
            });
          }
        }
        break;
      }

      case "class_declaration":
      case "class": {
        // class Child extends Parent
        const heritage = findChild(node, "class_heritage");
        if (heritage) {
          const superName = findChild(heritage, "identifier");
          if (superName) {
            edges.push({
              source_file: sourceFile,
              target_file: importedSymbols.get(superName.text) ?? sourceFile,
              edge_type: "inherit",
              symbol_name: superName.text,
              language: lang,
            });
          }

          // implements clause (TypeScript)
          for (const impl of findAllChildren(heritage, "type_identifier")) {
            edges.push({
              source_file: sourceFile,
              target_file: importedSymbols.get(impl.text) ?? sourceFile,
              edge_type: "implement",
              symbol_name: impl.text,
              language: lang,
            });
          }
        }
        break;
      }
    }
  }

  return dedup(edges);
}

// ── Python edge extraction ────────────────────────────────────────────────────

function extractPythonEdges(tree: Parser.Tree, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  const targetTypes = new Set(["import_statement", "import_from_statement", "class_definition", "call"]);
  const nodes = walkCollect(tree.rootNode, targetTypes);

  for (const node of nodes) {
    switch (node.type) {
      case "import_statement": {
        // import os  /  import foo.bar
        const dotted = findChild(node, "dotted_name");
        if (dotted) {
          edges.push({ source_file: sourceFile, target_file: dotted.text.replace(/\./g, "/"), edge_type: "import", symbol_name: null, language: "python" });
        }
        break;
      }

      case "import_from_statement": {
        // from .helpers import do_thing  /  from pathlib import Path
        const relImport = findChild(node, "relative_import");
        const dottedName = findChild(node, "dotted_name");
        let modPath = "";

        if (relImport) {
          // relative import: prefix (dots) + optional dotted_name
          const prefix = findChild(relImport, "import_prefix");
          const dots = prefix ? prefix.text.length : 0;
          const subMod = findChild(relImport, "dotted_name");
          const base = subMod ? subMod.text.replace(/\./g, "/") : "";
          // Resolve dots relative to source file directory
          const parts = sourceFile.split("/");
          const dirParts = parts.slice(0, parts.length - dots);
          modPath = base ? [...dirParts, base].join("/") : dirParts.join("/");
        } else if (dottedName) {
          modPath = dottedName.text.replace(/\./g, "/");
        }

        if (modPath) {
          edges.push({ source_file: sourceFile, target_file: modPath, edge_type: "import", symbol_name: null, language: "python" });
        }
        break;
      }

      case "class_definition": {
        // class Foo(Bar, Baz):
        const argList = findChild(node, "argument_list");
        if (argList) {
          for (const child of childrenOf(argList)) {
            if (child.type === "identifier" && child.text !== "object") {
              edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: child.text, language: "python" });
            }
          }
        }
        break;
      }

      case "call": {
        // Python: call node has attribute child (obj.method) or identifier (func)
        const callee = node.child(0);
        if (callee?.type === "attribute") {
          // attribute node: child(0) = object, child(2) = method
          const obj = callee.child(0);
          const method = callee.child(2);
          if (obj?.type === "identifier" && method) {
            edges.push({
              source_file: sourceFile,
              target_file: sourceFile,
              edge_type: "call",
              symbol_name: `${obj.text}.${method.text}`,
              language: "python",
            });
          }
        } else if (callee?.type === "identifier") {
          edges.push({
            source_file: sourceFile,
            target_file: sourceFile,
            edge_type: "call",
            symbol_name: callee.text,
            language: "python",
          });
        }
        break;
      }
    }
  }

  return dedup(edges);
}

// ── Go edge extraction ────────────────────────────────────────────────────────

function extractGoEdges(tree: Parser.Tree, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  const targetTypes = new Set(["import_declaration", "import_spec", "call_expression"]);
  const nodes = walkCollect(tree.rootNode, targetTypes);

  for (const node of nodes) {
    switch (node.type) {
      case "import_spec": {
        // Each import spec: optional alias + string path
        const strNode =
          findChild(node, "interpreted_string_literal") ??
          findChild(node, "raw_string_literal");
        if (strNode) {
          const path = strNode.text.replace(/^["'`]|["'`]$/g, "");
          edges.push({ source_file: sourceFile, target_file: path, edge_type: "import", symbol_name: null, language: "go" });
        }
        break;
      }

      case "import_declaration": {
        // Single-line import: import "path"
        const strNode =
          findChild(node, "interpreted_string_literal") ??
          findChild(node, "raw_string_literal");
        if (strNode) {
          const path = strNode.text.replace(/^["'`]|["'`]$/g, "");
          edges.push({ source_file: sourceFile, target_file: path, edge_type: "import", symbol_name: null, language: "go" });
        }
        break;
      }

      case "call_expression": {
        // fmt.Println(...) → selector_expression
        const callee = node.child(0);
        if (callee?.type === "selector_expression") {
          const pkg = callee.child(0);
          const fn = callee.child(2);
          if (pkg?.type === "identifier" && fn) {
            edges.push({
              source_file: sourceFile,
              target_file: pkg.text,
              edge_type: "call",
              symbol_name: `${pkg.text}.${fn.text}`,
              language: "go",
            });
          }
        }
        break;
      }
    }
  }

  return dedup(edges);
}

// ── Rust edge extraction ──────────────────────────────────────────────────────

function collectRustPath(node: SyntaxNode): string {
  // Recursively collect scoped_identifier / scoped_use_list path as a string
  if (node.type === "identifier" || node.type === "type_identifier") return node.text;
  if (node.type === "scoped_identifier") {
    const left = node.child(0);
    const right = node.child(2);
    if (left && right) return `${collectRustPath(left)}/${collectRustPath(right)}`;
  }
  if (node.type === "scoped_use_list") {
    const base = node.child(0);
    return base ? collectRustPath(base) : "";
  }
  return node.text;
}

function extractRustEdges(tree: Parser.Tree, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  const targetTypes = new Set(["use_declaration", "impl_item", "call_expression"]);
  const nodes = walkCollect(tree.rootNode, targetTypes);

  for (const node of nodes) {
    switch (node.type) {
      case "use_declaration": {
        // use std::collections::HashMap;
        // use foo::bar::{Baz, Qux};
        const pathNode = node.child(1);
        if (pathNode) {
          const path = collectRustPath(pathNode);
          if (path) {
            edges.push({ source_file: sourceFile, target_file: path, edge_type: "import", symbol_name: null, language: "rust" });
          }
        }
        break;
      }

      case "impl_item": {
        // impl Serialize for MyStruct  →  implement edge
        const forKw = findChild(node, "for");
        if (forKw) {
          const typeIds = findAllChildren(node, "type_identifier");
          if (typeIds.length >= 2) {
            edges.push({
              source_file: sourceFile,
              target_file: sourceFile,
              edge_type: "implement",
              symbol_name: typeIds[0].text,
              language: "rust",
            });
          }
        }
        break;
      }

      case "call_expression": {
        const callee = node.child(0);
        if (!callee) break;

        // serde_json::from_str(...)  →  scoped_identifier (pkg::fn)
        if (callee.type === "scoped_identifier") {
          const pkg = callee.child(0);
          const fn = callee.child(2);
          if (pkg && fn) {
            edges.push({
              source_file: sourceFile,
              target_file: sourceFile,
              edge_type: "call",
              symbol_name: `${pkg.text}::${fn.text}`,
              language: "rust",
            });
          }
        }

        // foo.bar()  →  field_expression (receiver.method)
        if (callee.type === "field_expression") {
          const receiver = callee.child(0);
          const method = callee.child(2);
          if (receiver?.type === "identifier" && method) {
            edges.push({
              source_file: sourceFile,
              target_file: sourceFile,
              edge_type: "call",
              symbol_name: `${receiver.text}.${method.text}`,
              language: "rust",
            });
          }
        }
        break;
      }
    }
  }

  return dedup(edges);
}

// ── Java edge extraction ──────────────────────────────────────────────────────

function collectJavaPath(node: SyntaxNode): string {
  if (node.type === "identifier" || node.type === "type_identifier") return node.text;
  if (node.type === "scoped_identifier") {
    const left = node.child(0);
    const right = node.child(2);
    if (left && right) return `${collectJavaPath(left)}/${collectJavaPath(right)}`;
  }
  return node.text;
}

function extractJavaEdges(tree: Parser.Tree, sourceFile: string): AstEdge[] {
  const edges: AstEdge[] = [];

  const targetTypes = new Set(["import_declaration", "class_declaration", "interface_declaration", "method_invocation"]);
  const nodes = walkCollect(tree.rootNode, targetTypes);

  for (const node of nodes) {
    switch (node.type) {
      case "import_declaration": {
        // import java.util.List;  /  import static org.junit.Assert.*;
        const pathNode =
          findChild(node, "scoped_identifier") ??
          findChild(node, "identifier");
        if (pathNode) {
          edges.push({ source_file: sourceFile, target_file: collectJavaPath(pathNode), edge_type: "import", symbol_name: null, language: "java" });
        }
        break;
      }

      case "class_declaration":
      case "interface_declaration": {
        // extends BaseClass
        const superclass = findChild(node, "superclass");
        if (superclass) {
          const typeId = findChild(superclass, "type_identifier");
          if (typeId) {
            edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "inherit", symbol_name: typeId.text, language: "java" });
          }
        }

        // implements Runnable, Closeable
        const superIfaces = findChild(node, "super_interfaces");
        if (superIfaces) {
          const typeList = findChild(superIfaces, "type_list");
          if (typeList) {
            for (const typeId of findAllChildren(typeList, "type_identifier")) {
              edges.push({ source_file: sourceFile, target_file: sourceFile, edge_type: "implement", symbol_name: typeId.text, language: "java" });
            }
          }
        }
        break;
      }

      case "method_invocation": {
        // List.of(...)  /  foo.bar()  →  identifier + "." + identifier + argument_list
        // child(0) = object (identifier), child(1) = ".", child(2) = method name
        const obj = node.child(0);
        const method = node.child(2);
        if (obj?.type === "identifier" && method) {
          edges.push({
            source_file: sourceFile,
            target_file: sourceFile,
            edge_type: "call",
            symbol_name: `${obj.text}.${method.text}`,
            language: "java",
          });
        }
        break;
      }
    }
  }

  return dedup(edges);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? null;
}

/**
 * Parse a file and return all structural dependency edges.
 * Uses tree-sitter WASM grammars for all 6 languages — proper AST, not regex.
 */
export async function parseAstEdges(filePath: string, content: string): Promise<AstEdge[]> {
  try {
    const lang = detectLanguage(filePath);
    if (!lang) return [];

    await ensureParserReady();
    const language = await getLanguage(lang);
    if (!language) return [];

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(content);

    switch (lang) {
      case "typescript":
      case "javascript":
        return extractJsEdges(tree, filePath, lang);
      case "python":
        return extractPythonEdges(tree, filePath);
      case "go":
        return extractGoEdges(tree, filePath);
      case "rust":
        return extractRustEdges(tree, filePath);
      case "java":
        return extractJavaEdges(tree, filePath);
      default:
        return [];
    }
  } catch (err) {
    console.warn(`[ast-parser] error parsing ${filePath}:`, err);
    return [];
  }
}

/**
 * Analyze file structure: returns top-level class names and primary node type.
 * Used by repo-indexer to populate ast_parent and ast_node_type on github_chunks.
 */
export async function analyzeFileStructure(
  content: string,
  filePath: string
): Promise<{ topLevelClasses: string[]; nodeType: string | null }> {
  try {
    const lang = detectLanguage(filePath);
    if (!lang) return { topLevelClasses: [], nodeType: null };

    await ensureParserReady();
    const language = await getLanguage(lang);
    if (!language) return { topLevelClasses: [], nodeType: null };

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(content);

    const classes: string[] = [];
    let nodeType: string | null = null;

    const topLevelNodes = tree.rootNode.children;
    for (const node of topLevelNodes) {
      switch (node.type) {
        case "import_declaration":
        case "import_statement":
        case "import_from_statement":
        case "use_declaration":
          break;
        case "class_declaration":
        case "class": {
          if (!nodeType) nodeType = "class";
          const idNode = findChild(node, "identifier") ?? findChild(node, "type_identifier");
          if (idNode) classes.push(idNode.text);
          break;
        }
        case "interface_declaration":
          if (!nodeType) nodeType = "interface";
          break;
        case "function_declaration":
        case "function_definition":
        case "function_item":
          if (!nodeType) nodeType = "function";
          break;
        case "impl_item":
          if (!nodeType) nodeType = "impl";
          break;
        case "lexical_declaration":
        case "variable_declaration":
          if (!nodeType) nodeType = "const";
          break;
        case "type_alias_declaration":
          if (!nodeType) nodeType = "type_alias";
          break;
        case "enum_declaration":
          if (!nodeType) nodeType = "enum";
          break;
      }
    }

    return { topLevelClasses: classes, nodeType };
  } catch (err) {
    console.warn(`[ast-parser] analyzeFileStructure error for ${filePath}:`, err);
    return { topLevelClasses: [], nodeType: null };
  }
}

/**
 * Detect the primary AST node type for a chunk of code.
 */
export async function detectNodeType(content: string, filePath: string): Promise<string | null> {
  const { nodeType } = await analyzeFileStructure(content, filePath);
  return nodeType;
}

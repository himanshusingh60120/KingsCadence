#!/usr/bin/env node
/**
 * Catches undefined identifiers that `next build` does not.
 *
 * A call to a function that was never imported is a syntactically valid
 * program; it only fails at runtime, deep inside an async handler, as
 * "X is not defined". A whole 683-row run can burn on that. This walks
 * every module's AST and reports any identifier that is used but never
 * imported, declared, or provided by the runtime.
 *
 *   node scripts/check-refs.mjs
 *
 * Exit code 1 on any problem, so it can gate a deploy.
 */
import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import jsx from "acorn-jsx";

// .jsx files need the JSX plugin or every component file reports a false
// syntax error and the real problems get lost in the noise.
const Parser = acorn.Parser.extend(jsx());

// acorn-walk has no visitors for JSX nodes, so teach the base walker to
// traverse them instead of throwing.
const BASE = { ...walk.base };
for (const t of ["JSXElement","JSXFragment","JSXOpeningElement","JSXClosingElement",
                 "JSXOpeningFragment","JSXClosingFragment","JSXAttribute","JSXSpreadAttribute",
                 "JSXExpressionContainer","JSXText","JSXIdentifier","JSXMemberExpression",
                 "JSXNamespacedName","JSXEmptyExpression"]) {
  BASE[t] = (node, st, c) => {
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === "string") c(x, st); }
      else if (v && typeof v.type === "string") c(v, st);
    }
  };
}

const ROOT = process.cwd();
const FILES = [];
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "scripts"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scan(full);
    else if (/\.(js|jsx|mjs)$/.test(e.name)) FILES.push(full);
  }
})(ROOT);

const GLOBALS = new Set([
  "console","process","Math","JSON","Object","Array","String","Number","Boolean","Date","RegExp",
  "Promise","Set","Map","WeakMap","WeakSet","Error","TypeError","RangeError","Symbol","BigInt",
  "parseInt","parseFloat","isNaN","isFinite","encodeURIComponent","decodeURIComponent",
  "encodeURI","decodeURI","setTimeout","clearTimeout","setInterval","clearInterval",
  "fetch","Response","Request","Headers","URL","URLSearchParams","AbortController",
  "Buffer","globalThis","undefined","NaN","Infinity","structuredClone","TextEncoder","TextDecoder",
  "React","window","document","localStorage","sessionStorage","require","module","exports","__dirname"
]);

let problems = 0;

for (const file of FILES) {
  const src = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = Parser.parse(src, { ecmaVersion: 2022, sourceType: "module", locations: true });
  } catch (e) {
    console.log(`\n${path.relative(ROOT, file)}\n  SYNTAX ERROR at line ${e.loc?.line}: ${e.message}`);
    problems++;
    continue;
  }

  const declared = new Set(GLOBALS);

  // Imports
  walk.simple(ast, {
    ImportDeclaration(n) { for (const sp of n.specifiers) declared.add(sp.local.name); }
  }, BASE);
  // Every binding anywhere in the file. Scope-insensitive on purpose: this
  // check is for "was it ever defined", not for shadowing subtleties.
  walk.full(ast, (n) => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier") declared.add(n.id.name);
    if (n.type === "VariableDeclarator" && n.id.type === "ObjectPattern") {
      for (const p of n.id.properties) {
        if (p.type === "Property" && p.value.type === "Identifier") declared.add(p.value.name);
        if (p.type === "RestElement" && p.argument.type === "Identifier") declared.add(p.argument.name);
      }
    }
    if (n.type === "VariableDeclarator" && n.id.type === "ArrayPattern") {
      for (const el of n.id.elements) if (el && el.type === "Identifier") declared.add(el.name);
    }
    if ((n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ClassDeclaration") && n.id) declared.add(n.id.name);
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      for (const p of n.params) {
        if (p.type === "Identifier") declared.add(p.name);
        if (p.type === "AssignmentPattern" && p.left.type === "Identifier") declared.add(p.left.name);
        if (p.type === "RestElement" && p.argument.type === "Identifier") declared.add(p.argument.name);
        if (p.type === "ObjectPattern") for (const q of p.properties) {
          if (q.type === "Property" && q.value.type === "Identifier") declared.add(q.value.name);
          if (q.type === "RestElement" && q.argument.type === "Identifier") declared.add(q.argument.name);
        }
        if (p.type === "ArrayPattern") for (const el of p.elements) if (el && el.type === "Identifier") declared.add(el.name);
      }
    }
    if (n.type === "CatchClause" && n.param && n.param.type === "Identifier") declared.add(n.param.name);
    if (n.type === "LabeledStatement") declared.add(n.label.name);
  }, BASE);

  // Called identifiers: the shape that produces "X is not defined" at runtime.
  const used = new Map();
  walk.full(ast, (n) => {
    if (n.type === "CallExpression" && n.callee.type === "Identifier") {
      if (!used.has(n.callee.name)) used.set(n.callee.name, n.loc.start.line);
    }
    if (n.type === "NewExpression" && n.callee.type === "Identifier") {
      if (!used.has(n.callee.name)) used.set(n.callee.name, n.loc.start.line);
    }
  }, BASE);

  const missing = [...used.entries()].filter(([name]) => !declared.has(name));
  if (missing.length) {
    console.log(`\n${path.relative(ROOT, file)}`);
    for (const [name, line] of missing) {
      console.log(`  line ${line}: ${name}() is called but never imported or defined`);
      problems++;
    }
  }
}

if (problems) {
  console.log(`\n${problems} problem(s). These fail at RUNTIME, not at build.\n`);
  process.exit(1);
}
console.log(`\nchecked ${FILES.length} files, no undefined references\n`);

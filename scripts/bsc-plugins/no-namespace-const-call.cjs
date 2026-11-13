/**
 * BrighterScript plugin: no method call on a namespaced const or enum member.
 *
 * BrighterScript inlines a namespaced const (or an enum member) only when it
 * ends the expression. With a method call after it, the dotted chain is read as
 * one namespaced function name:
 *
 *     ns.PREFIX.len()      transpiles to   ns_PREFIX_len()
 *
 * That function does not exist, so the call crashes at run time (Function Call
 * Operator on a non-function) and nothing warns at build time. A top-level
 * const (`TOP.len()`) is inlined correctly, and so is a wrapped use
 * (`Len(ns.PREFIX)`). Confirmed on BrighterScript 1.0.0-alpha.56 and alpha.57.
 *
 * Flagged: a call whose callee is a member access on a const that sits inside a
 * namespace, written in full (`ns.PREFIX.len()`, `a.b.DEEP.left(3)`) or relative
 * from inside the namespace (`PREFIX.len()`), and a call on an enum member
 * (`ns.Kind.Movie.len()`). A top-level enum member fails the same way, so any
 * enum is flagged. Not flagged: a top-level const, a variable or AA field, a
 * namespaced function call, and a const used as a plain value.
 *
 * Needs the program scope to tell a const from a variable, so it is a program
 * rule from `lib/bsc-rule.cjs`.
 *
 * Escape hatch: `' bsc-disable-line no-namespace-const-call` or
 * `' bsc-disable-next-line no-namespace-const-call`. A whole-file marker is
 * honored too, as for every rule built on the factory.
 */
'use strict';

const brighterscript = require('brighterscript');
const { createProgramRule, referenceText } = require('../lib/bsc-rule.cjs');

const CODE = 'no-namespace-const-call';
const VENDORED = /(^|[\\/])roku_modules([\\/])/;

function containingNamespace(node) {
  const ns = node.findAncestor(brighterscript.isNamespaceStatement);
  return ns ? ns.getName(brighterscript.ParseMode.BrighterScript) : undefined;
}

/** What `callee.obj` refers to that breaks under a method call, or undefined. */
function brokenReference(scope, callee, namespace) {
  const obj = callee.obj;
  const text = referenceText(obj);
  if (!text) return undefined;

  const constLink = scope.getConstFileLink(text, namespace);
  if (constLink && constLink.item.findAncestor(brighterscript.isNamespaceStatement)) {
    return { text, kind: 'const' };
  }

  if (brighterscript.isDottedGetExpression(obj)) {
    const enumText = referenceText(obj.obj);
    if (enumText && scope.getEnumFileLink(enumText, namespace)) {
      return { text, kind: 'enum member' };
    }
  }
  return undefined;
}

module.exports = () =>
  createProgramRule({
    name: 'jellyrock-no-namespace-const-call',
    analyze({ program, report }) {
      for (const file of Object.values(program.files || {})) {
        if (!brighterscript.isBrsFile(file)) continue;
        if (VENDORED.test(file.srcPath || '')) continue;
        const scope = program.getFirstScopeForFile(file);
        if (!scope) continue;

        file.parser.ast.walk(
          brighterscript.createVisitor({
            CallExpression: (call) => {
              const callee = call.callee;
              if (!brighterscript.isDottedGetExpression(callee)) return;
              const found = brokenReference(scope, callee, containingNamespace(call));
              if (!found) return;
              const method = callee.tokens.name.text;
              report({
                code: CODE,
                severity: 1,
                file,
                location: call.location,
                message: `\`${found.text}.${method}()\` calls a function that does not exist. BrighterScript inlines a namespaced ${found.kind} only when it ends the expression, so with a method call after it the chain compiles to a call of \`${found.text.replace(/\./g, '_')}_${method}()\`, which crashes at run time. Wrap the value instead, for example \`Len(${found.text})\`, or copy it to a variable first.`,
              });
            },
          }),
          { walkMode: brighterscript.WalkMode.visitAllRecursive },
        );
      }
    },
  });

/**
 * BrighterScript plugin: no member access on a namespace-qualified const or
 * enum member.
 *
 * When a namespaced const or enum member is written with its namespace and a
 * member access follows it, BrighterScript reads the whole dotted chain as one
 * namespaced name instead of replacing the const with its value:
 *
 *     ns.PREFIX.len()        compiles to   ns_PREFIX_len()
 *     ns.Kind.Movie.len()    compiles to   ns_Kind_Movie_len()
 *     ns.CFG.width           compiles to   ns_CFG_width
 *
 * None of those names exists, so the app crashes or reads garbage at run time,
 * and nothing warns at build time. The fix is parentheses, which end the chain:
 * `(ns.PREFIX).len()` compiles to `("landing-").len()`.
 *
 * Not flagged, because each compiles correctly: a top-level const or enum
 * member (`TOP.len()`, `TE.A.len()`), the relative form inside the namespace
 * (`PREFIX.len()`), an index (`ns.ARR[0]`), a wrapped use (`Len(ns.PREFIX)`),
 * and a local or parameter that shares a const's name.
 *
 * The test drives the plugin and BrighterScript's own output from one table of
 * shapes, so it fails when a BrighterScript upgrade changes how any of them
 * compiles. Retire the plugin when the broken shapes compile correctly
 * (followup `bsc-namespace-const-inlining-upstream` in `docs/progress.md`).
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

function declaredInNamespace(link) {
  return Boolean(link?.item?.findAncestor(brighterscript.isNamespaceStatement));
}

/**
 * What `obj` names when it is a namespace-qualified const or enum member, or
 * undefined. Resolved with no containing namespace on purpose: only the form
 * written with its namespace breaks, so a relative name, or a local that shares
 * the const's name, must not resolve here.
 */
function qualifiedConstant(scope, obj) {
  const text = referenceText(obj);
  if (!text || !text.includes('.')) return undefined;

  if (declaredInNamespace(scope.getConstFileLink(text))) {
    return { text, kind: 'const' };
  }
  if (brighterscript.isDottedGetExpression(obj)) {
    const enumText = referenceText(obj.obj);
    if (enumText && declaredInNamespace(scope.getEnumFileLink(enumText))) {
      return { text, kind: 'enum member' };
    }
  }
  return undefined;
}

function message(found, member, isCall) {
  const written = `${found.text}.${member}${isCall ? '()' : ''}`;
  const compiled = `${found.text.replace(/\./g, '_')}_${member}${isCall ? '()' : ''}`;
  const fixed = `(${found.text}).${member}${isCall ? '()' : ''}`;
  const what = isCall ? 'calls a function' : 'reads a variable';
  return (
    `\`${written}\` ${what} that does not exist: BrighterScript compiles it to \`${compiled}\`. ` +
    `It replaces a namespaced ${found.kind} with its value only when nothing follows it. ` +
    `Put the ${found.kind} in parentheses: \`${fixed}\`.`
  );
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
            DottedGetExpression: (access) => {
              const found = qualifiedConstant(scope, access.obj);
              if (!found) return;
              const parent = access.parent;
              const isCall = brighterscript.isCallExpression(parent) && parent.callee === access;
              report({
                code: CODE,
                severity: 1,
                file,
                location: (isCall ? parent : access).location,
                message: message(found, access.tokens.name.text, isCall),
              });
            },
          }),
          { walkMode: brighterscript.WalkMode.visitAllRecursive },
        );
      }
    },
  });

/*
  Auto-generates the app settings documentation from settings/settings.json.
  Usage:
    node scripts/generate/settings-docs.cjs [--out docs/user/app-settings.md]
*/

const fs = require('fs');
const path = require('path');

async function main() {
  const repoRoot = process.cwd();
  const settingsPath = path.join(repoRoot, 'settings', 'settings.json');

  // parse args
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  let outFile = path.join(repoRoot, 'docs', 'user', 'app-settings.md');
  if (outIdx !== -1) {
    const custom = args[outIdx + 1];
    if (!custom || custom.startsWith('--')) {
      console.error('Error: --out flag provided without a path');
      process.exit(1);
    }
    outFile = path.isAbsolute(custom) ? custom : path.join(repoRoot, custom);
  }

  // read settings.json
  let raw;
  try {
    raw = await fs.promises.readFile(settingsPath, 'utf8');
  } catch (e) {
    console.error(`Failed to read ${settingsPath}:`, e.message);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`Invalid JSON in ${settingsPath}:`, e.message);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('Expected settings.json to be an array of groups.');
    process.exit(1);
  }

  const parts = [];
  // Ensure markdownlint ignores this auto-generated file
  parts.push('<!-- markdownlint-disable -->');
  parts.push('');
  // Use HTML H1 with id="top" instead of Markdown H1 + separate anchor
  parts.push('<h1 id="top">JellyRock App Settings</h1>');
  parts.push('');
  parts.push('<!--');
  parts.push('  THIS FILE IS AUTO-GENERATED. DO NOT EDIT BY HAND.');
  parts.push('  Run: npm run docs:settings');
  parts.push('-->');
  parts.push('');
  parts.push('This page documents all configurable settings available in the JellyRock app.');
  parts.push('');

  // Top-level Table of Contents (only top-level groups) — no header to match other TOCs
  if (data.length) {
    parts.push('');
    for (const group of data) {
      const gTitle = sanitizeText(group.title || 'Untitled');
      parts.push(`- [${gTitle}](#${makeGroupId([gTitle])})`);
    }
    parts.push('');
  }

  // walk groups and settings
  for (const group of data) {
    emitGroup(parts, group, [], 2, true);
  }

  const outDir = path.dirname(outFile);
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.promises.writeFile(outFile, parts.join('\n') + '\n', 'utf8');
  console.log(`Wrote settings docs: ${path.relative(repoRoot, outFile)}`);
}

function isSetting(node) {
  return node && typeof node === 'object' && 'settingName' in node;
}

function sanitizeText(s) {
  return String(s ?? '').trim();
}

function mdEscape(s) {
  // Minimal escaping for pipe and backtick in table cells
  return String(s).replace(/\|/g, '\\|').replace(/`/g, '\\`');
}

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-+/g, '-');
}

function makeGroupId(pathTitles) {
  // Deterministic id for groups by full path, no prefix
  return pathTitles.map(slugify).join('-');
}

function emitGroup(parts, node, pathTitles, depth, isTopLevel = false) {
  if (!node || typeof node !== 'object') return;
  const title = sanitizeText(node.title || 'Untitled');
  const desc = sanitizeText(node.description || '');

  const newPath = [...pathTitles, title];
  const groupId = makeGroupId(newPath);

  // heading level for group (depth maps to ##, ###, ...), plus explicit anchor id for stable linking
  const hashes = '#'.repeat(Math.max(2, depth));
  parts.push(`${hashes} ${title}`);
  parts.push(''); // blank line after heading (markdownlint)
  parts.push(`<a id="${groupId}"></a>`);
  parts.push('');
  if (desc) {
    parts.push(desc);
    parts.push('');
  }

  // For top-level groups, include a recursive ToC of its subtree (no heading label to avoid duplicates)
  const children = Array.isArray(node.children) ? node.children : [];
  if (isTopLevel && children.length) {
    const toc = buildGroupToc(node, newPath);
    if (toc.length) {
      parts.push(...toc);
      parts.push('');
    }
  }

  // Emit settings first, then nested groups
  const settingChildren = children.filter(isSetting);
  const groupChildren = children.filter((c) => !isSetting(c));

  for (const setting of settingChildren) {
    emitSetting(parts, setting, newPath, depth + 1);
  }

  for (const child of groupChildren) {
    emitGroup(parts, child, newPath, depth + 1, false);
  }

  // Add back-to-top link after each top-level group
  if (isTopLevel) {
    parts.push('<p><a href="#top">⬆️ Back to top</a></p>');
    parts.push('');
  }
}

function buildGroupToc(groupNode, pathTitles) {
  const lines = [];
  const children = Array.isArray(groupNode.children) ? groupNode.children : [];
  for (const child of children) {
    if (isSetting(child)) {
      const name = sanitizeText(child.settingName || '');
      const title = sanitizeText(child.title || 'Untitled Setting');
      lines.push(`- [${title}](#${name})`);
    } else if (child && typeof child === 'object') {
      const title = sanitizeText(child.title || 'Untitled');
      const id = makeGroupId([...pathTitles, title]);
      lines.push(`- [${title}](#${id})`);
      const sub = buildGroupToc(child, [...pathTitles, title]);
      for (const s of sub) {
        lines.push(`  ${s}`);
      }
    }
  }
  return lines;
}

function emitSetting(parts, node, pathTitles, depth) {
  const title = sanitizeText(node.title || 'Untitled Setting');
  const desc = sanitizeText(node.description || '');
  const name = sanitizeText(node.settingName || '');
  const type = sanitizeText(node.type || '');
  const def = node.default !== undefined ? String(node.default) : '';
  const options = Array.isArray(node.options) ? node.options : [];

  // Force heading id to equal settingName via raw HTML heading
  const hTag = `h${Math.max(3, depth)}`; // settings start at least at <h3>
  parts.push(`<${hTag} id="${escapeHtmlId(name)}">${escapeHtml(title)}</${hTag}>`);
  parts.push(''); // blank line after heading (markdownlint)

  // Breadcrumb path as HTML links using deterministic group anchors
  if (pathTitles.length) {
    const crumbs = [];
    for (let i = 0; i < pathTitles.length; i++) {
      const seg = pathTitles[i];
      const id = makeGroupId(pathTitles.slice(0, i + 1));
      crumbs.push(`<a href="#${id}">${escapeHtml(seg)}</a>`);
    }
    const settingLink = name
      ? `<a href="#${escapeHtmlId(name)}">${escapeHtml(title)}</a>`
      : escapeHtml(title);
    parts.push(`${crumbs.join(' › ')} › ${settingLink}`);
    parts.push('');
  }

  // Description
  if (desc) {
    parts.push(desc);
    parts.push('');
  }

  // Details table
  parts.push('| Property | Value |');
  parts.push('| --- | --- |');
  parts.push(`| Setting Name | \`${mdEscape(name)}\` |`);
  parts.push(`| Type | \`${mdEscape(type)}\` |`);
  parts.push(`| Default | \`${mdEscape(def)}\` |`);

  // Options nested under details table for radio types (HTML table for alignment within the row)
  if (type.toLowerCase() === 'radio' && options.length) {
    const rows = options
      .map((opt) => {
        const oTitle = escapeHtml(opt.title ?? '');
        const oId = escapeHtml(opt.id ?? '');
        return `<tr><td>${oTitle}</td><td><code>${oId}</code></td></tr>`;
      })
      .join('');
    const innerTable = `<table cellspacing="0" cellpadding="0"><thead><tr><th align="left">Name</th><th align="left">ID</th></tr></thead><tbody>${rows}</tbody></table>`;
    parts.push(`| Options | ${innerTable} |`);
  }
  parts.push(''); // blank line after table block
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlId(s) {
  // Allow dots and dashes as-is, strip spaces, remove quotes
  return String(s).replace(/\s+/g, '').replace(/"/g, '').replace(/'/g, '');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

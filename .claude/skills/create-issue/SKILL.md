---
name: create-issue
description: Draft a GitHub issue body for the JellyRock repo from a Reddit/Discord post or free-form bug report and submit it via gh. Reads the YAML form templates under .github/ISSUE_TEMPLATE/ to know which fields are required, fills them by extracting from the input, asks for any missing required fields, validates the body matches the chosen template's schema, then runs gh issue create with the auto-labels the template defines. Use when you have a user report (paste from anywhere) and want to formalize it into a properly-structured GitHub issue.
model: sonnet
user-invocable: true
allowed-tools: Bash(gh issue create:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh search issues:*), Read
---

# /create-issue — draft + submit a GitHub issue

Wraps the YAML-form issue templates as a programmatic API. Pastes from Reddit / Discord / email / free-form descriptions get triaged into the right template (bug / feature / enhancement), filled out, validated, and submitted — without losing any required fields.

## Inputs

`$ARGUMENTS` (optional): the source text. Could be a Reddit post body, a Discord message, an email, or a freeform problem description. If empty, prompt the user for the source content.

## Step 1 — Identify the template

Read [`.github/ISSUE_TEMPLATE/`](../../../.github/ISSUE_TEMPLATE/). Three templates exist:

- `bug_report.yml` — auto-labels `bug` + `needs-triage`. Required: description, repro steps, JellyRock version, Roku device info, server connection type.
- `feature_request.yml` — auto-labels `feature-request` + `needs-triage`. Required: problem, proposed solution.
- `enhancement_request.yml` — auto-labels `enhancement` + `needs-triage`. Required: existing feature name, proposed change.

Classify the input:

- **Bug** keywords: "crash", "freeze", "doesn't work", "broken", "error", "doesn't load", "wrong color", specific repro language, version + device info attached.
- **Feature request**: "I wish JellyRock had X", "would be cool if", net-new functionality.
- **Enhancement**: "the X feature should also do Y", "make X better at Z", refinements to existing behavior.

If the classification is ambiguous, surface the call to the user with the top two candidates rather than guessing.

## Step 2 — Search for duplicates

Before drafting, check for existing issues that might be the same:

```bash
# Title-shaped search first (narrow signal)
gh issue list --state open --search "<2-3 keywords from input> in:title" --limit 5 --json number,title,labels

# Body-search if title turns up empty (broader)
gh issue list --state open --search "<2-3 keywords from input>" --limit 5 --json number,title,labels
```

Surface candidates to the user with a one-line summary each. If any look like a likely duplicate, ask whether to:

- **Comment on the existing issue** instead — `gh issue comment <N>` with the new context.
- **File a new issue and link the related one** in the additional-context field.
- **Proceed with new** — it's not a duplicate.

Don't auto-decide. Duplicate calls are judgment.

## Step 3 — Extract fields from the input

For the chosen template, walk each REQUIRED field and extract a value from the input:

- **Description / problem statement**: usually the bulk of the input. Lift the user's wording verbatim where possible (don't paraphrase a Reddit user's bug report into corporate-speak).
- **Repro steps** (bug only): if the input lists steps, lift them. If not, EXTRACT what you can infer + flag the gap explicitly: "User didn't include explicit repro steps; we should ask them to clarify before triage."
- **JellyRock version, Roku device info, connection type** (bug only): scan the input for these. If missing, the issue is incomplete — see Step 4.
- **Existing feature** (enhancement only): the feature name should be obvious from the input. If not, ask.

For OPTIONAL fields (logs, screenshots, alternatives, mockups, additional context): include if present in the input; skip otherwise.

## Step 4 — Handle missing required fields

If a required field is missing from the input, you have two options:

1. **Ask the user to fill it in.** Best for in-session reports where the user is right there.
2. **File the issue with explicit gaps marked.** Useful for second-hand reports (Reddit posts where the original poster isn't in this session). The body should include a comment in each gap field saying "Original poster didn't specify; needs follow-up." This is honest about the gap and lets the maintainer ask later.

Surface both options to the user; let them decide. Don't fabricate a Roku model or a JellyRock version — that defeats the schema's purpose.

## Step 5 — Render the body

Use the YAML template fields as section headers (one `### <Field label>` per field, matching the template's `attributes.label`). Body shape:

```markdown
### What happened?
<filled or "Original poster didn't specify; needs follow-up.">

### Steps to reproduce
<filled or gap note>

### JellyRock client version
<filled or "Original poster didn't specify; needs follow-up.">

... (continue for each filled field)
```

Skip optional fields that have no content. Don't include empty headers.

If the input came from an external source, add an "Additional context" footer:

> Reported via <Reddit thread / Discord / email>. Original poster: <name or anonymous>.

Link the source if a URL exists.

## Step 6 — Confirm before submitting

Show the user:

- Chosen template
- Title
- Full rendered body
- Auto-labels that will be applied (from the template's `labels:` field)
- Any duplicate-candidates surfaced in Step 2

Ask: "Submit this as a new issue, or revise?" Wait for confirmation. Don't auto-submit even if the body looks complete.

## Step 7 — Submit

```bash
gh issue create \
  --title "<title>" \
  --body "$(cat <<'EOF'
<rendered body>
EOF
)" \
  --label <auto-labels-comma-separated>
```

Pass `--label` explicitly even though the template auto-applies them — `gh issue create` doesn't trigger the YAML-template labels (those only apply when the issue UI is used). Without the explicit `--label`, the issue lands without `bug` / `needs-triage` etc.

After creation, print the issue URL.

## When NOT to use this skill

- The user wants to comment on an existing issue, not file a new one — use `gh issue comment <N>` directly.
- The user is asking a question, not reporting a bug or proposing a feature — direct them to the contact links in `.github/ISSUE_TEMPLATE/config.yml` (app settings docs, server feature matrix).
- The input is too vague to fill any template — surface that and ask for more detail before drafting.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/create-issue/SKILL.md and follow the steps for $ARGUMENTS=<source-text>; surface the rendered body for confirmation but do NOT submit via gh issue create — the user owns the submit decision` in the Task prompt. Sub-agents shouldn't auto-submit issues.

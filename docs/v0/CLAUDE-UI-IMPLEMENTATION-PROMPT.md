# TLAQI Admin — Master UI Implementation Prompt for Claude Code

> **Use this prompt with Claude Code inside the existing repository.** Keep `ttttl.zip` available in the workspace as the visual reference. The repository is the functional source of truth; the ZIP is a visual reference only.

## Mission

Act as a coordinated senior product-design and engineering team and redesign/refine the existing TLAQI Admin application into a polished, coherent, production-ready Arabic-first admin workspace. Work **inside this existing repository**. Do not create a second application, replace the app with a demo, or return only a plan. Inspect the codebase, implement the changes in code, run available checks, fix regressions, and report exactly what was changed and what could not be verified.

The visual direction should combine the strongest ideas in `ttttl.zip` (warm neutral surfaces, focused cards, a dark goal hero, restrained orange accents, rounded controls) with the actual product's design tokens, real data, routes, and governance. Do not copy its fake authentication, role picker, hardcoded dashboard data, invented notifications, or fake feedback flow.

## Required work protocol

1. Read `CLAUDE.md`, `docs/v0/TLAQI-V0-PROMPT.md`, this file, `README.md`, and the relevant route/component files before editing.
2. Use the `full-engineering-team` skill required by `CLAUDE.md`. Assign only the roles necessary: Architect, UI Engineer, Code Reviewer, Test Engineer, Performance Engineer, Security Engineer. Avoid repetitive role output; converge on one implementation plan.
3. Inventory the current layout, design tokens, route guards, role-specific navigation, translations, existing UI components, and data sources. Reuse existing components when sound.
4. Implement in small, coherent stages. After each stage, run focused checks and inspect `git diff`.
5. Finish with typecheck, lint, build when environment permits, and the project's existing browser/E2E checks. Never claim a check passed unless it actually ran and passed.
6. Do not stop after writing a plan. Continue through implementation and verification unless a genuine blocker requires a question.

## Absolute constraints — do not violate

- Preserve the current Next.js App Router application and existing production data flow.
- Keep all routes, route guards, session behavior, Auth.js configuration, server actions, API routes, database schema/migrations, validation, business rules, email flows, and authorization semantics intact.
- Do not remove, weaken, bypass, or move authorization from the server into the client.
- Do not replace live data with mock data, sample users, fabricated counts, pretend charts, fake activity, or fake notifications.
- Do not show success toasts until the relevant server action confirms success. Surface errors honestly and accessibly.
- Do not add new dependencies or icon packages. Use existing icons in `src/components/icons.tsx` and existing project conventions.
- Do not modify package scripts, environment configuration, Vercel configuration, or protected files listed in `docs/v0/TLAQI-V0-PROMPT.md` unless the task explicitly authorizes it. Treat the protected-file list in that document as binding.
- All new user-facing text must be added to the existing Arabic and English dictionaries. Preserve RTL/LTR behavior and locale switching.
- Reuse `src/lib/brand.ts`, existing CSS variables, Cairo fonts, existing component primitives, and `Department.colorHex`. Do not create a competing token system.
- No fake global search, notification center, meeting creation with attendees, CSV export, or unified activity feed unless a real backend contract already exists. If a requested UI has no real contract, omit it or document the missing contract rather than simulating it.
- Do not crop the official logo into a circle, redraw it, replace it with a text glyph, or approximate it. Use `ThemedLockup`/`LogoLockup` when expanded and `LogoMark` when collapsed.
- Never change the role names or role hierarchy. The roles are `super_admin`, `executive`, `operations_officer`, `department_admin`, and `member`.
- Department leaders may open only their own department page. Founder and CEO are intentionally redirected away from `/admin/departments/[slug]`; do not “fix” this behavior.
- Every roster list/count must respect `ROSTER_MEMBER_WHERE` from `src/lib/roster.ts`; CEO must not be counted/displayed as an ordinary member.
- Do not add «تحسين» to navigation. There is one existing floating improvement control.

## Design direction

### Product feel
A calm, premium internal operations workspace: warm, neutral, precise, high trust, information-dense without looking crowded. The design should feel like one product across every route, not a collection of unrelated pages. Prioritize clarity and decision-making over decoration.

### Design tokens
Use existing tokens from `src/app/globals.css` and `src/lib/brand.ts` rather than redefining them.

- Light page: `#F7F5F2`.
- Dark page: `#17191C`; sidebar: `#121416`; surface: `#202327`; raised surface: `#2A2E33`; border: `#343940`.
- Dark foreground: `#F2F3F5`; muted foreground: `#A7ADB5`.
- Brand action is theme-aware through existing `.btn-brand`/tokens; active navigation uses the existing orange `#C34900`.
- Senior Administration: aubergine/purple (`#341D2B`); Marketing: orange (`#C34900`); Technical: green (`#67C090`); HR: beige (`#EEF6DF`). For actual departments, always use `Department.colorHex` from the database. Use `themeFromColor()` / `departmentIdentity()` when appropriate. Do not use the lighter approximate colors from the reference ZIP.
- Status colors (success, warning, danger, information) remain semantically distinct from department colors.
- Use Cairo and the existing typography scale. Keep corners consistent: modest rounded controls, larger radius for primary cards, restrained shadows, thin borders, and strong spacing rhythm.

### App shell
- Desktop: stable sidebar, content area, sticky neutral/translucent header. Keep page content on the page-colored background.
- Expanded sidebar: official logo symbol + wordmark; collapsed sidebar: symbol only. Never crop the logo.
- Sidebar active item is unmistakable but not oversized; use the existing active token and accessible text. Collapsed mode keeps icon labels available through tooltips/title and screen readers.
- Group navigation under these headings, showing a heading only when it contains visible items: `نظرة عامة`; `الأفراد والحسابات`; `الاعتمادات`; `الأقسام والهيكل`; `التنفيذ والتخطيط`; `الاجتماعات والتواصل`; `التقارير والملفات`; `التذاكر`.
- Preserve the mandated relative order of the six shared items when read top-to-bottom: الأعضاء → الاعتمادات → الأقسام → التنفيذ والأهداف → التقويم والاجتماعات → التقارير والملفات. Do not alter any href, guard, role visibility, or active-match logic.
- Put account actions in the account/footer menu rather than crowding the header: profile, security, change password, logout. Only link to real routes. On mobile, one menu button opens the same navigation and account actions. Do not render two menu buttons.
- Header stays minimal: current page/role context, theme toggle, language toggle, and the single mobile menu where needed. Do not add a fake notification bell or global search.
- No persistent global back button. Keep back navigation only on deep detail screens where it genuinely helps.
- Floating «تحسين» remains a single, functional control connected to `src/app/improve/actions.ts`; do not cover the last table row or show it on `/member/test` or `/structure/pdf`.

### Reusable interface primitives
Audit existing primitives first and extend rather than duplicate them. Standardize where needed:
- `PageHeader`: breadcrumb only when useful, title, concise description, primary action slot.
- `Button`: brand, secondary, ghost, danger; touch target at least 44px.
- `Field`, `Select`, `Textarea`: consistent labels, focus, error, hint, RTL/LTR, `aria-describedby`.
- `Card`: consistent surface, border, spacing, heading pattern.
- `DataTable`: clear row hierarchy, stable column alignment, mobile stacked-card layout under 640px, empty/loading/error states.
- `StatusBadge`: semantic variants with text, not color alone.
- `Dialog`/`ConfirmDialog`: keyboard accessible, Escape closes when appropriate, focus trap/return, destructive confirmation consistent with server requirements.
- `EmptyState`, `ErrorState` with retry when possible, `LoadingState`/skeletons that resemble final layout, `Toast` only after confirmed server success.
- Do not add a component library. Use existing patterns and project CSS.

## Screen design briefs

Implement/refine the following in the existing route components. Do not invent backend capabilities. Every page must handle loading, empty, error, and long-content states where relevant.

### 1. Login and authentication flow
Routes: `/login`, `/forgot-password`, `/reset-password/[token]`, `/change-password`, `/invite/[token]`, `/member/welcome`, `/member/pending`, `/member/test`.
- Use a centered, narrow auth column with clear brand lockup, concise title, one-line explanation, well-spaced fields, visible focus, password visibility control, and a restrained warm accent glow.
- Preserve exact existing auth fields, errors, server behavior, verification codes, password requirements, and invite states.
- Do not add a role selector, client-side fake login, or fake forgot-password success. Render real server messages according to current privacy/security behavior.
- Ensure Arabic RTL and English LTR, mobile keyboard friendliness, accessible labels, and no overflow.

### 2. Role dashboards / workspace overview
Routes: `/admin`, `/admin/operations`, `/admin/departments/[slug]`, `/member`.
- Keep the greeting and date compact. Title and supporting copy must match the real session role and department.
- Primary focus card: next approved organizational goal, verified progress, due date, and real route to details. Empty state should clearly explain there is no approved goal and link only where authorized.
- Secondary modules: organizational announcements, upcoming calendar entries, department overview where authorized, and compact calendar. Use actual query results and permission-scoped services.
- Dashboard modules should be skimmable, not a grid of oversized metric cards. Avoid hardcoded KPI numbers and invented “activity”.
- On narrow screens, stack in priority order; no horizontal scrolling for the entire page.

### 3. People, members, invitations, accounts
Routes: `/admin/people`, `/admin/members`, `/admin/accounts`, `/admin/invites`.
- Clear page header and contextual actions. Filters/search only if backed by actual current data logic.
- Tables prioritize name, department/role, state, and next action. On mobile, each record becomes a readable card with actions in a compact menu.
- Invitation UI must reflect the role-specific rules in the existing implementation. Founder invites CEO; CEO may invite Operations Officer; Founder and CEO invite leaders; department leaders invite members of their own department. Never expose unsupported role choices.
- Use the real roster filter `ROSTER_MEMBER_WHERE` and existing member/account distinction. No fake members.
- Destructive actions need clear consequences and server-required typed confirmation; never make delete a casual one-click icon.

### 4. Approvals, tickets, improvements, terminations, signatures
Routes: `/admin/approvals`, `/admin/tickets`, `/admin/improvements`, `/admin/terminations`, `/admin/signature`, `/t/[number]`.
- Treat these as work queues: status, requester/target, age/date where provided, owner/assignee where real, and the next valid action.
- Distinguish pending, in progress, returned, escalated, resolved, and rejected only when those states exist in the domain model.
- Detail pages should make context and decision consequences clear; place primary decision action where the eye naturally lands, with secondary actions visually quieter.
- Preserve assignment checks, self-approval restrictions, escalation behavior, typed confirmations, signing-role rules, and current state transitions.
- Improvement categories must retain the current semantics: bug = «الإبلاغ عن إشكالية», confusing, idea = «اقتراح تحسين». Keep the one floating improvement entry point and current server action.
- Do not claim tickets/requests are resolved until the server confirms.

### 5. Departments and organization
Routes: `/admin/departments`, `/admin/departments/[slug]`, `/structure`, `/structure/pdf`.
- Department cards use the actual DB `colorHex` as a thin identity accent, not as full saturated backgrounds. HR beige must have a visible hairline outline on light backgrounds.
- Department overview should emphasize identity, actual member count, and real department details. Respect department scope and existing redirect behavior exactly.
- Organization chart should prioritize legibility, names/roles, clear hierarchy lines, and responsive overflow handling. Keep the PDF view printable, neutral, and free of floating controls.

### 6. Execution, goals, weekly planning and review
Routes: `/admin/execution`, `/admin/execution/goals`, `/admin/execution/review`.
- Preserve the actual domain chain: goals → milestones → department objectives → weekly execution period → week plans → tasks → submissions → reviews.
- Goals are year-based; milestones are month-based. There are no separate annual/monthly plan entities; do not invent them.
- Saturday is the weekly review cadence. Preserve current carry-over rules: carry-over highlighted at 2; executive decision at 3. Keep all period-governance rules and permission checks.
- Separate “planned”, “submitted”, “verified”, and “returned” states. Progress percentages must use real verified work and existing calculation helpers, never visual estimates.
- Provide an understandable timeline/step structure and compact progress indicators. Avoid decorative charts with fabricated values.
- Task cards show owner, due date, status, submission/review controls only when returned by the real permission logic.

### 7. Calendar and plans
Routes: `/calendar`, `/plans`.
- Calendar should be readable by month/week/list as currently supported, with a clear selected date and accessible event rows.
- Do not invent meeting creation with attendees if no backend contract exists. Keep existing event types and permissions.
- Plans/document centre should have a clear hierarchy, category, date/owner metadata only when available, and straightforward open/download actions only where implemented.

### 8. Reports, operations, messages, live sheet, profile, security
Routes: `/admin/reports`, `/admin/operations`, `/admin/messages`, `/admin/sheet`, `/admin/profile`, `/admin/security`.
- Use calm dense layouts suited to internal operations. Prefer clear filters and tables over decorative charting.
- Only show metrics/data that the existing backend returns. No fake CSV export, activity feed, or global search.
- Preserve role restrictions for message logs and live sheet tools; security-sensitive login-health data must remain founder-only as implemented.
- Profile/security forms need clear save state, field-level errors, and real server confirmations.

## Interaction and accessibility standards

- Every visible button/link must do its advertised action. Remove inert controls or connect them to real functionality.
- Keyboard navigation, visible focus, semantic headings, labels, contrast, and accessible names are required.
- Do not communicate state using color alone.
- Use `aria-live`/`role="alert"` for appropriate dynamic feedback. Keep focus stable when dialogs open/close.
- Respect reduced motion; animations should be short, subtle, and never necessary to understand state.
- Avoid layout shift. Use loading skeletons that match the shape of the actual content.
- Test Arabic RTL, English LTR, light mode, dark mode, desktop, tablet, and mobile widths.

## Suggested implementation sequence

1. Inspect existing styles and components; establish a route/role audit before changes.
2. Refine app shell: tokens, header, sidebar groups, collapsed state, mobile menu, account footer.
3. Standardize primitives and interaction states.
4. Refine login/auth flows.
5. Refine role dashboards.
6. Refine people/accounts/invites/departments.
7. Refine approvals/tickets/improvements/terminations/signatures.
8. Refine execution/goals/review/calendar/plans.
9. Refine reports/operations/messages/structure/sheet/profile/security.
10. Run checks, fix regressions, inspect diffs, and produce a concise implementation report.

Do not batch-edit every page blindly. Work in small stages and inspect the result in the browser when available.

## Verification checklist

Run what is possible in this environment and record exact results:

- `npx tsc --noEmit`
- `npx eslint src`
- `npm run build` (requires a valid local database environment; do not point it at production or run destructive production migrations)
- Existing E2E scripts: `for f in scripts/e2e-*.ts; do npx tsx "$f"; done`
- Existing browser checks, if present: `node scripts/check-sidebar.mjs`, `node scripts/check-dashboard.mjs`, `node scripts/check-improve-drawer.mjs`, `node scripts/check-contrast.mjs`
- Test role-specific navigation and redirects for all five roles.
- Confirm sidebar hrefs and active matching are unchanged; no visible link redirects unexpectedly.
- Confirm CEO is not included as a normal roster member.
- Confirm department leaders cannot access other departments and Founder/CEO keep their current redirect behavior.
- Confirm no fake data, fake success, unsupported feature, or new dependency was introduced.
- Confirm `/member/test` and `/structure/pdf` do not display the floating improvement control.
- Inspect `git diff --check`, `git status --short`, and the final diff.

If a check cannot run because credentials, database, browser, or a required skill is unavailable, state that exact limitation and do not imply it passed. Do not modify production data to make checks pass.

## Final response expected from Claude

Return:
1. Summary of the UI implemented.
2. Files changed, grouped by shared shell, design primitives, and routes.
3. Real functionality preserved and any backend contracts deliberately not fabricated.
4. Commands run with pass/fail/blocker results.
5. Remaining visual/functional gaps, if any.
6. A concise list of screenshots or routes manually inspected.

Begin by inspecting the current repository and reference ZIP, then implement. Do not answer with only a proposal.

# TLAQI (تَـــلاقِ) — V0 Frontend Implementation Directive

> Self-contained. Everything V0 needs is in this document. Facts marked **[VERIFIED]** were read from the repository at commit `5d70c8b` on branch `claude/relaxed-rubin-tdysmx`. Items marked **[PROPOSED]** are design recommendations. Items marked **[OPEN]** need a decision from the project owner before they are built.

---

## 0. READ THIS FIRST — HOW YOU MUST WORK

TLAQI is **not** a blank project. It is a live, production Next.js application (`www.tlaqiteam.site`) with a real PostgreSQL database, authentication, two-factor login, ~120 server actions, email delivery, and Google Sheets synchronisation. You previously contributed to it (PR #1 `v0/polish-tlaqi-ui`, merged).

**Your job is to replace the presentation layer of the existing repository — not to build a second application.**

1. **Work inside the existing repository** `nawafalahdal/Tlaqi-Admin-CO`, on a new branch from `claude/relaxed-rubin-tdysmx`. Do not create a new project, do not scaffold a new Next.js app, do not copy `ttttl.zip` in as a separate app.
2. **Do not modify** anything under `src/lib/**`, `src/auth.ts`, `prisma/**`, `src/app/**/actions.ts`, `src/app/api/**`, `scripts/**`, or `package.json` scripts. These are the backend. Pages call them; you change how pages look and what they render.
3. **Every page must keep its server-side guard** (the `auth()` + `redirect(...)` block at the top of each `page.tsx`). You may restructure the JSX below it; you may not remove, weaken or reorder the guard.
4. **Every form must keep calling the same server action** with the same field names. If you rename an input `name`, the action breaks.
5. **No mock data in any route.** No sample names, numbers, dates, goals, meetings, or percentages in production code. If a page has no data, render its empty state. Fixtures are allowed only in `src/dev/**` for isolated component previews, and nothing in `src/app/**` may import from `src/dev/**`.
6. **No fake success.** Never show "saved" / "sent" / "تم" unless the server action returned success. Never simulate login.
7. **The build must stay green.** `npm run build` runs four guards before `next build` (email coverage, banner render, department scope, member roster) and applies database migrations. If you break a guard, fix your code, not the guard.
8. **Verify before you claim.** For each route you touch, report what you changed and how you verified it (see §12).

If something you need does not exist in the backend, **do not invent an endpoint**. Build the UI with a clearly typed prop/contract and list it under "Backend contracts required" in your report (§11.3).

---

## 1. PRODUCT IN ONE PARAGRAPH

TLAQI is an internal Arabic-first (RTL, with English LTR) platform for a volunteer organisation. It manages the full membership lifecycle (invitation → candidate account → profile → test → approval → welcome → membership → warnings → step-down/termination → certificate), an organisational hierarchy with strict governance, a ticket system with a 2-day escalation chain, administrative approvals, a strategic execution system (goals → milestones → department objectives → weekly plans → tasks → Saturday review with carry-over), a calendar, announcements, an organisation chart, a plans/documents centre, leader signatures for certificates, and an improvement-feedback centre.

---

## 2. SOURCES YOU MUST INSPECT

| Source | What it is | How to use it |
|---|---|---|
| `ttttl.zip` | One client-side file (`app/page.tsx`) + `globals.css` + `components/ui/button.tsx` + logo PNG. Contains a **login screen** and a **Founder dashboard** with pill sidebar, header, goal hero, announcements, meetings, department snapshot, mini calendar, floating feedback button and dialog. **All data is hard-coded**, login only flips `useState`, role switching is a hidden `<select>`, the feedback form only shows a toast. | **Visual reference only.** Reuse layout, proportions, radii, spacing, hierarchy. Do not reuse its data, its fake login, its role `<select>`, or its circular-cropped logo. |
| Screenshots supplied by the owner | Login, Founder dashboard, sidebar, improvement dialog | Visual reference, same rules as the ZIP. |
| The repository | The real application | **Functional source of truth.** |
| `docs/v0/TLAQI-V0-PROMPT.md` | This document | Your brief. |

**Already implemented from the ZIP in the repository — extend, do not rebuild:**
- Pill sidebar: `src/components/sidebar/SidebarRail.tsx` (client) + `AppSidebar.tsx` (server, computes items) + `src/lib/navigation.ts` (typed role→items model). Mounted by `layout.tsx` in `src/app/{admin,calendar,plans,structure,member}`.
- Workspace overview (goal hero, announcements, meetings, department snapshot, mini calendar) from real data: `src/components/dashboard/WorkspaceOverview.tsx`.
- Neutral header with department colour line: `AppHeader` in `src/components/ui.tsx` + `HeaderShell.tsx`.
- Floating improvement button + drawer, wired to the real ticket system: `src/components/ImproveButton.tsx` → `src/app/improve/actions.ts`.
- Login in ZIP style on the real two-step flow: `src/app/login/page.tsx` + `LoginForm.tsx`.
- Graphite dark tokens and all component CSS: `src/app/globals.css`.

---

## 3. TECHNICAL STACK [VERIFIED]

- Next.js **16.3.8** App Router, Turbopack, React **19.2**, TypeScript strict, Tailwind CSS **v4** (`@theme` in `globals.css`), Prisma **6.19.3**, PostgreSQL (Neon in production), Auth.js v5 (credentials + TOTP / emailed login code), Resend (email), googleapis (Sheets), sharp (avatars).
- **No component library and no icon library.** Icons are hand-drawn inline SVG in `src/components/icons.tsx` (`NavGlyph name="…"`, `SunIcon`, `MoonIcon`, `SparkIcon`, `GlobeIcon`). Do **not** add `lucide-react`, shadcn, Radix or Base UI. The ZIP's dependencies are not to be installed. If you need a new icon, add a path to `NAV_PATHS` in `icons.tsx` in the same 24×24, 1.8 stroke style.
- Font: Cairo via `next/font` (`--font-cairo`).
- i18n: `src/i18n/dictionaries/{ar,en}.ts`; server `getDictionary(await getLocale())`, client `useTranslations()`. **Every new user-visible string goes into both dictionaries.** Arabic is the default.
- Theme: `<html data-theme="light|dark">` set before paint by `ThemeScript`; sidebar state `data-sidebar="expanded|collapsed"` set the same way. Never read theme in React state for first render.

### 3.1 Two traps you must know

1. **`text-white` / `bg-white` / `text-black/50` follow the theme.** `globals.css` maps `--color-white: var(--surface)` and `--color-black: var(--ink)`. So `bg-white` is "card surface" (white in light, `#202327` in dark) and `text-black/50` is "muted ink". This is intentional and makes most pages theme-aware for free. **On a surface that is dark in both themes** (e.g. the goal hero), you must use literal colours (`#fff`, `rgb(255 255 255 / .7)`) via a CSS class. `text-white` there will turn grey in dark mode and disappear.
2. **Client components must not import server-only modules.** Anything imported by a `"use client"` file must not pull in `@/lib/prisma`, `googleapis`, `@/lib/signatures`, etc. Compute on the server and pass plain props (see how `canSign` is passed into `navFor`).

---

## 4. ROLES AND GOVERNANCE [VERIFIED]

Role identifiers (do not rename, do not add):

| Identifier | Arabic | Stored in | Notes |
|---|---|---|---|
| `super_admin` | المؤسس | `User` | Highest authority. Protected account. |
| `executive` | الرئيس التنفيذي | `User` | Singleton seat. |
| `operations_officer` | مسؤول المتابعة والتشغيل | `User` | Singleton seat. Invited by the CEO only. |
| `department_admin` | قائد قسم | `User` (`departmentId`) | One per department. |
| `member` | عضو | `Member` table (separate) | Session role `"member"`. |

**Account identity rule [VERIFIED, recently fixed]:** leadership candidates also pass through a `Member` row (test, approval). After approval they get a `User` row and their `Member` row stays `approved`. **A "member" is only a `Member` whose `invite.targetRole === "member"`.** Every list or count of members must use `ROSTER_MEMBER_WHERE` from `src/lib/roster.ts` (a build guard enforces it). Never display a leader as an ordinary member.

### 4.1 Permission matrix — what the server enforces today

Legend: ✅ allowed · ❌ denied · ◑ scoped (own department / own record / assigned) · — not applicable.

| Capability | Founder | CEO | Ops | Dept Leader | Member | Enforced in |
|---|---|---|---|---|---|---|
| Invite **CEO** | ✅ | ❌ | ❌ | ❌ | ❌ | `createExecutiveInviteAction` |
| Invite **Operations Officer** | ❌ | ✅ | ❌ | ❌ | ❌ | `createOperationsOfficerInviteAction` (deliberate: Ops is the CEO's arm) |
| Invite **Department Leader** | ✅ | ✅ | ❌ | ❌ | ❌ | `createDeptAdminInviteAction` |
| Invite **Member** | ✅ | ✅ | ❌ | ◑ own dept | ❌ | `departments/[slug]/actions#createMemberInviteAction` |
| Approve/reject/reopen **executive** candidate | ✅ | ❌ | ❌ | ❌ | ❌ | `canDecideCandidate` (`src/lib/permissions.ts`) |
| Approve/reject/reopen **Ops / Leader** candidate | ✅ | ✅ | ❌ | ❌ | ❌ | `canDecideCandidate` |
| Approve/reject/reopen **member** candidate | ✅ | ✅ | ❌ | ◑ own dept | ❌ | `canDecideCandidate` |
| Edit question bank: executive | ✅ | ❌ | ❌ | ❌ | ❌ | `/admin/tests/executive` guard |
| Edit question bank: leaders / ops | ❌ (by design) | ✅ | ❌ | ❌ | ❌ | `/admin/tests/{leads,operations}` guards |
| Edit question bank: department members | ❌ | ❌ | ❌ | ◑ own dept | ❌ | `canEditTrack` |
| Reset credentials of leadership accounts | ✅ | ❌ | ❌ | ❌ | ❌ | `resetUserCredentialsAction` |
| Remove (step down) a leadership account | ✅ | ❌ | ❌ | ❌ | ❌ | `removeLeadershipUserAction` |
| **Permanently delete** user / member | ✅ (typed email confirmation + reason) | ❌ | ❌ | ❌ | ❌ | `founderActions.assertFounder` |
| Purge stuck candidate | ✅ | ❌ | ❌ | ❌ | ❌ | `purgeCandidateAction` |
| Reopen candidate test | ✅ | ✅ | ❌ | ◑ own dept | ❌ | `reopenCandidateTestAction` |
| Send awards / appreciation | ✅ | ✅ | ❌ | ❌ | ❌ | `canAward` |
| Create department | ✅ | ✅ | ❌ | ❌ | ❌ | `canCreateDepartment` |
| Delete department | ✅ | ❌ | ❌ | ❌ | ❌ | `canDeleteDepartment` |
| Propose committee in a department | ✅ | ✅ | ❌ | ◑ own dept | ❌ | `canRequestCommitteeIn` |
| Decide committee | ✅ | ✅ | ❌ | ❌ | ❌ | `canDecideCommittee` |
| Open a department's own page `/admin/departments/[slug]` | ❌ (redirected) | ❌ (redirected) | ❌ | ◑ **own dept only** | ❌ | page guard (deliberate ownership rule) |
| Issue warning / step-down / offboarding to a member | — | — | ❌ | ◑ own dept | ❌ | department actions |
| Publish announcement | ✅ | ✅ | ✅ | ◑ own dept audience | ❌ | `canPublishAnnouncement` + `announcementPowers` |
| Manage plans/documents centre | ✅ | ✅ | ❌ | ❌ | ❌ | `canManagePlans` |
| Read plans centre | ✅ | ✅ | ✅ | ✅ | ✅ | `/plans` |
| Strategic goals: propose | ✅ | ✅ | ❌ | ✅ | ❌ | `createGoal` (`canApproveGoal` or `department_admin`) |
| Strategic goals: approve | ✅ | ✅ | ❌ | ❌ | ❌ | `canApproveGoal` |
| Govern weekly period (open/close/review/reopen) | ✅ | ✅ | ❌ | ❌ | ❌ | `canGovernPeriod` |
| Plan a department's week | ✅ | ✅ | ❌ | ◑ own dept | ❌ | `canPlanDepartment` |
| Verify / return submitted work | ✅ | ✅ | ❌ | ❌ | ❌ | `canReviewWork` |
| Update a task | ✅ | ✅ | ❌ | ◑ own dept | ◑ own task | `canUpdateTask` |
| Raise ticket | ✅ | ✅ | ✅ | ✅ | ✅ | `raiseAdminTicketAction` / `member/actions#raiseTicketAction` |
| Respond to / resolve ticket | ◑ escalated to them | ◑ escalated | ❌ (read + remind) | ◑ own dept target | ❌ | `canRespondToTicket` |
| Remind on tickets/requests | — | — | ✅ | — | — | `operations/actions` |
| Decide an administrative approval | ◑ only if assigned approver, never own request | ◑ same | ◑ same | ◑ same | ❌ | `canDecideApproval` |
| Improvement: submit | ✅ | ✅ | ✅ | ✅ | ✅ | `submitImprovementAction` |
| Improvement: triage / advance | ✅ | ✅ | ❌ | ❌ | ❌ | `canTriage` |
| Improvement: confirm own fix | ◑ own | ◑ own | ◑ own | ◑ own | ◑ own | `confirmImprovementAction` |
| Signatures: submit own | ✅ | ✅ | ❌ | ✅ | ❌ | `isSigningRole` = `super_admin`, `executive`, `department_admin` |
| Signatures: approve | ✅ | ✅ | ❌ | ❌ | ❌ | `/admin/signature` |
| Terminations: submit | — | — | — | — | ✅ | `submitTerminationAction` |
| Terminations: decide | ✅ | ✅ | ❌ | ◑ own dept | ❌ | `/admin/terminations` guard |
| Email log `/admin/messages` | ✅ | ✅ | ❌ | ❌ | ❌ | page guard |
| Google Sheet tools `/admin/sheet` | ✅ | ❌ | ❌ | ❌ | ❌ | page guard |
| Login-health details (failed attempts, lockouts) | ✅ | ❌ | ❌ | ❌ | ❌ | `/admin/people` (not even fetched for others) |
| 2FA setup | ✅ | ✅ | ✅ | ✅ | — (members log in by emailed code) | `/admin/security` |

**[OPEN] questions for the owner. Do not decide these yourself; build to the current rule:**
- O1. Should the Founder be able to approve an Operations Officer candidate? (Today: yes. Founder and CEO may decide.)
- O2. Should the Founder/CEO be able to *view* a department's own page read-only? (Today: no. Redirected, by an explicit ownership rule.)
- O3. Should the Ops Officer get a members list? (Today: no members page for Ops.)

---

## 5. NAVIGATION ARCHITECTURE

### 5.1 Current model [VERIFIED] — `src/lib/navigation.ts`

Items are computed **on the server** from the session and mirror each page's guard exactly. A browser test (`scripts/check-sidebar.mjs`) logs in as all five roles and asserts that **every item opens for its role without a redirect**. Keep that property.

Mandated order of the shared items (owner requirement), filtered per role:
1. الأعضاء → `/admin/people` (Founder, CEO) · for a Leader: «أعضاء قسمي» → `/admin/departments/{slug}`
2. الاعتمادات → `/admin/approvals` (all admins)
3. الأقسام → `/admin/departments` (Founder, CEO, Ops)
4. التنفيذ والأهداف → `/admin/execution` (all admins)
5. التقويم والاجتماعات → `/calendar` (everyone)
6. التقارير والملفات → `/admin/reports` (all admins)

Then: نظرة عامة (role home, currently placed **first** so the active home item is visible) · الخطط والوثائق `/plans` · التذاكر `/admin/tickets` · الهيكل التنظيمي `/structure` · الدعوات `/admin/invites` (Founder, CEO) · سجل الرسائل `/admin/messages` (Founder, CEO) · طلبات الإنهاء `/admin/terminations` (Founder, CEO, Leader) · التوقيعات `/admin/signature` · السجل الحي `/admin/sheet` (Founder).

Role homes (`homeFor`): Founder/CEO `/admin`, Ops `/admin/operations`, Leader `/admin/departments/{slug}`, Member `/member`.

### 5.2 Your task — grouped navigation [PROPOSED by the owner, implement]

The Founder sees ~15 flat items. Group them **without changing any href, guard or the order of the six shared items**. Implement groups as collapsible sections in `navigation.ts` (add `group` to `NavItem`) and render group headings in `SidebarRail.tsx`:

| Group | Items (in order) |
|---|---|
| نظرة عامة | role home |
| الأفراد والحسابات | الأعضاء · الدعوات · طلبات الإنهاء · التوقيعات |
| الاعتمادات | الاعتمادات |
| الأقسام والهيكل | الأقسام · الهيكل التنظيمي |
| التنفيذ والتخطيط | التنفيذ والأهداف |
| الاجتماعات والتواصل | التقويم والاجتماعات · سجل الرسائل |
| التقارير والملفات | التقارير والملفات · الخطط والوثائق · السجل الحي |
| التذاكر | التذاكر |

Rules:
- The six shared items must still appear in their mandated relative order when the list is read top-to-bottom. The table above preserves it; re-check after your change.
- A group with no visible items for the role is not rendered.
- Collapsed sidebar: groups disappear, icons remain, each with `title` tooltip = label.
- **Do not** add «تحسين» to the sidebar. It has one floating button.
- **Do not** add a Settings item that duplicates header links unless it points to a real page. Personal settings live at `/admin/profile`, `/admin/security`, `/change-password`. [PROPOSED] Move these three, plus logout, from the header into a sidebar footer «حسابي» menu, keeping the header minimal (theme, language). Keep the mobile header menu showing the same items.
- Brand: expanded sidebar shows **symbol + wordmark** (`ThemedLockup` / `LogoLockup` from `src/components/Logo.tsx`); collapsed shows **symbol only** (`LogoMark`). Never crop the lockup into a circle (the ZIP does this; it distorts the logo).

### 5.3 Header

- Neutral, page-coloured, translucent, sticky (`.app-header`). Department identity = 3px bottom line in the department colour (already implemented).
- Contents: page/role label · theme switch + language toggle (`ControlGroup` with `ThemeToggle` and `LocaleToggle`). Keep these components; they are accessible (`role="switch"`, target-language label).
- On phones (<640px) there is no sidebar. The header menu button opens one panel with the nav items (`MobileNavList`) then account actions. **One** menu button, never two.
- No persistent back button where the sidebar provides navigation. [PROPOSED] Keep `BackButton` only on deep detail pages (`/admin/departments/[slug]/test`, `/admin/execution/review`, `/admin/tests/*`).

---

## 6. DESIGN SYSTEM

### 6.1 Tokens [VERIFIED in `globals.css`] — reuse, do not redefine

| Token | Light | Dark (graphite, owner-mandated) |
|---|---|---|
| `--page` | `#F7F5F2` | `#17191C` |
| `--sidebar-bg` | `#fbfaf8` | `#121416` |
| `--surface` | `#ffffff` | `#202327` |
| `--surface-raised` | — | `#2A2E33` |
| `--hairline` | ink 14% | `#343940` |
| `--ink` | dark ink | `#F2F3F5` |
| `--ink-muted` | `#625963` | `#A7ADB5` |
| `--brand-action` (primary button `.btn-brand`) | `#341D2B` | `#C34900` |
| `--nav-active` (selected nav, avatar) | `#C34900` | `#C34900` |
| `--focus` | `#a33b37` | `#f08a52` |

Brand palette (`BRAND` in `src/lib/brand.ts`): beige `#EEF6DF`, mahogany `#C34900`, temptress `#341D2B`, green sheen `#67C090`, ink `#1A1023`.

### 6.2 Department identity colours

Mandatory mapping: **Senior Administration = purple, Marketing = orange, Technical = green, HR = beige.**
- The colour of each department is **stored in the database** (`Department.colorHex`, editable by the Founder/CEO via `DepartmentColor.tsx`). Seeded values: Marketing `#C34900`, HR `#EEF6DF`, Technical `#67C090`, Senior Administration `#341D2B` (brand aubergine-purple). The ZIP shows lighter shades (`#9b7db2`, `#d86b2f`, `#69b88a`, `#b9a77d`); **do not hard-code ZIP shades**. Always render `department.colorHex`.
- Registry for code-level lookups: `DEPARTMENT_THEME` / `departmentIdentity()` in `src/lib/brand.ts` (DB slugs: `marketing`, `hr`, `tech`; `tech` is aliased to `technical`).
- `themeFromColor(hex)` builds surfaces/borders/ink from a department colour, using `light-dark()` so it adapts to the theme. Use it for department-tinted cards.
- Very light identity colours (HR beige) need a hairline outline on light surfaces. Use the `.ws-swatch` class.
- Department colours never replace status colours (success/warning/danger/info are separate tokens).

### 6.3 Components to standardise (create in `src/components/ui/` or extend `src/components/ui.tsx`)

`PageHeader` (title, description, primary action slot) · `Button` (variants: brand, secondary, ghost, danger; sizes ≥44px tall) · `Field` (label + input + hint + error, `aria-describedby`) · `Select` · `Textarea` · `Card` (exists) · `DataTable` (exists: `src/components/DataTable.tsx`; on <640px reflow to stacked cards) · `StatusBadge` (exists) · `Dialog` (focus trap, Escape closes, focus returns to opener; copy the behaviour of `ImproveButton`) · `ConfirmDialog` (for destructive actions; typed confirmation where the server requires it, e.g. permanent deletion requires the account email) · `EmptyState` · `ErrorState` (with retry) · `LoadingState` (route-level `loading.tsx` skeletons) · `Toast` (only after confirmed server success) · `SeatOccupied` (exists).

Every async action follows: validate (client hint) → pending state (disable button, show spinner/label) → server action → on error show the server's message verbatim (actions return Arabic, human-readable `error` strings) → on success show confirmation and `router.refresh()` / rely on the action's `revalidatePath`.

### 6.4 Accessibility and responsive (acceptance-tested)

- Contrast WCAG AA in both themes (`scripts/check-contrast.mjs`).
- Touch targets ≥44px. Visible focus rings (`--focus`).
- No horizontal scroll at 320, 360, 375, 390, 414px (tested).
- RTL default; English LTR via `LocaleToggle`. Use logical properties (`ms-`, `me-`, `ps-`, `start-`, `end-`, `inset-inline-*`). Inputs for email/password/codes are `dir="ltr"`, and **their wrapper too** when an icon button sits inside the input (a fixed bug: the eye icon overlapped the text).
- `prefers-reduced-motion` respected.
- The floating «تحسين» button must never cover a page's last row (`body:has(.improve-fab) main { padding-block-end: 6rem }` exists).

---

## 7. ROUTE INVENTORY AND PAGE SPECIFICATIONS [VERIFIED guards]

Format per route: **Who** (guard) · **Purpose** · **Data** · **Actions** (server action) · **States** · **Your work**.

### 7.1 Public and authentication

| Route | Who | Purpose / actions | Your work |
|---|---|---|---|
| `/` | signed-in | Redirect: member → `/member`, others → `/admin` | none |
| `/login` | public | Two steps: email+password → `requestLoginCodeAction` (sends emailed code; or offers TOTP when enabled) → `loginAction` with `loginCode` or `totp`, "remember me". Lockout after failed attempts. | Already in ZIP style. Polish the **second step** (code/TOTP) to the same card style; keep method switch, `autoComplete="one-time-code"`, numeric pattern, hidden email/password fields. |
| `/forgot-password` | public | `requestResetAction` (always shows neutral confirmation, no account enumeration) | Restyle to login card |
| `/reset-password/[token]` | public | `resetPasswordAction` with password policy (`src/lib/passwordPolicy.ts`) | Restyle; show policy checklist live; invalid/expired token state |
| `/change-password` | any session | `changePasswordAction`; forced when `mustChangePassword` | Restyle; forced-change banner |
| `/invite/[token]` | public | Legacy invite link landing (accounts are now created at invite time) | Restyle; expired/used states |
| `/certificate/[token]` | public by token | Renders a certificate (signed by the real leader's approved signature) | Do not change certificate layout without owner approval; only page chrome |

### 7.2 Candidate and member

| Route | Who | Purpose | Your work |
|---|---|---|---|
| `/member/welcome` | member candidate, not approved | Profile completion before test: `saveCandidateProfileAction` (phone, specialization, section; job title is set by the inviter, not editable) | Stepper UI (1 profile → 2 test → 3 approval). **No sidebar here** (already excluded). |
| `/member/test` | candidate, test not started | `submitCandidateTestAction`; pass threshold **80%**; one attempt (atomic). Candidate window **24h** after account creation. | Focused test UI, progress indicator, confirmation before submit, theme/language toggle available. No sidebar. |
| `/member/pending` | candidate after test | Waiting for approval / failed with explanation meeting | Status page with timeline |
| `/member` | approved active member | Workspace: overview (goal, announcements, meetings, calendar), alerts, my tasks (`MyTasks`), department card, avatar upload, org chart link, plans link, welcome-mail card, raise ticket (`raiseTicketAction`), warnings acknowledgement (`acknowledgeWarningAction`), termination request, governance charter | Rebuild in the new design: overview → "ما ينتظرك" alerts → my tasks → my tickets → resources. Keep every existing section. |

### 7.3 Founder and CEO home `/admin`

Who: Founder, CEO (Leader → own dept page; Ops → `/admin/operations`; member → `/member`).

Existing content (keep all): `WorkspaceOverview` (goal hero with **verified** progress, announcements, meetings, department snapshot, mini calendar) → `AlertsPanel` (what needs action) → `TicketBoard` → stat tiles (escalated, pending approvals, open requests, departments) → announcements (composer for authorised roles) → `SeatConflicts` (Founder) → leadership candidate approval queue (filtered by `canDecideCandidate`) → member candidate queue → records links → admin links.

Your work:
- Make Founder and CEO homes **distinct** using the same data:
  - **Founder:** organisation health first (seats filled/vacant from `/structure` data, pending leadership decisions, account/lifecycle alerts, login-health warnings count), then the overview.
  - **CEO:** execution first (current period state from `src/lib/execution.ts`, tasks awaiting verification `awaitingVerification(periodId)`, carry-overs ≥2/≥3 per `CARRYOVER_ESCALATION`, goals pending approval `pendingProposals()`), then the overview.
  - [OPEN] O4: confirm these priorities with the owner. Build them behind the same data, no new metrics.
- Replace the long "LinkGrid" of admin links with the grouped sidebar; keep the cards that carry **counts** (e.g. «الاعتمادات الإدارية (3 بانتظارك)») as dashboard tiles.
- The approval queue rows must show only actions the viewer may perform.

### 7.4 Operations `/admin/operations`

Who: Ops only. Read-across-departments plus reminders (`remindTicketAction`, `remindRequestAction`). Cannot resolve tickets. Overview with department snapshot + alerts + plans link + announcements + operational tables (overdue tickets, overdue requests by department).

Your work: tables with filters (department, status, overdue), "remind" buttons with pending/sent states, last-reminded timestamp. **No** Founder/CEO controls.

### 7.5 Department leader `/admin/departments/[slug]`

Who: **the department's own leader only** (Founder/CEO are redirected to `/admin/departments`).

Content (keep all): overview (no cross-department snapshot) · alerts · announcements (leader can post to own department) · candidate queue (passed / failed / not started) · invite member form (`createMemberInviteAction`) · members roster with warnings (`issueWarningAction`), credential reset (`resetMemberCredentialsAction`), step-down and offboarding steps (`stepDownMemberAction`, `markOffboardingStepAction`, `closeOffboardingAction`), certificate (`issueCertificateAction`), exit (`markMemberExitedAction`) · tickets to the department (`respondToTicketAction`, `withdrawTicketAction`) · committees (`requestCommitteeAction`, `withdrawCommitteeAction`, `inviteCommitteeLeadAction`) · department test bank link.

Your work: tabbed layout (نظرة عامة · الأعضاء · المرشّحون · التذاكر · اللجان · الاختبار) using URL hash or `?tab=`; department colour as header line and accents; every destructive action behind `ConfirmDialog`.

### 7.6 Departments directory `/admin/departments`

Who: Founder, CEO, Ops (Leader redirected to own). Create (`createDepartmentAction`), recolour (`updateDepartmentColorAction`), delete (Founder; `deleteDepartmentAction`), assign members (`assignMemberDepartmentAction`), decide committees (`decideCommitteeAction`). Counts use `ROSTER_MEMBER_WHERE`.

Your work: card grid with colour, leader, member count, committees; create dialog; colour picker; delete with confirmation; committee decision queue.

### 7.7 People `/admin/people` (also `/admin/accounts`, `/admin/members` → redirect here)

Who: Founder, CEO. Leadership accounts (CEO sees Ops + Leaders; Founder also sees CEO), roster members (`isRosterMember`), stuck candidates, lapsed candidates, removed leaders, login health (Founder only), welcome-email receipts, awards.

Actions: `resetUserCredentialsAction` (Founder), `removeLeadershipUserAction` (Founder), `reopenCandidateTestAction`, `purgeCandidateAction` (Founder), `permanentlyDeleteUserAction` / `permanentlyDeleteMemberAction` (Founder; requires typed email + reason; reports Sheet/email-release outcome honestly), `sendWelcomeToUserAction`, `sendWelcomeToMemberAction`, `sendAwardAction`, `correctOrgJoinDateAction`.

Your work: tabs (القيادة · الأعضاء · المرشّحون · المُنحّون), search by name/email, filter by department/status, row action menu showing only permitted actions, details drawer. Welcome email states must be shown as the server reports them: **"وصلت (قبلها المزوّد) في …"**, **"لم تصل"**, or the specific failure reason. Never show "delivered" as confirmed delivery; it means "accepted by provider".

### 7.8 Invites `/admin/invites`

Who: Founder, CEO. Forms: CEO invite (Founder), Ops invite (CEO), Leader invite (both; department picker excludes occupied seats). Seat occupied → `SeatOccupied` card instead of the form. Issued invites list with email-delivery status (`emailSentAt`, `emailAttempts`). Created credentials are shown **once** on screen with a copy button.

Known error messages to surface verbatim: question bank empty ("بنكُ أسئلة … فارغ — أضف أسئلته من صفحة الاختبار قبل الدعوة…"), seat occupied by name, email already used.

### 7.9 Question banks

`/admin/tests/executive` (Founder) · `/admin/tests/leads` (CEO) · `/admin/tests/operations` (CEO) · `/admin/departments/[slug]/test` (that leader). Shared `TestEditor` (`addQuestionAction`, `updateQuestionAction`, `deleteQuestionAction`). Your work: question list with reorder affordance (if `order` exists), option editor with correct-answer radio, inline validation, delete confirmation, "bank is empty, invites will be refused" banner.

### 7.10 Approvals `/admin/approvals`

Administrative approvals on tickets (plan, budget, initiative…). States: `draft → awaiting → reviewing → returned/approved/rejected → executing → completed`. Actions: `requestApprovalAction`, `decideApprovalAction` (only the assigned approver; never one's own request), `resubmitApprovalAction`, `advanceExecutionAction`.

Your work: two lists ("بانتظار قراري" / "طلباتي"), state timeline per item, decision dialog with mandatory note on return/reject.

### 7.11 Tickets `/admin/tickets`, `/t/[number]`

Escalation chain: `department → lead_escalation → ceo_escalation → founder_escalation`, **2 days per stage** (`TICKET_STAGE_DAYS`). Statuses `open / in_progress / resolved`. Actions: `raiseAdminTicketAction`, `escalateTicketAction`, `respondToTicketAction`; members `raiseTicketAction`. "Add to Google Calendar" links via `/api/tickets/[id]/calendar` (a link, **not** a calendar sync). `/t/[number]` deep-links to the ticket on the right board.

Your work: board with tabs (مفتوحة · قيد المعالجة · محلولة · متأخرة), stage chip, countdown, step-by-step raise form (target department/person, subject, description, optional link validated by the allowlist), detail drawer with history.

### 7.12 Improvements `/admin/improvements` + floating button

Kinds: `bug` («الإبلاغ عن إشكالية»), `confusing`, `idea` («اقتراح تحسين»). States: `new → triaged → in_progress → awaiting_user → resolved → closed`. The drawer captures page path, viewport, theme, locale, user agent (declared, nothing else). Triage (Founder, CEO) advances state; the submitter confirms or rejects the fix (`confirmImprovementAction`).

Rules: general label **«تحسين»**; never «عطب» / «معطوب». One circular floating button (`.improve-fab`, inline-end corner, 52–56px, label visible ≥640px). Not in the sidebar. Already implemented; keep behaviour, restyle only if needed.

### 7.13 Execution `/admin/execution`, `/admin/execution/goals`, `/admin/execution/review`

Model: `StrategicGoal` (draft/proposed/approved/active/achieved/missed/cancelled) → `Milestone` → `DepartmentObjective` → `ExecutionPeriod` (weekly: draft → submitted → approved_for_review → awaiting_review → awaiting_opening → open → closed → reopened) → `WeekPlan` per department (draft/submitted/approved/returned, capacity points, overload acknowledgement) → `PlanTask` (weight, priority, due, owner user or member, dependencies, states `not_started … verified/returned/incomplete/blocked/waived/cancelled/superseded/deferred`) → `TaskSubmission` (evidence URL or file) → `TaskReview` (verified/returned/incomplete/flagged). Progress shown is **verified progress** (`verifiedPercent`), with reported progress beside it, never instead of it.

Carry-over [VERIFIED]: unfinished tasks carry into the next week with a reason and a corrective plan; consecutive carry-over is counted; **highlighted at 2, escalated to an executive decision at 3** (`CARRYOVER_ESCALATION`). Weekly review is on **Saturday** (`ReviewMeeting`, `MeetingConfig`, decisions with owners).

Actions (all in `src/app/admin/execution/actions.ts`): period (`submitPeriodAction`, `approvePeriodAction`, `beginReviewAction`, `completeReviewAction`, `openPeriodAction`, `reopenPeriodAction`), plans (`ensurePlanAction`, `submitPlanAction`, `decidePlanAction`, `setCapacityAction`, `recordCarryoverPlanAction`), tasks (`createTaskAction`, `updateTaskStateAction`, `submitTaskWorkAction`, `reviewTaskAction`, `changeDeadlineAction`, `waiveTaskAction`, `reassignTaskAction`), goals (`createGoalAction`, `decideGoalAction`, `createMilestoneAction`, `proposeObjectiveAction`, `decideObjectiveAction`), meeting (`saveMeetingSettingsAction`, `markStageAction`, `markMeetingHeldAction`, `addDecisionAction`).

Your work:
- `/admin/execution`: period header with state and the next allowed transition button (only for `canGovernPeriod`), department week-plan cards (state, capacity bar, overload warning), task table per department (filters: owner, state, overdue, carried), task drawer (submit evidence, review, change deadline with reason, reassign, waive with reason).
- `/admin/execution/goals`: goals list → milestones → objectives tree; propose dialogs; approval queue (Founder/CEO).
- `/admin/execution/review` (Founder/CEO): Saturday review agenda stepper (stages from `stagesDoneJson`), verification queue, carry-over decisions, meeting decisions with owners and due dates, "mark held".
- [OPEN] O5: annual/monthly *plans* as separate entities do not exist. Goals have start/due dates and milestones are monthly. Do **not** add annual/monthly plan modules; present goals by year and milestones by month.

### 7.14 Calendar `/calendar`

Everyone. Month grid (Saturday-first, Riyadh time) of goals, milestones, tasks, meetings, tickets, periods, filtered by what the viewer may see (`calendarEntries`). `?m=YYYY-MM`; each day cell has `id="d-YYYY-MM-DD"` (the dashboard mini-calendar links to it). Meetings come from `ReviewMeeting`; announcements may carry a `meetingUrl` (Google Meet link validated against the allowlist).

Your work: month grid + agenda list toggle (agenda on phones), kind legend with the kind colours in `KIND_COLOR`, day drawer. **No meeting-creation form exists** except review meeting settings; do not build general meeting creation (backend contract required, §11.3).

### 7.15 Reports `/admin/reports`

Founder/CEO/Ops: departments summary (lead, members count, open tickets, on-time closure tallies). Leader: own members report (`membersReport`). Closed-on-time tickets list (`closedOnTimeTickets`).

Your work: summary tiles + tables, department colour chips, print-friendly styles. [OPEN] O6: CSV export does not exist; do not add a fake export button.

### 7.16 Plans centre `/plans`

Everyone reads; Founder/CEO manage (`savePlanIntroAction`, `addPlanDocAction` (file or link), `renamePlanDocAction`, `movePlanDocAction`, `removePlanDocAction`). Files served by `/api/plans/[id]/file` (auth-gated). Links allowlisted to Google Drive/Docs, Canva, Meet (`src/lib/externalLinks.ts`, parsed hostnames, https only, no credentials in URL, server never fetches them).

Your work: intro block, ordered document list with type icon, reorder controls (managers), add dialog (file/link tabs), "fresh this week" badge.

### 7.17 Structure `/structure`, `/structure/pdf`

Everyone. Org chart **derived** from data (founder seat, CEO, Ops, departments with leaders and members, vacancies), view-only. `/structure/pdf` is a print layout (no sidebar, no floating button). Avatars served by `/api/avatar/[kind]/[id]?v=…` (cacheable). Own avatar upload (`uploadMyAvatarAction`, `clearMyAvatarAction`).

### 7.18 Messages `/admin/messages`

Founder, CEO. Email log (`EmailLog`: recipient, kind, subject, status, providerId, failureKind, failureDetail, attempt). Statuses are Arabic strings (`أُرسلت` = accepted by provider, `لم تُرسل (البريد معطّل)`, `لم تُرسل (سياسة التقليل)`, `فشل الإرسال`).

Your work: filterable table (kind, status, recipient search), failure detail drawer. Label «أُرسلت» as "قبلها مزوّد البريد". Never claim "delivered".

### 7.19 Signatures `/admin/signature`, Terminations `/admin/terminations`, Sheet `/admin/sheet`, Profile `/admin/profile`, Security `/admin/security`

- Signatures: draw/upload own signature (`submitSignatureAction`), Founder/CEO review (`decideSignatureAction`), request (`requestSignatureAction`). States `requested/submitted/approved/rejected/superseded`. A signature belongs to the person, never inherited by a successor.
- Terminations: member submits; decisions `meeting_requested / approved / rejected`; `effective` on end date; member may withdraw.
- Sheet (Founder): `backfillSheetsAction`, `prepareTabsAction`; show "Google Sheets not configured" honestly when credentials are absent.
- Profile (admins): `saveAdminProfileAction`, `resendWelcomeAction`, `setMyDepartmentAction`.
- Security (admins): TOTP setup/confirm/disable with QR.

---

## 8. STATES EVERY PAGE MUST HAVE

1. **Loading:** route `loading.tsx` skeleton matching the layout.
2. **Empty:** a sentence saying what would appear here and, if the viewer may act, the action that creates it.
3. **Error:** route `error.tsx` with a retry button and a human message. Never show stack traces.
4. **Unauthorised:** handled by the server redirect. Do not render a client-side "forbidden" page that leaks layout.
5. **Success:** only after the server action resolves without `error`.
6. **External dependency missing** (email provider, Sheets): state it plainly ("البريد غير مُفعَّل — لم تُرسل الرسالة").

---

## 9. FILES YOU MAY CHANGE / MUST NOT CHANGE

**May change:** `src/app/**/page.tsx` (JSX below the guard), `src/app/**/*.tsx` client components, `src/components/**`, `src/app/globals.css`, `src/i18n/dictionaries/*.ts` (add keys in both), `src/lib/navigation.ts` (grouping only), `src/components/icons.tsx`, new `loading.tsx` / `error.tsx`, new `src/dev/**` fixtures.

**Must not change:** `src/lib/**` (except `navigation.ts`), `src/auth.ts`, `src/proxy.ts` (or middleware), `prisma/**`, `src/app/**/actions.ts`, `src/app/api/**`, `scripts/**`, build scripts, environment variables, `vercel.json`.

If a page needs data the page does not fetch yet, you may add a **read-only** Prisma query in the page's server component **only** using existing scoped helpers (`ROSTER_MEMBER_WHERE`, `OPEN_DEPARTMENT_WHERE`, `calendarEntries`, `announcementsForSession`, `approvedGoals`, `goalProgress`, `membersReport`…). Otherwise list it as a required contract.

---

## 10. LEGACY UI TO REMOVE (after its replacement renders the same data and actions)

- Admin home "LinkGrid" link cards → replaced by grouped sidebar (keep count tiles).
- Header buttons «التحقق بخطوتين», «بياناتي», «تغيير كلمة المرور», «تسجيل الخروج» → move to the sidebar account footer and the mobile menu (§5.2), once the footer exists.
- Repeated `BackButton` on top-level pages.
- Any remaining hard-coded `BRAND.temptress` page backgrounds on `/member/test`, `/member/pending`, `/member/welcome`, `/forgot-password`, `/reset-password/[token]`, `/invite/[token]` → neutral `bg-page` with the login card style.

Remove nothing that still holds a unique action.

---

## 11. CONTRACTS

### 11.1 Session (`auth()`)
`{ user: { id, name, email, role: "super_admin"|"executive"|"operations_officer"|"department_admin"|"member", departmentId: string|null, departmentSlug: string|null } }`

### 11.2 Server-action result shape (convention)
Most actions return `{ error: string | null; success?: boolean; ...payload }` and call `revalidatePath`. Some throw `Error("…")` with an Arabic message (approve/reject). Wrap calls in `try/catch` and show `error.message`. Use `useActionState` for forms and `useTransition` for buttons.

### 11.3 Backend contracts required (do not fake; render "not available yet" or omit)
- C1. General meeting creation with attendees (only weekly review meetings exist).
- C2. In-app notification centre / bell (the ZIP shows a bell; no `Notification` model exists. Do not ship a bell with fake counts). [OPEN] O7.
- C3. Global search (the ZIP shows «بحث في المنصة ⌘K»; no search endpoint). Omit or limit to client-side filtering of the current page's data.
- C4. CSV/Excel export of reports.
- C5. Activity/audit feed for the Founder dashboard (audit data exists in specific tables: `MemberDateEdit`, `WorkChange`, `ApprovalDecision`, `EmailLog`; there is no unified feed).

---

## 12. ACCEPTANCE AND VERIFICATION (you must run these and report)

Commands (from the repo root, with a local PostgreSQL and `.env` `DATABASE_URL`):
```
npx tsc --noEmit
npx eslint src
npm run build
for f in scripts/e2e-*.ts; do npx tsx "$f"; done     # 27 suites, all must print ALL PASS
# browser checks against `AUTH_TRUST_HOST=true npx next start`:
npx tsx scripts/fixtures-roles.ts setup "<base32 TOTP secret of the local founder>"   # local-only role accounts
# the browser checks read SCRATCH/.totp-secret (same secret) and use scripts/totp-code.ts
node scripts/check-sidebar.mjs      # 5 roles: order, every link opens, active item, collapse, mobile 320–414
node scripts/check-dashboard.mjs    # 5 roles: no mock data, counts = DB, links open
node scripts/check-improve-drawer.mjs
node scripts/check-contrast.mjs
npx tsx scripts/fixtures-roles.ts teardown
```

Per route you change, report: route · roles tested · light/dark screenshots (desktop 1440 and phone 375) · actions exercised · result. Distinguish **UI rendered**, **action executed against local DB**, **not tested**.

Hard acceptance criteria:
- [ ] No route lost; every route in §7 renders for its roles and redirects others exactly as before.
- [ ] Sidebar: grouped, mandated order preserved, symbol+wordmark expanded / symbol collapsed, every link opens for its role.
- [ ] No sample data anywhere outside `src/dev/**`; `grep` for ZIP strings ("أحمد محمد", "68%", "اجتماع قيادة التَلاقِي") returns nothing in `src/app` or `src/components`.
- [ ] Dark mode uses the graphite tokens; no burgundy page/header backgrounds.
- [ ] Department colours from `colorHex`, unchanged by theme.
- [ ] One floating «تحسين» button per page, none in sidebar, none on `/member/test`, `/structure/pdf`.
- [ ] All forms submit to the same server actions; all destructive actions confirmed; success only after server success.
- [ ] AR RTL and EN LTR both correct; no horizontal scroll 320–414px; WCAG AA contrast.
- [ ] tsc, eslint (0 errors), build, all e2e suites and browser checks pass.

---

## 13. DELIVERY ORDER

1. Design-system components (§6.3) + `loading.tsx`/`error.tsx` patterns.
2. Grouped sidebar + account footer + header simplification (§5).
3. Auth pages restyle (§7.1) and candidate flow (§7.2).
4. Founder / CEO homes (§7.3), Operations (§7.4), Leader (§7.5), Member (§7.2).
5. People, Invites, Departments, Question banks (§7.6–7.9).
6. Approvals, Tickets, Improvements (§7.10–7.12).
7. Execution suite (§7.13), Calendar (§7.14), Reports, Plans, Structure, Messages, Signatures, Terminations, Sheet, Profile, Security (§7.15–7.19).
8. Legacy removal (§10), full verification (§12), report.

Open a pull request per stage against `claude/relaxed-rubin-tdysmx`. Do not merge to production yourself.

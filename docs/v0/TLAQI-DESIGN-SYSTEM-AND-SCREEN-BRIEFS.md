# تَلاقِ — UI Design System & Screen Briefs

This document is the product-design companion to `CLAUDE-UI-IMPLEMENTATION-PROMPT.md`. It defines visual decisions and screen priorities for the existing TLAQI Admin application. The real repository and its server-side rules always override the visual reference ZIP.

## 1. Design principles

1. **Trust before decoration:** neutral surfaces, clear typography, thin borders, restrained shadows.
2. **One strong focal point per page:** usually the page title/action or the most important current goal/decision.
3. **Real data only:** empty states are a designed outcome, not a gap to fill with sample data.
4. **Permission-aware UI:** a control appears only when the existing server-derived role and authorization allow it; the server remains authoritative.
5. **Arabic first:** RTL layouts should look intentionally composed, not mirrored as an afterthought. English must remain fully supported.
6. **Consistent rhythm:** use the same spacing, headings, cards, status badges, form fields, and table behaviors across routes.
7. **Mobile is a layout, not a shrink:** tables reflow into cards; actions remain reachable; avoid full-page horizontal scroll.

## 2. Page layout recipe

- Content max width: use the existing app shell width conventions; do not introduce a second unrelated container system.
- Main page padding: generous on desktop, reduced on mobile, consistent across routes.
- Page header: title first, supporting description below, primary action aligned to the logical end. Keep breadcrumbs only on deep pages where they clarify hierarchy.
- Cards: white surface in light mode, graphite surface in dark mode; 1px hairline border; restrained shadow; consistent 20–24px interior spacing on desktop and tighter on mobile.
- Section headings: title + optional short helper text + optional action. Avoid icon-only section headers without labels.
- Data tables: compact but breathable rows, aligned numeric data, visible status text, actions grouped. Mobile cards preserve the same information hierarchy.
- Forms: one clear label per field, help/error text directly adjacent, full-width inputs on mobile, no placeholder-only labels.
- Empty states: plain-language explanation, no illustration required, one contextual next action if a valid route/action exists.
- Errors: explain what failed and offer retry only when retry is meaningful. Do not conceal server errors behind generic success-like messaging.

## 3. App shell specification

### Desktop sidebar
- Expanded state: official TLAQI lockup, user identity, grouped navigation, account menu/footer.
- Collapsed state: official symbol only, icons with tooltip/title and accessible names; no clipped wordmark.
- Active state: subtle warm surface/accent with a clearly visible icon and text. Avoid oversized pills and excessive orange fills.
- Group headers are low-contrast but legible. Hide empty groups and all headings when collapsed.
- Preserve exact current hrefs, visibility and six shared-item relative order.

### Header
- Sticky, translucent neutral background that belongs to the page, with a subtle divider.
- Show current page/role context and existing theme/language controls.
- Keep profile/security/change-password/logout in the account menu, if this can be implemented without changing guards or current navigation behavior.
- On mobile, use exactly one menu trigger; navigation and account actions live in one coherent panel.

### Floating improvement control
- One small, accessible floating action labeled «تحسين».
- Do not place it over the last visible row or critical controls. Account for safe-area insets and scrollable content.
- Hide it on `/member/test` and `/structure/pdf`.
- Preserve current categories and server action; no fake toast.

## 4. Visual recipes by screen family

### Auth
Single centered panel, quiet brand lockup, secure-access eyebrow, concise heading, small helper text, fields with clear focus ring, one full-width primary action. Keep error copy close to the affected field or form. Never display role choice or a simulated authenticated state.

### Executive/founder dashboard
Start with date and role-specific greeting. A dark graphite/aubergine hero is reserved for the next approved goal and verified progress. Supporting content should use a balanced two-column layout on desktop: announcements and upcoming meetings; department overview/calendar below where authorized and backed by real data. No made-up KPI tiles. The dashboard should be calm and scan-friendly.

### Operations workspace
Prioritize assigned work, pending follow-ups, and open requests that are actually available to the role. Use work-queue rows and due/status emphasis, not broad organizational controls the role does not own.

### Department workspace
Use the department's stored color as a thin top/border/side accent. Show actual department identity and real team/work information. Keep department-specific ownership visible without using a large saturated department-color block.

### Member workspace
Prioritize own tasks, calendar, submissions, and requests. Hide admin-only modules and links. Empty states should point to valid member actions only.

### Work queues
Approvals, tickets, improvements, terminations, signatures: top summary only if real counts are already available. Then the actionable queue, clear status, and the next valid action. Keep destructive/irreversible actions secondary and protected.

### Execution and weekly review
Use a clear hierarchy for goals, milestones, department objectives, weekly plans, tasks, submissions, and reviews. Use real verified progress only. Make carry-over rules easy to understand, preserving existing thresholds and executive decisions. Avoid fake charts or a new plan entity.

### Structure and reports
Use clean hierarchy, restrained labels, readable tables, and printable output. The PDF route must be free from sticky controls, floating buttons, and unnecessary navigation chrome.

## 5. Motion and interaction

- Keep transitions subtle (roughly 120–200ms) and respect reduced-motion preferences.
- No bouncing, shimmer overload, animated counters, or decorative effects that compete with content.
- Menus and dialogs must support keyboard, Escape where appropriate, visible focus, and focus restoration.
- Every control must have a real outcome. Remove inert buttons rather than pretending they work.

## 6. Acceptance criteria

- Every route still uses its existing server data and authorization rules.
- No role sees links that redirect them unexpectedly.
- The app supports Arabic RTL, English LTR, light theme, and graphite dark theme.
- Department identity uses database colors; status colors remain semantically independent.
- Tables remain usable on mobile, forms remain accessible, and empty/error/loading states are designed.
- No duplicate logo, duplicate mobile menu, fake search/notification/export, or fake success.
- No new dependency and no unrelated backend/schema/auth change.

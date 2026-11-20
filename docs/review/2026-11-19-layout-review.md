# CCU planner layout review

Method: browser pane at 1440x900 and 820x1000, real data. Screenshots lagged one call behind in this pane, so many measurements come from JS (element rects, scroll heights) plus page text. Nothing was saved, accepted, synced or changed. I opened the Settings fold on Goals and clicked the CCUs chip on Hangar, and put both back. I stepped through the 3-step help tour but did not press Done.

## 1. Overall verdict

1. The visual language is coherent (dark glass panels, ship art, coloured state chips). The Today and Goals cards look modern, and the colour code is a good idea.
2. The weakest point is cause and effect. At 820px the Goals list is 1335px tall and the open goal starts at y=1618. In both sizes, Settings (start ship, how to buy, priority, lock) sits at the bottom of the goal and changes the route and prices near the top.
3. Hangar and Prices pages are very long, flat lists (Hangar 23,600px at 1440 and 38,900px at 820; Prices 9,750px). Admin-style forms (tokens, sale events, expected prices) come before the content a newcomer wants.
4. Pages disagree with each other: content max-width is 1100, 1500, or unlimited. Page titles, action placement and panel styles differ. Today's hero says "Nothing to buy today" directly above "buy 1" cards.
5. Menus and help need polish: the Sync menu does not close on Escape, outside click, navigation or the help dialog. The Advanced items have no explanation. The tour repeats one title three times.

## 2. Per page

### Top bar (all pages)
1. **Sync menu never closes** (seen at 820, same code at 1440). It stayed open through navigation to Today and under the help dialog, and covered the Today hero. Shell.svelte closes Advanced on Escape and window click, but SyncMenu.svelte has no equivalent. Fix: close on Escape, on outside click and on route change.
2. **Top bar wraps to two rows at 820** (nav, then status text + Sync + ?). It works, but it eats about 70px of a sticky header on every page. Fix: at <1024px put the "Store: ... Hangar: ..." freshness text inside the Sync menu and keep one row.
3. **Advanced items have no description.** "Graphs", "Plan explorer", "Prices & availability" mean nothing to a newcomer. Fix: add a one-line subtitle to each item in Shell.svelte.
4. **Sync menu mixes actions of very different weight** (Hangar fast, Store 4-5 min, Sign out) in one flat list with no per-item "last synced" and no separator before Sign in/Sign out. Fix: group the data syncs, add last-synced beneath each, separate the account actions.
5. The "?" button is a bare glyph. Fix: label it "Help" at desktop.

### Today
1. **Contradictory headline (1440 and 820).** The hero says "Nothing to buy today" and the next two cards say "buy 1", "$10" and "$50". The card tags (On sale, no rush / Optional) are right; the hero is too absolute. Fix: TodayPage.svelte hero copy, for example "Nothing urgent. 2 optional buys", with the same count chips as the cards.
2. **Hero is about 235px tall and mostly a photo** at both widths. The first actionable card starts at about y=435 at 820. Fix: shrink the hero to a slim banner of about 100px with the headline and the Reload data button.
3. **Help hint banner above the hero** pushes the content down (about 60px at 820), and its legend text names four colours that the viewer has not seen yet. Fix: show the legend next to the chips, or in the Help menu, and keep one dismissible banner at most.
4. **Dead space at 1440.** Content is capped at 1100px and left-aligned, so a 340px empty strip sits on the right. The 3-column "Wait for a sale" grid is fine. Fix: centre the column, or use `max-width: 1100px; margin-inline: auto` across all pages (see section 3).
5. **Repeated information.** "Reload data" is in the hero, but the text under it says to use Sync > Store, and the Sync menu has the same action. Fix: one clear button or the instruction, not both.
6. **Optional card controls are small.** "If I buy this", "Don't lock this goal" and "Ends soon" are tiny pills with the same weight as chips, so they read as state, not actions. The "Runs until... dd.mm.yyyy" date row sits permanently open on the card. Fix: make secondary actions into a quiet "..." row and collapse the date field behind "Set end date".
7. 12px grey sublines ("cash only · Standard is $50 · for Liberator") are low contrast on the glass. Fix: raise `--muted` a step for body-size text.

### Goals (with a goal open)
1. **List and detail far apart at narrow width (820).** The list is 1335px tall, the detail starts at y=1618, so selecting a card at the top moves the result about 1.3 screens down. `reveal()` scrolls the pane into view, but then the list is gone and you have to scroll back up to choose another goal. This is the reported complaint. Fix: below 960px, replace the card list with a compact horizontal strip or select (one row of ship name + price) above the detail, and keep the full cards for the wide layout.
2. **Settings is far from what it changes (both widths).** At 1440 the Settings fold is at about y=1190 and the route it alters is at about y=670; at 820 it is about 700px below the route. Start ship, "How to buy", Lock price and Priority all re-plan the route above. Fix: GoalDetail.svelte: put "Starts from" and "How to buy" in a short row directly under the price figures (or make the fold open by default), and leave Remove goal in the fold.
3. **Priority exists twice** (High/Normal/Low under every list card and again in Settings). Changing it re-sorts the list. The per-card buttons add about 30px to every card and make the list long. Fix: keep the control only in the detail, show priority as the section grouping that already exists.
4. **Two hint banners stacked** ("Each row is one upgrade..." and "Goals are planned together...") take about 120px at 1440 and 140px at 820 before any goal. Fix: merge into one banner, or move the second into the "alone" price tooltip.
5. **Wide layout works well:** sticky list at left (360px) and the detail at right at 1440. Keep it. Issue: the list scrolls inside its own scroller next to the page scroller (two scrollbars). Fix: acceptable, but make the list's scrollbar slimmer and avoid scroll chaining.
6. **Detail stacks six collapsed folds** (CCUs you own into..., Settings, Other ways, Without this goal, What would make it cheaper, Price chart) of the same weight. A newcomer cannot tell which matters. Fix: put "Other ways" first, move "Price chart" and "Without this goal" into a single "More" fold.
7. The segmented control "Best route now / Your accepted route" sits above a bare progress bar with no label. Fix: label the bar ("2 of 3 steps need a sale") or drop it.
8. In the route rows the buy/wait chip, price and kind chip are far apart at 1440 (row is 1015px wide), so the eye travels. Fix: cap row text width or align the price column in a fixed grid.

### Hangar
1. **Very long (23.6k px at 1440, 38.9k at 820)** because the default "All 353" chip lists every pledge, one row per item including 24 paints and 82 pieces of equipment. Fix: default to "Ships and packages" (15), put "All" last.
2. **Controls before content.** At 820 the search box starts at y=1469 and the first pledge at y=1587, below the 800px "Your ships" panel and the 532px token panel. At 1440 the list starts at y=1169. Fix: move search and chips directly under the summary, and put the token panel in its own fold ("LTI tokens: 10 in the pool").
3. **Token toggles have their effect on another page.** "Use as token / Never use as token / Default" changes goal prices on Goals, with no confirmation here of what changed. Fix: show "N goals re-planned" or the price delta after a toggle in TokenPanel.svelte.
4. **CCU table repeats identical rows** (196 rows: for example three "Razor -> SRV $5 free giftable"), with no grouping or "x3". The "Match" column shows raw values like "item-id" and "name", which wrap and mean nothing to the user. At 820 the Status tags stack to 3 lines per row. Fix: group identical CCUs with a count, hide Match behind a details toggle, merge Status into one chip.
5. **Placeholder tiles.** Ships without art show a grey "AAA" box, and rows without a ship have a blank 160px indent. Fix: use a neutral ship icon, and no indent for non-ship pledges.
6. **No max-width:** the page runs the full 1389px at 1440, unlike Today and Store (1100). Rows then have a very wide gap between name and value. Fix: apply the shared max-width.
7. "Worth melting" is at the very bottom (y=38,454 at 820) when there are no candidates, but it is the only decision-oriented block on the page. Fix: always show a one-line status at the top ("Nothing worth melting"), link to the section.
8. The summary bar is a run of nine equal-weight numbers. Fix: bold the two that matter (pledges, total value) and put category counts into the chips that already show them.

### Store
1. **Forms before content.** At 820 "Sale events" (282px) and "Check an offer" (183px) come before "On sale now", so the first offer is at about y=800 of a 1000px window. At 1440 the offers start at about y=700 of 900. A newcomer opens Store to see offers. Fix: WarbondsTab.svelte: put "On sale now" first, and fold "Sale events" and "Check an offer" below it or into collapsed panels.
2. **Filters sit far from the list they filter.** The 24h/7d/30d and "only my goals / only from ships I own" controls are above the search box, and the list is below. They are adjacent, so this is mild. Fix: group search and filters into one sticky bar.
3. **The list has no end.** "On sale now" is 3,006px at 820 (883 offers) and ends in a flat list of "recently appeared / disappeared" rows (about 160 + 320 entries). Fix: cap with "Show more", and fold the appeared/disappeared list.
4. **Sale events panel warns in orange** ("No sale events entered") and the suggestion button is a small pill inside the text line. Fix: make "Add IAE 2956" a primary button on its own line.
5. Chevron at the right of each offer card is about 4px and unclear. Fix: use a visible chevron or "Details".
6. Disabled fields ("Price $", "Add sale event") are almost invisible against the panel. Fix: raise the border contrast of disabled inputs.
7. Dead 340px strip at the right at 1440 (1100px cap, left-aligned).

### Graphs (Advanced)
1. **No ship labels on nodes** (both widths), so the graph is a decorative tangle for a newcomer, and the text above says "20111 edges hidden; narrow the price range". Fix: GraphTab.svelte: show names for route and selected nodes, default to Decision view, and show "edges hidden" as a hint, not a warning.
2. **The Goal select sits outside the panel**, above the title, with no label styling, while Decision/Network and filters are inside. Fix: move it into the panel's header row.
3. At 1440 the drawing uses only about 75% of the panel and the detail column is empty until a click ("Select a ship..."). At 820 the detail goes below the graph, off-screen, so the click's result appears below the fold, a small repeat of the main complaint. Fix: show the selected ship in an overlay or fix the detail to the top at narrow width.
4. No page title.

### Plan explorer (Advanced)
1. **Almost empty page**: one form panel and "Pick both ships." with the rest blank (at 820 about 800px of empty space). Jargon: "Credit ($)", "Routes (1-5)", "Max steps 25", "Objective cash/allin", "No owned / No Warbond". Fix: PlanExplorer.svelte: add a one-line intro, plain labels ("Money I can use", "How many alternatives") and help text for "allin".
2. Results appear directly below the form, so cause and effect is fine here.

### Prices & availability (Advanced)
1. **9,750px of near-identical rows.** "Ship availability (179)" is 8,117px at 1440, each row reading "100i: unknown · seen on sale 2 days outside events" with an auto/regular/event-only select. Fix: PricesTab.svelte: show only ships whose status is not "unknown", or group the unknowns behind one fold with one bulk line.
2. **No page title or intro.** The page starts with a search box and a line that says "Sale events are entered on the Store". Fix: add a heading and a two-sentence purpose.
3. **Sticky search sits in a black band** at 820 that does not match the page background. Fix: use the glass/background token for the sticky strip.
4. Empty grey square thumbnails for ships without art (100i, 125a, 135c at 820).
5. The "Expected prices" form fields are stacked full width on 820 with a 360px max, so the form looks half-finished.

### Sync menu
See "Top bar" 1 and 4. It is not a page, but it is the entry to every refresh. Besides the close problem, nothing tells the user which action to run first or how stale the data is.

### Help / tour / glossary
1. **The tour has the same title three times** ("How CCUs work" at steps 1, 2 and 3) and the steps are one sentence each. Fix: Onboarding.svelte: title the steps (What a CCU is / Why chains / Why wait for sales) and point to the real controls.
2. **Done appears dimmed** on step 3, so it looks disabled. Fix: use the primary style.
3. **Glossary is a flat, long modal** (1,251px of text in a 890px dialog, so it scrolls) with no search and an order that is neither alphabetical nor by task. Fix: Glossary.svelte: order by reader journey (CCU, Standard vs Warbond, Store credit, LTI, Chain, Lock, Melt...) and add a filter box.
4. The `?` hint chips on cards (Warbond ?, Standard ?) are the right idea. They are 14px targets. Fix: enlarge the hit area.

## 3. Cross-page consistency fixes

- **One content width and alignment.** Today, Store, Plan explorer, Prices: 1100px left-aligned; Goals: 1500; Hangar: no cap; Graphs: full. Use one `.page` wrapper (max-width about 1200, centred) and let only Graphs and Goals opt into wide.
- **One page header.** Today has a hero, Goals has none, Hangar has a summary bar, Store has hint + panels, Prices has a search box, Graphs has a bare select. Give every page a title row: title, one sentence of purpose, and the page's primary action on the right.
- **Where actions live.** "Reload data" is in Today's hero, Sync in the top bar, "Add sale event" and "Check" inside Store forms, "+ New goal / Import / Accept all" at the bottom of the Goals list. Put the main action for each page in the title row.
- **One hint pattern.** Hints are full-width banners with "Got it" on Today, Goals (two), Store. Use at most one per page, collapsed to a small "?" after the first dismissal.
- **Forms last, content first.** Store, Hangar and Prices all put forms/settings above lists. Rule: lists first, rarely used forms in folds below or in a side panel.
- **Long lists:** use the same pattern on Store (appeared/disappeared), Hangar (All), Prices (availability): show the first 20 and "Show all N", group duplicates with a count.
- **Row style:** Hangar rows (glass pill), Prices rows (thin divider lines), Store cards (large images), Goals cards (image left). Pick card for choices and divider rows for tables, and reuse them.
- **Chips:** filter chips (Hangar), state chips (Today), tags (Hangar rows) and segmented controls (Store 24h/7d/30d, Goals tabs) are four visual styles. Share one.
- **Placeholders:** "AAA" tile (Hangar), blank squares (Prices), blank indent (Hangar rows). Use one neutral ship-icon placeholder.
- **Muted text:** the 12px grey lines on Today, Goals and Hangar are the least readable text in the app. Raise `--muted` in tokens.css.

## 4. Prioritised changes (max 12)

1. **Goals at narrow width: replace the tall card list with a compact selector above the detail (or sticky detail header with a "Goals" jump).** Fixes the reported scrolling complaint. GoalsPage.svelte. Size M.
2. **Goals: bring "Starts from" and "How to buy" next to the route/price figures (or open Settings by default) and drop the duplicate Priority from list cards.** GoalDetail.svelte, GoalsPage.svelte. Size M.
3. **Fix the Sync menu: close on Escape, outside click, navigation and when the help dialog opens; add last-synced text and a separator before sign in/out.** SyncMenu.svelte, Shell.svelte. Size S.
4. **Today: correct the hero ("Nothing urgent, 2 optional buys"), shrink it to a slim banner, show one hint instead of the colour-legend banner.** TodayPage.svelte. Size S.
5. **Hangar: default chip to "Ships and packages", search + chips directly under the summary, tokens in a fold, "Worth melting" status line at the top.** HangarTab.svelte, TokenPanel.svelte. Size M.
6. **Store: "On sale now" first; Sale events and Check an offer into folds below; cap and fold the appeared/disappeared list.** WarbondsTab.svelte. Size M.
7. **Shared page wrapper with one max-width, centred, plus a page title row (title, purpose, primary action).** Shell.svelte plus each tab. Size M.
8. **Prices & availability: hide or group "unknown" rows, add a title and intro, fix the black sticky band.** PricesTab.svelte, ui/SearchBox.svelte. Size S.
9. **Graphs: node labels for the route and the selected ship, goal select inside the panel, selected-ship detail visible at narrow width.** GraphTab.svelte. Size M.
10. **Hangar CCU table: group identical copies with a count, hide the Match column behind details, single status chip.** HangarTab.svelte. Size S.
11. **Help: titled tour steps, primary Done button, glossary in journey order with a filter; add one-line descriptions to the Advanced menu items; plain-language labels in Plan explorer.** Onboarding.svelte, Glossary.svelte, Shell.svelte, PlanExplorer.svelte. Size S.
12. **Shared tokens: raise `--muted` contrast for 12px text, one chip style, one image placeholder, higher contrast for disabled inputs.** ui/tokens.css, ShipThumb.svelte, ui/StateChip.svelte. Size S.

# CCU Planner UX review · 20 November 2026

The planner answered “Do I have to buy anything today?” in one glance. Its harder question is “What am I actually building?” The same goal can have a reserved chain, a cheaper proposed chain, upgrades already in the hangar, and a step on sale for a different goal. The app has the information to explain all four. The reader currently has to assemble the answer from several panels.

## Five problems to address first

| Priority | Problem | First change |
|---|---|---|
| 1 · High | The selected chain and its headline price can describe different routes. The accepted 600i chain shows $40 + $10 in missing upgrades under a $45 headline. | Bind the price, progress, next action and chart to one visibly named chain. |
| 2 · High | Owning the CCUs looks like having built the ship. In the sample, Beta was “Done ✓” before and after I reserved the upgrade. The sample never showed Beta being built. | Distinguish collecting upgrades, reserving them and applying them. Give every collapsed section endpoints and step numbers. |
| 3 · High | Store calls a source ship “yours” when the user may own only an upgrade **into** it. The ownership filter still lists other sources inside the card. | Distinguish owned ships from owned upgrades and apply the source filter to individual offers. |
| 4 · High | “Full price”, “$400 less” and an apparent sale prediction combine a direct-upgrade benchmark, remaining new cash and historical estimates. A user can mistake prior spending for a discount. | Lead with remaining new cash. Show the direct-upgrade comparison and the basis of the estimate separately. |
| 5 · High | A newcomer following the sample’s default new-goal flow lands on a goal with no starting ship, although the sample can demonstrate a complete Alpha → Beta chain. | Detect the missing LTI starter in the form. Offer a viable example and preview the chain before adding the goal. |

The November 19 layout review is a useful baseline. The shorter Today hero, page headings, grouped hangar copies, narrow goal selector and searchable glossary are present now. Keep them. The issues below concern what those screens mean and what a user can decide from them.

## Task walkthrough

| Task | Newcomer’s path and hesitation | Expert’s path and hesitation |
|---|---|---|
| First start → first goal | The Aurora $50 → Cutlass $110 example makes the $60 difference easy to understand. “See an example first” opens Today with Gamma already configured. A modal repeats what a CCU is. I went to Goals → + New goal, selected Beta with the keyboard and accepted the default start. Only after adding Beta did I learn the sample had no eligible LTI ship. “Choose a starting ship” → Alpha recovered it. | The welcome screen distinguishes migrating another planner from importing CCU Game chains, which is worth keeping. The import instruction points to Goals, but the wide Goals view places import after the scrolling goal list and the narrow layout places it after detail. Put “Import CCU Game chains” beside “New goal”. |
| What should I buy today, and why? | “Nothing must be bought today” plus two optional offers is a clear answer. On the $10 Galaxy card I had to read to the small “for Liberator” line to discover what I was building. The long explanation about three CCUs held by 600i answers a different question from whether buying today saves money. | “If I buy this” gave the most useful answer of the session: one $10 copy pays $10 of Liberator’s plan early and leaves the total unchanged. Lead with that result when available. Keep the exact competing CCUs available on demand. The intro hint and end-of-offers reassurance both repeat the hero. |
| How far is my goal, and what’s next? | For 600i, “Next: wait for a sale on Pulse → Syulen” works. I could count what was missing, but “16 steps you already own” hid where the long final run starts. Nothing shows at a glance that each intermediate ship is the result of applying the previous upgrade. | The accepted/best toggle exposed a real $5 opportunity. Comparing the chains required scrolling between figures and individual rows and adding the rows myself. At 820 px the first upgrade began around y=1162. The next action at y=500 was visible. |
| What do I own? | The ship portraits, copy counts and insurance tags answer the fleet question immediately. Opening CCUs produced “CCUs 197”, then “All 196”. A $5 copy labelled “Free” made me check the column headings. | Grouping identical copies while keeping reserved and available copies separate is valuable. I could find “Reserved for Galaxy” beside the paid price. At 820 px the fleet gallery fills the first screen even when I came to look up one CCU. |
| Is this offer worth it? | In sample Store I opened the manual checker and entered Alpha → Gamma, Warbond, $15. “Worth it” and “Gamma gets $5 cheaper” answered immediately. The same result then said “goals get $20 cheaper”. Both numbers reconcile, but the sentence makes the reader do the accounting. | In the real Store I explored Liberator’s offers with “only from ships I own” enabled. Expanded sources included unmarked ships and ships marked owned that the fleet gallery does not list. There is no “check this exact offer” action in the offer row. To price a specific pair against the fleet I have to enter it again. |
| Accept a plan | On the sample Beta goal I clicked “Accept this plan”. Beta moved to Accepted, the detail said “Still valid”, and Release appeared. The reservation worked and the reassuring sentence helped. The unchanged “Done ✓” made it hard to name what my click achieved. | The action comes before the chain. In a multi-goal fleet I want the specific reservations and affected goals visible at the decision point. Bulk acceptance and single acceptance each carry almost the same generic paragraph. Summarize the specific reservation beside the button and expose the common mechanics once. |

## First-screen audit

Measurements are approximate CSS pixels in Chrome at 1440 × 900 and 820 × 900, with page hints visible. “First screen” means the initial content area before scrolling. Text inside a closed disclosure is excluded.

| Page | 1440 px | 820 px | Keep / reduce |
|---|---|---|---|
| Welcome / setup | Purpose, example, steps and sample entry fit. | Sample entry starts around y=789 with a clean session-status display. | Keep the worked price example. Bring the two entry choices above the account instructions. |
| Today | Yes for urgency and both purchase candidates. Waiting starts near y=884. | Yes for urgency. The wait summary starts near y=954. | Keep the action groups. Give the goal and financial consequence room currently occupied by explanatory scaffolding. |
| Goals / Goal detail | Yes for the selected goal’s next move. The first chain row starts near y=861. | Partial. Goal heading near y=414, progress near y=1096. | The selector solves the previous long-list problem. A user should see the chain directly below its next move. |
| Hangar | Yes for ships. Search and categories follow the gallery. | Yes for ships only. Even the starting-ship fold above search starts near y=1124. | Make Ships and CCUs peer entry points above the gallery. Keep pictures in Ships. |
| Store | Yes for checking a pasted deal. First goal-related offer group near y=675. | Checker visible. Goal-related listings begin near y=750. | Keep the checker discoverable. Give each offer row a way to run the same calculation. |
| Prices & availability | Yes for editing assumptions. Grouping the 179 undecided ships helps. | Same. Expected prices and the availability summary fit. | “193 offers affected” occupies attention even when the expected price equals the current price. |
| Graphs | A network is visible, but no goal is selected and Decision is disabled on direct entry. | Same question remains unresolved above a large drawing. | Offer “Explore a goal” as the entry for chain questions. Preserve the whole-network view for browsing. |
| Plan explorer | Yes. The From and To fields explain where to begin. | Yes. The options fit, though they compete with the first two inputs. | “Money I can use” is ambiguous. Put route limits and exclusions in “Search options”. |
| Help / glossary | The tour introduces one concept per step. Search is available in the glossary. | The glossary works with keyboard search, Tab and Escape. | Searching “chain” returned one definition. An ordered worked example would teach more than another definition. |

## Does each page belong, and can I move between them?

**Keep the four primary tabs in their current order.** Today is the right landing page for a returning user checking a sale. Goals explains a recommendation against a longer-term intention. Hangar answers what resources are available, and Store lets the user bring an offer to the planner. The biggest navigation cost comes *after* picking a tab. The user sees a named goal, ship or upgrade, then has to find the same thing again on another page. A sidebar would leave that problem intact.

### Page-by-page design judgment

| Surface | Does the page make sense here? | Visual hierarchy and recommended change |
|---|---|---|
| Welcome / Import | Yes as the entry point. Account connection, exploring an example, bringing in CCU Game chains and moving a planner install are four different intentions. | The narrow reading column suits the worked example. Give it two immediately visible actions, “Connect my account” and “Explore a sample chain”. Keep the install-migration disclosure visually quiet. Place “Import CCU Game chains” in the Goals header after setup. |
| Today | Yes as a decision dashboard. The urgency headline earns its place. | The hero is easy to scan. Below it the eye encounters a ship pair, badges, dollars, quantity and an RSI action before it learns which goal benefits. Give each recommendation a goal heading and one outcome sentence. Let the upgrade pair link to its place in that goal. |
| Goals overview | Yes as a fleet overview. The first question with several goals is “Which one needs attention, and what is our total?” | The wide split view earns its space, but each small card carries art, starter, price, bar, progress sentence and status. Meanwhile the fleet total sits after the list. Put the total and number of blocked goals above the list. Show ship, remaining cash and next decision in the selector; reserve the full bar for the selected detail. At 820 px pair the selected name with “Choose goal” so offscreen chips are discoverable. |
| Goal detail | Yes next to the overview on desktop. It should be the permanent home for a chain and its reservations. | The ship art identifies the selected goal well. The financial panel, accepted-route panel and settings panel each interrupt the path from next action to first upgrade. Put next action, progress and chain together. Give settings one editable summary line and move reservation controls beside the chain they affect. |
| Hangar / pledge detail | Yes for inventory. The ship gallery and the ledger serve different lookup tasks. The pledge detail is an appropriate overlay because its owner is still the ledger beneath it. | Keep art for recognising ships and compact rows for comparing upgrade copies. Make the category switch the first control so an expert can go straight to Upgrades at either width. Put “Open on RSI ↗” in the detail header and give internal reservation links goal names. |
| Store / offer checker | Both belong together. Someone with a pasted Discord deal and someone browsing current sales should have equally clear entry points. | The open multiline form looks like the primary task even with nothing pasted. Show “Browse offers” and “Check a deal” beside the page title. Open a check directly from an offer row and show its verdict beside the price the user selected. Keep event maintenance below both. |
| Prices & availability | Yes as a secondary tool. Its current name and page description overlap Store, although the main task is inspecting or changing planning assumptions. | The search, editable prices and availability evidence suit a quieter settings layout. Name the tool **“Price assumptions”**, separate observed store prices from user estimates, and lead with active assumptions. Use **“Manage sale dates in Store”** for the return link and land on that section. |
| Graphs | The goal-specific decision view belongs within reach of a goal; the whole-network map makes sense as an expert tool. | A wide canvas is a good use of space when the user has an object to inspect. An unselected network, empty detail area and edge-count notice make a poor introduction to chains. Link **“View this chain on the map”** from goal detail. Label the standalone entry **“Upgrade map”**. |
| Plan explorer | Yes as a scratchpad. A newcomer can easily mistake “Plan explorer” for the place to see saved plans. | Lead with From → To and “Find routes”. Collapse search limits and exclusions. Label the entry **“Compare routes”**. On a result offer **“Use these ships for a new goal”**, prefill the form and recalculate against the fleet before the user adds it. |
| Tour / Glossary | Both work as overlays because a quick definition should return the reader to their task. A returning expert opening “?” may just want to look up one term. | Keep contextual term links, search and focus return. Give the global Help entry two explicit choices, **“Look up a term”** and **“How upgrades work”**. Keep the tour optional and teach the sequence with one worked chain. |

### Navigation walkthrough and impact

| Impact | Journey and evidence | Concrete change |
|---|---|---|
| High | **Today → goal.** At both widths, selecting the Carrack card under the waiting summary opened Carrack detail correctly. But the actionable Galaxy purchase higher up says “for Liberator” in plain text. Its outgoing action opens RSI. The easiest internal link is on the less urgent part of the page. | Make “For Liberator” an internal link. Land on the relevant step, expand its group, and highlight it with keyboard focus. Preserve the Today group and scroll position on return. Components: `TodayPage.svelte`, `GoalsPage.svelte`, `GoalDetail.svelte`. |
| Medium | **Store → Hangar → Store.** At both widths I searched Store for Galaxy, opened a result, visited Hangar and returned. The search was empty and all offer cards were closed. A check of what I own costs me the offer I was evaluating. | Retain each tab’s search, filters, open result and scroll position for the session. Add “See matching upgrades in my hangar” beside an offer. A return action such as “Back to Galaxy offers” should restore the original list. Components: `Shell.svelte`, `WarbondsTab.svelte`, `HangarTab.svelte`. |
| Medium | **Goal → Hangar and back.** Chain rows offer “Hangar ↗”, which opens the RSI hangar. In the app’s own inventory, “Reserved for Galaxy” is a status label. A user trying to trace a particular copy has no direct round trip between the two local views. | Give owned steps **“View this copy in Hangar”**. Give a reserved copy **“View Galaxy chain”**. Show external RSI links separately. Components: `ui/JourneyStep.svelte`, `HangarTab.svelte`, `PledgeDetail.svelte`. |
| Medium | **Store ↔ Prices.** Store has a direct link to Prices at the bottom. Prices tells users to enter sale events on Store, but its link selects the Store tab without selecting or revealing Sale events. The words promise a more precise destination than the action delivers. | Route that link to the open Sale events section and focus its heading. Offer “Back to price assumptions” when the user came from there. Components: `PricesTab.svelte`, `Shell.svelte`. |
| Low | **Goal → Graphs.** After explicitly selecting Carrack, opening Advanced → Graphs retained Carrack at both widths. That is good context sharing, but the user has to know to look under Advanced. The browser address also stayed at the root throughout the tested tab changes. | Keep the shared selection. Add the map link on the goal and a return link labelled “Back to Carrack”. For browser use, consider view history for Back/Forward; in the desktop app a visible local return path is sufficient. Components: `GraphTab.svelte`, `GoalDetail.svelte`, `Shell.svelte`, `state.svelte.js`. |

**Design direction.** Keep the dark palette, ship photography and compact top navigation. Use photography where recognising a ship is the task. Use aligned text rows where comparing prices or reading a sequence is the task. Use the strongest accent for the user’s next decision. A chip naming a goal should either open that goal consistently or have a visibly different treatment from a link. These changes give the existing interface a clearer hierarchy without requiring users to relearn its four destinations.

## Findings ranked by impact

Component paths below are relative to the repository root. UI component names without a directory prefix are in `app/src/lib/`.

### High

**H1 · Make every number follow the selected chain.** Goals, `GoalDetail.svelte`, `Staircase.svelte`. On 600i Explorer, Best route now showed 19 steps, 17 owned, with $40 and $5 missing. Your accepted route showed 17 steps, 15 owned, with $40 and $10 missing. The header kept $45, the same savings and sale estimate. In source, figures come from the best journey, progress and next action follow the toggle, and the price chart prefers the accepted route whenever one exists. The toggle’s accessible label explains the figures, but a sighted comparison has no equivalent. Put the selector above all route-dependent content. Use **“Reserved chain · $50”** and **“Proposed chain · $45”**. Under the latter show **“Saves $5 in new cash. Your reserved chain stays in place until you switch.”** List changed steps and reservations before the switch action. Keep the chart in the same selection and title it “Ship value after each upgrade”.

**H2 · Show how a chain becomes a ship.** Goals, `GoalDetail.svelte`, `ui/JourneyStep.svelte`, `ui/JourneyBar.svelte`, `src/logic/describe.mjs`, `src/logic/glossary.mjs`. The first 600i row shows Pulse → Syulen, then labels Pulse as the starting ship *below* that transition. The last 16 owned steps compress to a count with no endpoints. Sample Beta showed “All 1 step is already yours” and several “Done ✓” labels for an owned, unapplied upgrade. Put the starting ship first, number each transition, and name both ends of a collapsed run. Use **“Upgrades collected · 1 of 1”** and **“You own the Alpha → Beta upgrade. Applying it to an Alpha turns that ship into Beta.”** For a fixed start, identify separately whether the planner has matched an actual starting pledge. Use **“You can collect upgrades in any order. To build the ship, apply them in the order shown.”** once above the first chain. Distinguish that from the planner’s reservation status. Keep applied/owned-ship claims tied to hangar evidence.

**H3 · Separate owning a ship from owning a way into it.** Store, `WarbondsTab.svelte`, `src/logic/warbonds.mjs`. The Liberator listing says M2 Hercules is “yours”. The fleet gallery does not list an M2. The ownership helper explicitly unions ships inside pledges with the destination of every owned CCU. An incoming CCU alone cannot supply an immediately usable starting ship. Further, the checkbox filters *targets* with any matching source, then Details renders *every* source, including Genesis and Railen without ownership badges. A shopper may pick a cheap but unusable link. Offer separate scopes **“Ships in my hangar”** and **“Ships I have an upgrade into”**. Apply the scope to the individual sources, cheapest-price caption and count. Use row badges **“Ship owned”**, **“Own an upgrade into this ship”**, or **“Used in Liberator’s chain”** according to the evidence.

**H4 · Explain what the cash comparison measures.** Goals, `GoalDetail.svelte`, `ui/MoneyFigure.svelte`, `src/logic/journey.mjs`. For 600i the large struck-through $445 is the target-minus-starter list-value difference. $45 is new money left after owned upgrades and applicable credit. “$400 less than the full price” looks like a realized saving, even though the owned CCUs may have cost money. The sample makes this particularly clear with $25 struck through and $0 remaining for a CCU already paid for. Lead with **“New cash still needed · $45”** and **“Direct upgrade at list value · $445”**. Add a breakdown for paid upgrades, credit applied and purchases remaining wherever known. For an inferred $38.79 with no observed price for these steps, use **“Estimated new cash if discounts return · about $39”** and put the range, calculation and observed-versus-inferred basis under “How this estimate works”. Suppress the sale forecast when all upgrades are collected.

**H5 · Catch the missing starter before goal creation.** Welcome and Goals, `Onboarding.svelte`, `AddChain.svelte`, `goals/StartControl.svelte`, `GoalDetail.svelte`. The sample goal form promises that the planner picks a cheap insured ship even when the sample has none. Beta was successfully created, followed by “needs a starting ship”, “Needs a starting ship” and “No starting ship found yet”. Show the detected condition at the choice: **“No eligible LTI ship in this hangar. Choose a starting ship, or save this goal for later.”** Provide **“Choose a ship”** and **“Add goal without a starter”**. In the sample, offer **“Try Alpha → Beta using an upgrade you already own”**. Show the example’s two endpoints and cost before saving. Keep the recovery action for existing goals that later lose a starter.

### Medium

**M1 · Promote the fleet consequence on Today and Store.** `TodayPage.svelte`, `BuyWhatIf.svelte`, `store/CheckOffer.svelte`, `WarbondsTab.svelte`, `src/logic/whatifText.mjs`. A $10 Galaxy purchase is $40 below the Standard offer, yet buying now leaves the current fleet plan’s total unchanged. Those are different comparisons. Use **“For Liberator · $10 cash”** and **“Buying now pays $10 of the planned cost early. Your total stays the same.”** Keep shared-resource details behind “Why this upgrade?”. In Store add **“Check against my goals”** to each source row with the pair, kind and price prefilled. For the sample $15 check, replace the two apparent savings figures with **“Save $5 overall. This $15 purchase replaces a planned $20 purchase for Gamma.”** Keep per-goal deltas available for multi-goal cases. Run expensive comparisons on demand or reuse completed results.

**M2 · Give progress one visible unit.** `ui/JourneyBar.svelte`, `ui/GoalCard.svelte`, `src/logic/journey.mjs`. The cards share a visual scale but the accessible values change unit. 600i’s grey segment represents 17 steps. Carrack’s represents $390 in ship-value increases, although its visible caption counts 13 of 18 steps. Thus two similar bars cannot be compared reliably. Use a step-count bar throughout the collection view, labelled **“13 of 18 upgrades collected”**. Keep money on its own line. In the sample the legend also said “buy now” directly above the step “On sale, no rush”. Use the actual urgency in the text, and keep optional offers out of the urgent colour category.

**M3 · Explain exactly what accepting holds.** `GoalDetail.svelte`, `GoalsPage.svelte`, `goals/QuickSettings.svelte`, `src/logic/glossary.mjs`. Accept and Release are visible before the chain. The glossary and release help mention CCUs, while the accept paragraph also names store credit and the starting ship. An unaccepted sample goal already warns that changing the start releases the accepted route. Put a reservation summary after the chain overview. For the example use **“Reserve the Alpha → Beta CCU for Beta”** and **“Reserved for Beta. Other goals can no longer use this copy.”** List a starter or credit only when this plan actually holds it. Use **“Release reservation”** and show the exact items released. Show the start-change warning only for an existing reservation. Give bulk acceptance a preview of affected goals and held resources.

**M4 · Reconcile inventory and fleet totals.** `HangarTab.svelte`, `view/hangar.mjs`, `GoalsPage.svelte`. Real Hangar showed 197 CCU pledges, “All 196”, 49 reserved, 147 free and 1 needing review. The counts reconcile as 196 matched plus one needing review, but “All” implies the missing item is included. Use **“197 upgrade pledges · 196 matched · 1 needs review”** and **“Available 147”** in place of “Free”. In sample Goals, Gamma plus a starter-less Beta still yielded “All goals together: $20”. Use **“Planned total · $20 for 1 of 2 goals. Beta needs a starting ship.”** Label whether reserved plans contribute their saved price or their current evaluated price.

**M5 · Correct two planning terms that change a decision.** `Glossary.svelte`, `src/logic/glossary.mjs`, `PlanExplorer.svelte`. “Standard is always on sale” contradicts the sample Store’s “no Standard offer for this step” and the app’s availability tracking. Use **“Standard upgrades use the regular price and can use store credit when offered. Warbond upgrades require new cash and are usually discounted.”** In Explorer, “Money I can use ($)” feeds the store-credit parameter. A user entering a $100 cash budget gets a materially different calculation. Label it **“RSI store credit available ($)”**, with **“Applies to eligible Standard purchases.”**

**M6 · Support keyboard exploration of the network.** `GraphTab.svelte`, `DecisionGraph.svelte`, `ui/JourneyStep.svelte`. Network instructions say “Click a ship for its CCUs”. The chart is a canvas container exposed as an image, with no keyboard equivalent for picking a network node. Goal selection does not let someone inspect an arbitrary ship. Add a searchable **“Inspect a ship”** combobox that drives both the chart selection and the incoming/outgoing list. Give chain rows ordered-list semantics and an accessible phrase such as **“Step 2 of 19. Upgrade Syulen to Spartan. Upgrade owned.”** The current visual arrow is hidden from assistive technology. Preserve the working ship-picker keyboard controls and the glossary’s focus handling.

### Low

**L1 · Make the new-user example earn its screen space.** `ImportScreen.svelte`, `Onboarding.svelte`, `ui/Explainer.svelte`, `view/firstRun.mjs`. Welcome defines a CCU, gives a good example and explains planning. Entering the sample immediately opens another definition over a one-step goal. Present **“Connect my RSI account”** and **“Explore a sample chain”** under the worked example. Open the sample on its chain, with one owned link and one missing link; reserve the three-part tour for Help. Keep the glossary’s search and contextual links.

**L2 · Spend visual emphasis on the decision.** `ui/tokens.css`, `ui/ShipHero.svelte`, `TodayPage.svelte`, `GoalsPage.svelte`, `GoalDetail.svelte`. The Inter type, ship art, dark surfaces and aligned prices give the app a coherent desktop identity. The detail hero reads well at both widths. The repeated rounded panels give instructions, settings, prices and the chain almost equal visual weight. On Goals, “alone” is explained twice at desktop; on Today a hint explains the banner above the banner itself. Keep one prominent next-action sentence, one main cash figure and the ordered chain. Put the starter and timing mode in a compact editable line; disclose the rest of the settings. Use **“With other goals · $160”** and **“If planned alone · $15”** where the comparison actually occurs.

**L3 · Make the small controls easier to acquire.** `ui/Term.svelte`, `ui/MoneyFigure.svelte`, `GoalDetail.svelte`, `ui/tokens.css`. The revised grey text is legible on the sampled dark panels. The harder elements are the tiny circular help buttons beside the most ambiguous prices, and 12 px text beside several other similarly weighted controls. Keep the symbol small but make the entire label clickable and keyboard-focusable. Use a visible focus ring across textarea, disclosure summary and custom buttons as well as standard inputs. Keep urgency in words alongside colour. On a 390 px Goals spot check the first chain row started near y=1665 even without document-level horizontal overflow; a single selected-goal field and one-line price summary would buy more space than shrinking type further.

**L4 · Describe an unchanged assumption precisely.** `PricesTab.svelte`, `src/logic/describe.mjs`. The real Prospector row showed “$175 today -> $175 expected (announced increase)” alongside “193 Standard offer(s) affected”. The label counts offers covered by the assumption and implies a change in their price. Use **“Current and expected ship value both $175. This assumption covers 193 Standard offers.”** Report a changed-price count only when there is an actual before/after difference. Use proper singular forms in sample Store and replace “All 1 step is already yours” with **“You own the only upgrade in this chain.”**

## Redesign proposal

Keep Today, Goals, Hangar and Store. They correspond to four distinct tasks, and the wide Goals split view is worth retaining. Make the **goal** the ship the user wants, the **chain** the ordered list of upgrades that builds it, and the **plan** the allocation of shared resources across goals. Use those words consistently in navigation, reservations, charts and teaching copy.

### Today

~~~text
Today                                             Store checked yesterday
Nothing urgent. Two optional purchases.

For Liberator                                     $10 cash · 1 copy
Constellation Mk IV Phoenix → Galaxy               On sale, no rush
Pay $10 of the planned cost early. Fleet total stays the same.
[See this step in Liberator’s chain]   [Why this step?]   [View RSI offer ↗]

For Odyssey                                       $50 · credit accepted
Ironclad Assault → Odyssey                         Optional price protection
[See what happens if I wait]

Waiting for sales                                 36 steps across 10 goals
~~~

### Goal and chain

~~~text
[Goals ▾]  600i Explorer                   From Pulse · Lifetime insurance
[Proposed chain · $45]  [Reserved chain · $50]          [Compare changes]

17 of 19 upgrades collected                     $45 new cash remaining
Next purchase decision   Wait for a sale on Pulse → Syulen.

Start   Pulse · starting ship
  01    Pulse → Syulen                          Wait · $40 today     [Why?]
  02    Syulen → Spartan                        Upgrade owned
  03    Spartan → Reliant Sen                   Wait · $5 today      [Why?]
  04–19 Reliant Sen → 600i Explorer             16 owned upgrades   [Show]
Goal    600i Explorer

[Review reservation changes]    [Edit starter or buying preference]
~~~

On a first visit add one sentence explaining collection order versus application order. Keep the same row numbers and endpoints when expanding a run, searching a hangar copy, or arriving from Today. On wide screens retain the goal list beside this view. At 820 px show the selected goal in one compact switcher above the header. The goal, progress, next decision and first links should fit together at a 900 px viewport height.

### Store and Hangar

~~~text
Store      [Check a pasted deal]       [Browse current offers]
Alpha → Gamma · Warbond                Offered at $15
Save $5 overall                        Replaces a planned $20 purchase
Goal affected   Gamma                  [View chain]

Hangar     [Ships 15]  [Upgrades 197]  [Other pledges]       [Search]
Upgrades   196 matched · 1 needs review
[Available 147]  [Reserved 49]  [Needs review 1]
From → To                   Copies      Paid each       Reserved for
~~~

A successful redesign should let a new user point to their starting ship, trace the intermediate ships, name the first missing upgrade, and say what reserving the chain changes. An expert comparing chains should be able to reproduce the headline cash difference from the changed steps and applied credit on one screen.

## Scope and limits

Reviewed the real planner through its browser UI on port 5300 using read-only navigation, view toggles and disclosures. Port 5310 was initially offline, so I started the repository’s Vite app with a new empty temporary data directory and used its disposable, in-memory sample. I created Beta, chose Alpha, accepted the plan and checked a hypothetical offer there. I used a fresh browser profile and blocked non-local traffic and backend write requests. The account-status probe was blocked or stubbed during the walkthrough; I excluded the resulting test-harness error banner from the findings. No account sign-in, sync, purchase, external store flow or real reservation was exercised. I did not inspect the private data directory.

The main pages were checked at 1440 × 900 and 820 × 900. The 390 px check covered Goals only. Keyboard checks covered ship selection, glossary search, focus cycling and Escape return to Help. Contrast observations are visual and component-based; no full contrast matrix, screen-reader session, native Tauri/WebKit run, or zoom and touch-device audit was performed. The walkthrough models newcomer and expert tasks; it is not a moderated study with either audience. Live account onboarding, CCU Game file import, RSI application of a chain, and the accuracy of the underlying optimizer or sale predictions remain unverified.

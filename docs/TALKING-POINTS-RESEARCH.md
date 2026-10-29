# Talking points — research notes (2026-10-08, light web pass; not interviews)

Findings used in SPEC-V2 §7:
1. Lead with the venue's needs, not the liquid/story/label (Soho House bar ops, Park Street podcast).
2. Visit in the lull between lunch and dinner; never Friday 5 pm or during service; some managers dislike unannounced
   brewery reps — call ahead when possible (Good Beer Hunting "other side of the bar"; general practitioner advice).
3. Ask before claiming: what they carry, how it moves, who decides; several people often decide together against
   weekly sales (GBH).
4. Specific, small, data-backed asks beat "can you support us" (Encompass / Brewers Association deck).
5. Bring what makes yes easy: samples, price per case, support offered (staff training, tasting).
6. NA facts with sources: NA sales +30% in 2024; ~$2M venues +$95k average after expanding NA menus; target 65–75%
   margins; NA ≈ 5–8% of sales, value = longer stays, extra rounds (Restaurant Dive). Athletic: 36% of on-premise craft
   NA; 80% of its customers also drink alcohol; 39% of consumers more likely to return to a venue with NA options
   (Food Dive / Marketing Dive on the Athletic × OpenTable partnership).
7. Relationships and reliability: bartenders rank reliability and support among their top three factors; trust drives
   recommendations (NIQ Global Bartender Report 2026, via summary).

Sources:
- https://www.parkstreet.com/soho-house-on-how-spirits-brands-can-sell-to-bars-expert-talks/
- https://goodbeerhunting.com/blog/2016/8/2/gbh-in-residence-from-the-other-side-of-the-bar
- https://www.restaurantdive.com/news/how-restaurants-can-grow-profits-with-mocktails-nonalcoholic-menus/737866/
- https://www.fooddive.com/news/athletic-brewing-links-with-opentable-in-latest-bid-to-sober-curious/808378
- https://cdn.brewersassociation.org/wp-content/uploads/2026/05/22082842/Winning-Points-of-Distribution_Final.pdf
- https://nielseniq.com/global/en/insights/analysis/2026/build-stronger-relationships-behind-the-bar-with-the-niqs-global-bartender-report-2026/
- https://thebrewermagazine.com/tips-to-dial-in-self-distro-deliveries/
- https://pitcher.com/industries/beverages-on-premise/

Caveat: the facts in (6) are as reported by those outlets; Diolosa review must check each against its page before ship.

## Fact check for `public/data/facts.json` (A3, 2026-10-08)
Each source page was fetched and the number looked for. Restaurant Dive / Food Dive / Marketing Dive serve a bot
challenge to curl, so these were read through a page fetcher; Diolosa should still re-open each link before ship.

Confirmed (wording kept to what the page says):
- `na-sales-2024`: "Nonalcoholic beverage sales soared by 30% in 2024, according to food purchasing company Entegra."
  Restaurant Dive, Feb 5 2025 (op-ed by Sidework's CEO).
- `na-menu-95k`: "Venues that generated about $2 million annually saw an average revenue boost of $95,000 by
  expanding their nonalcoholic drink menus." Same page, Entegra.
- `na-table-time`: "these options drive higher beverage revenue, extend table times, increase per-party spend…"
  Same page; qualitative, labelled as what venues report.
- `na-return-39`: "39% of consumers report they are more likely to return to a restaurant or bar if it offers a wide
  range of nonalcoholic options." Marketing Dive, Dec 18 2025 (data shared by Athletic Brewing); same in Food Dive.
- `na-beer-onprem-36`: "Athletic Brewing holds a 36% share of on-premise nonalcoholic beer sales in America."
  Marketing Dive, Dec 18 2025 (company figures). NA beer only (`category:["beer"]`).
- `bartender-rec-46`: "nearly half (46%) of consumers agree they are likely to purchase a drink based on a bartender's
  recommendation." NIQ Global Bartender Report 2026. `appliesTo:["all"]`.
- `bartender-reliability`: bartenders rank "reliability and support as two of the three most important factors" for
  brands to thrive in 2026. NIQ, same page. `appliesTo:["all"]`.

Dropped or reworded:
- "80% of Athletic drinkers also drink alcohol": not on the Food Dive or Marketing Dive pages. Dropped.
- "NA ≈ 5–8% of sales": not on the Restaurant Dive page. Dropped.
- "65–75% margins": on the page, but as the author's pricing advice, not a measured fact. Not used.
- "Athletic 36% of on-premise craft NA": the page says nonalcoholic beer, not craft NA. Reworded.

Sources used by `facts.json`:
- https://www.restaurantdive.com/news/how-restaurants-can-grow-profits-with-mocktails-nonalcoholic-menus/737866/
- https://www.marketingdive.com/news/athletic-brewing-links-with-opentable-in-latest-bid-to-sober-curious/808191/
- https://www.fooddive.com/news/athletic-brewing-links-with-opentable-in-latest-bid-to-sober-curious/808378
- https://nielseniq.com/global/en/insights/analysis/2026/build-stronger-relationships-behind-the-bar-with-the-niqs-global-bartender-report-2026/

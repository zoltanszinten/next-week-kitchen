# Next Week Kitchen — localhost edition

A JavaScript web app for planning one to seven dinners and building an ingredient shopping list. It runs on your PC at **http://127.0.0.1:3000**. There are no npm packages, API keys, hosting charges, or paid recipe subscriptions.

## Start it

On Windows, double-click `start.cmd`. Keep the command window open, then visit **http://127.0.0.1:3000**. Or run `node server.js` in this folder. Node.js 20 or newer is required. Press **Ctrl+C** to stop it. The server listens only on localhost.

To use the app on a phone, open it through Project Hub on your private home network at `http://<PC-LAN-IP>:8765/next-week-kitchen/`. Direct `start-mobile.cmd` access is also available for planning. Keep the PC and servers running. Devices using the local server share one saved week on that PC.

## Planning

The home screen shows your saved dinners with their shopping list below. Tap a dinner card to include or remove it from **What to buy**; the card highlights when included. The list, copy action, and print view contain ingredients only from included dinners. The choice is saved in the shared JSON plan, so it appears on every device. **View recipe** still opens the full recipe. New plans initially include all saved dinners in the shopping list. **Plan a new week** opens three steps: preferences, what is at home, and dinners. Choose one to seven dinners in preferences. Your existing menu stays in place until you save the new plan. In the kitchen step, enter ingredients into the **Already at home** list; you can also choose an empty kitchen. In the dinner step, the app shows twice as many recipe ideas as dinners requested. Click the meal cards you like in the order you want to cook them; click a selected card again to remove it. **Refresh unselected recipes** replaces only the ideas you have not chosen. Saving returns to the home screen's shopping list.

Recipe generation requests [TheMealDB's free public API](https://www.themealdb.com/api.php) each time. The app does not use a built-in recipe list for weekly plans. The API can filter by a category, area, or one ingredient, but its free version cannot accept a whole pantry or exclusion list. The app therefore sends those preferences to its own server, which checks the complete ingredient list of each recipe. It tries another bounded search automatically when one batch has too few matches. It also checks the API's Hungarian cuisine feed and includes Hungarian meals when available. As of September 2026, [that feed has no meals](https://www.themealdb.com/browse/area/hu), so the planner uses the other available cuisines. You can choose vegetarian or no fish and edit the searchable **Ingredients I don't want** list. Mushrooms, tofu, and cabbage are excluded by default. Remove an avoidance chip and generate again to change the plan.

TheMealDB does not provide verified kcal, nutrition, cooking time, or serving counts. The app shows a coarse ingredient-based calorie estimate when possible and assumes four portions for estimates and measure scaling. Use package labels and actual portions if calorie accuracy matters. Some API recipe measurements are informal and cannot be scaled reliably.

The at-home list gives preference to matching recipes and marks matching shopping items as at home. The saved plan, pantry, exclusions, and checked shopping items are stored in `data/week.json` on the PC. Devices check for updates every 10 seconds while on the home screen, and when their browser tab becomes active. An older browser plan is imported the first time it opens after this update if no shared plan exists yet. If multiple devices have different older plans, the first one to connect supplies the initial shared plan. Later devices use the shared version. The JSON file is written atomically; keep a copy if you want a backup.

## Local data and setup

Photo analysis has been removed. Ingredient entry is manual, and the app does not need Codex, an API key, or a Codex folder.

Run `node --test` for local tests. Recipe generation needs an internet connection.

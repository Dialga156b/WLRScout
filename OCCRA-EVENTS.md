# OCCRA (Offseason) Events: Progress

Status as of 2026-10-16. Tracks the work to let admins create OCCRA events in the app and have them run like FRC events, without The Blue Alliance (TBA).

## How it works

- Admins create an OCCRA event and enter its match schedule on **Admin → Manage Events** (`HTML/admin/manage-events.html`).
- Events are stored by our Cloudflare worker (`data.bheitz780.workers.dev/events`) in the same shape TBA uses for event details, plus a `matches` array.
- Any key matching `^\d{4}wlros-` (for example `2026wlros-oxf`) is treated as a custom event (`isCustomEventKey()` in `JS/utils.js`). For those keys the app reads from the worker instead of TBA.
- OCCRA has no live results or reliable match timing, so **a match counts as played once anyone has submitted scouting for it**.

## Done

### Admin page (`HTML/admin/manage-events.html`, `JS/admin/manage-events.js`)
- [x] The OCCRA event list loads from the worker. Events with no schedule show a striped "TAP TO ADD" button.
- [x] The FIRST event list (read-only) loads the team's events from TBA.
- [x] New event form:
  - The short name is parsed from the event name ("2026 OCCRA Lake Orion Event" → "Lake Orion").
  - The key takes the year from the start date, is lowercased, and gets a number added if it would collide (`2026wlros-oxf2`).
  - Duration counts both the start and end day, and an end date before the start date is rejected.
  - Missing fields are listed by name, the button is disabled while saving, and errors are shown.
  - The schedule editor opens right after the event is created.
- [x] Schedule editor (one per event):
  - Add Match, Delete Last, and the per-row clear button.
  - Team boxes accept digits only, and Space jumps to the next box.
  - A team listed twice in one match blocks saving and highlights the cells. Empty slots only give a warning.
  - Each event's draft is autosaved to localStorage (`scheduleDraft_<key>`), and you're offered a restore when you reopen it.
  - Save Schedule (`PUT`) and Delete Event.
- [x] New matches use `-1` as the "unplayed" score (TBA's convention; this was previously `-7`, which showed every match as completed).
- [x] Fixed the duplicate `add-match-btn` id and the swapped FIRST/OCCRA list ids.
- [x] Teams per alliance (`teams_per_alliance`, 2 or 3, default 3): set with the "Teams / Alliance" button in the new event form and in the schedule editor. In 2v2 mode the Blue 3 / Red 3 columns are hidden and every match's `team_keys` has 2 entries. Switching an existing schedule to 2v2 asks before clearing any filled 3rd slots. The event list shows `2v2` or `3v3`.

### App integration
- [x] `JS/DB.js`: added `getEvents`, `getEvent`, `updateEvent` and `deleteEvent`.
- [x] `isActiveEvent()` combines TBA events with worker events, so OCCRA events appear on the home page.
- [x] `newEventCache()` fetches custom events and their matches from the worker, and marks scouted matches (`_scouted: true`) using each submission's Match Number.
- [x] `computeRankings()` builds TBA-style rankings from scored matches. Every team on the schedule is listed, and ranks show N/A until any match has scores.
- [x] Event page (`JS/event/event-frc.js`): match cards show as many teams as each alliance has (2 or 3).
- [x] Event page (`JS/event/event-frc.js`): scouted matches show as done. A match that is scouted but has no scores shows both **Review** and **Scout** buttons, so the other scouters can still submit.
- [x] Leaderboard (`JS/event/leaderboard.js`):
  - OCCRA events show only the Local (scouted) board.
  - Fixed a crash when rankings are missing. It returned `columns` instead of `tbaColumns`, which also affected FRC events before TBA posts rankings.
- [x] Inspect (`JS/event/inspect.js`): OCCRA events use the computed rankings and don't show a rank before scores exist.

### Worker (Cloudflare, **not in this repo**)
- [x] Wrote a new `/events` block and CORS change (allows `PUT`):
  - **Pending:** confirm it has been pasted into the Cloudflare worker and deployed.
  - Saved events and old rows from the earlier `POST` keep working; old rows simply have no `matches`.

| Request | Behavior |
|---|---|
| `GET /events` | Returns an array of event objects, including their `matches` |
| `GET /events?key=X` | Returns one event, or 404 if it doesn't exist |
| `POST /events` | Creates an event; returns 409 if the key already exists (no longer overwrites) |
| `PUT /events` with body `{ key, ...fields }` | Merges the fields into the stored event (the key can't change) |
| `DELETE /events?key=X` | Deletes the event; its scouting data in `event_<key>` is kept on purpose |

## Data shapes

Event (stored in the `data` column):
```js
{
  key: "2026wlros-oxf", name: "2026 OCCRA Oxford Event", short_name: "Oxford", year: 2026,
  start_date: "2026-10-24", end_date: "2026-10-25", location_name: "Oxford Highschool",
  event_type_string: "Offseason", district: { abbreviation: "occra", display_name: "OCCRA" },
  teams_per_alliance: 3, // 2 or 3; missing means 3
  starting_points: { frc308: 12 }, // optional, added on top of each team's Alliance Points in computeRankings()
  matches: [ /* see below */ ]
}
```

Match:
```js
{
  key: "2026wlros-oxf_qm1", event_key: "2026wlros-oxf", comp_level: "qm", match_number: 1, set_number: 1,
  alliances: { blue: { score: -1, team_keys: ["frc308", "frc7178", ""] /* length = teams_per_alliance */ }, red: { score: -1, team_keys: [...] } },
  winning_alliance: null,
  _scouted: true // added on the device when the event data is fetched, never stored
}
```

## To do

- [ ] **Deploy the worker changes** and test the full flow: create an event, add matches, save, reload, and check the match count.
- [ ] **Results entry:** let admins enter scores and the winner per match in the schedule editor (through the same `PUT`). Until this exists, rankings stay empty and win rate shows "—".
- [ ] **Server-side admin check:** the worker accepts writes to `/events`, `/users` and `/questions` from anyone. Right now only the page itself checks `role == "admin"`.
- [ ] **Refetching data:** the event page reuses its saved data indefinitely, so new submissions and schedule edits only appear on a device after it refetches. Consider an automatic refetch for OCCRA events, or a visible refresh button.
- [ ] Optional: edit an event's details (name, dates, location) after it's created. `PUT` already supports it; only the page controls are missing.

Won't fix: team avatars on the leaderboard come from TBA, so OCCRA teams show a broken image.

## Testing notes

- If a device opened an OCCRA event before these changes, clear its `eventCache_<eventKey>` entry in localStorage (or refetch) to pick up the new data.
- The ranking math, scouted-match detection and short-name parsing were checked in isolation with Node. The pages haven't been tested end-to-end against the deployed worker yet.

# Hilta — next edition network

Admin page: `/treinhuis/netwerk`, behind the existing Treinhuis authentication and POST origin guard. This module does not change 2026 proof calculations, scorecards, participant data or submitted claims.

## Data and sources

- `seed.json` is a factual station/distance import, with source URLs, fetch date and SHA-256 digests. Station codes and names come from OV in Nederland; directed Trainkms links are merged into undirected links, measured in integer metres. All application code here is independently implemented.
- Original scorecard totals remain alongside imported section totals. Differences require explicit review; no proportional scaling is applied.
- Trainkms spellings/codes are matched to the station code list. Multiple codes in a source row are handled as code plus alias. Historical nodes absent from the current station list are passed through and their adjacent distances summed. They are not made selectable as current stops.
- Event stations Amsterdam ArenA and Eindhoven Stadion are listed but currently have no distance link in the imported scorecard network; the station list identifies them as unlinked.
- HSL links retain their explicit scorecard distances and have no intermediate stations.
- Use `node hilta-next/import.mjs --fetch` to produce a new candidate seed from the live sources. Review its output and diff before deployment. Import never overwrites a saved database draft or activates a competition network. No automatic background reimport occurs.

## Versions

The seed is immutable in the application. Every admin save stores a new `hilta-next-version` snapshot with parent revision and timestamp. `hilta-next/draft` is updated with optimistic concurrency. Freezing is blocked until every trajectory has been checked and outstanding discrepancies are resolved. A subsequent change creates a new draft; the frozen snapshot is preserved. No competition activation is implemented here: assignment of a vetted edition version to future participant journeys is a separate launch step.

Station opening/closing dates control valid endpoints and explicit via stops, not whether trains may pass the location. Trajectory dates control availability of the connection itself. Historical calculation can select a prior snapshot.

## Route questions

Shortest path is calculated across scorecard sections. Each configured pair is resolved to its shortest section sequence; its occurrence in a larger route triggers the question in either direction. Each occurrence gets its own key. An alternative replaces only that sequence via configured stops, excluding the default sequence. Explicit via stops that already avoid the default route do not trigger the question. The HSL rules use Hoofddorp–Rotterdam and Lombardijen–Breda-Prinsenbeek as the triggers so a journey need not begin at Schiphol or Rotterdam.

Route test results include version, integer metres, oriented section ids, parent scorecard ids, chosen answers and review warnings. They are previews only; no proof/claim confirmations or 2026 totals are written.

## Validation

`node test-hilta-next.mjs` covers aliases, partial sections, embedded and reversed HSL choices, multiple questions, explicit via stops, station closing, input validation, optimistic concurrency, edition freezing and historical preservation. Existing `test-kk-scorecard.mjs` remains unchanged and passing.

Known source discrepancies requiring review: Eemshaven–Sauwerd and Delfzijl–Sauwerd totals; Bilthoven is a junction inside Utrecht Overvecht–Den Dolder and needs an explicit exception note. All imported line sequences remain marked pending until reviewed.

# Workspace UX Contract

## Interaction goal

The interface should disappear behind the manuscript. It is a writing tool, not an analytics dashboard. Primary prose receives the largest area and strongest contrast. Structure and AI remain available without competing for attention.

## Design tokens

- Cool neutral page and panel surfaces with one restrained vermilion accent.
- Display and UI type use Geist or another modern sans; prose uses the same family with a comfortable reading measure.
- Containers use 12px corners, controls 8px, and status chips may be pills.
- Borders and spacing express hierarchy before shadows. Avoid nested cards.
- Light and dark tokens follow the system preference. Contrast remains WCAG AA or better.
- Motion only confirms state changes, reveals drawers, or transitions AI drafts. Reduced motion removes transforms.

## Project library

- Header contains product identity, project count, and one `New project` action.
- The default view is a sparse manuscript shelf, not an equal-card feature grid.
- Each project shows title, premise or empty prompt, genre, last edited time, and chapter progress based on real data.
- Rename is inline or dialog-based with visible label, validation, cancel, and submit.
- Archive requires confirmation and removes the project from the active list without deleting data.
- Empty state explains the first outcome and places the creation action nearby.
- Errors stay contextual and preserve typed input.

## Workspace shell

- Desktop uses a 240-280px navigator, flexible editor, and optional 320-360px context rail.
- Navigator sections are Story bible, Outline, Chapters, and Adaptations.
- Center header shows breadcrumb, active document title, save state, and only actions relevant to that document.
- Context rail is closed by default on narrower laptops and becomes a drawer below 1024px.
- Mobile shows one region at a time with persistent access to navigation and context.

## Story bible

- Categories are World, Character, Location, Rule, and Theme.
- Entries use a title and Markdown body. Category and order remain editable.
- The first-use state offers concrete examples without inserting fake content automatically.
- Deletion is explicit and recoverable within the current session when practical.

## Outline

- Nodes are Story, Act, Chapter, or Scene and may nest beneath a compatible parent.
- Reordering works by buttons before drag and drop is considered, preserving keyboard access.
- Each node exposes title and short summary; long prose belongs in a chapter.
- The tree keeps selection visible and prevents cycles on the server.

## Chapter editor

- Plain Markdown textarea is acceptable for the MVP if selection and autosave remain reliable.
- Text measure is 65-80 characters, with distraction-free padding and no fake page chrome.
- Autosave starts after a short idle delay. Save states are `Unsaved`, `Saving`, `Saved`, and `Could not save`.
- A failed save retains local prose and exposes retry. Navigation warns while unsaved changes remain.
- Manual snapshot is available from the document menu. History shows timestamp and source.

## AI context and review

- Context is opt-in. The user selects individual bible entries, outline nodes, and chapters.
- The request composer always shows the action, instruction, selected context count, and whether selected prose is included.
- Generation never edits the manuscript directly.
- The review surface presents generated Markdown with `Insert`, `Replace selection`, `Copy`, and `Dismiss`.
- `Replace selection` is disabled without a captured selection. Destructive replacement requires clear scope.
- Loading uses a stable skeleton. Cancellation, timeout, missing configuration, and provider failure have distinct messages.

## Adaptation and export

- The MVP format is screenplay-style scenes with slugline, action, and dialogue guidance.
- An adaptation is editable Markdown and follows the same save-state behavior as a chapter.
- Export previews included sections and downloads deterministic Markdown.
- Empty sections are omitted rather than filled with placeholder prose.

## Accessibility and quality checks

- All controls have visible names, focus rings, keyboard operation, and minimum 44px touch targets on mobile.
- Dialog focus is trapped and restored. Drawers close with Escape.
- Loading, empty, success, and error states are tested for each core region.
- Visible copy uses plain, concrete language and contains no em dash characters.

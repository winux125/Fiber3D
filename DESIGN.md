# FiberPlan 3D — Carbon design contract

This project uses a product-interface adaptation of the IBM design analysis from
VoltAgent's `awesome-design-md` collection.

## Visual direction

- Precise, technical and trustworthy GIS/engineering workstation.
- IBM Plex Sans everywhere: 300 for large display text, 400 for body, 600 only
  for labels and selected states.
- Four-pixel spacing grid.
- Flat geometry: square controls and panels, one-pixel dividers, no decorative
  shadows or glassmorphism.
- White and gray surfaces form the application shell. The 3D viewport is the
  intentional inverse work surface.

## Color roles

- Primary: `#0f62fe`
- Primary hover: `#0050e6`
- Ink: `#161616`
- Muted ink: `#525252`
- Canvas: `#ffffff`
- Layer 1: `#f4f4f4`
- Layer 2 / border: `#e0e0e0`
- Inverse: `#161616`
- Success: `#24a148`
- Warning: `#f1c21b`
- Error: `#da1e28`

## Component rules

- Buttons are 48px high, square, and use IBM blue only for the primary action.
- Selected tabs use a 2px blue bottom rule.
- Panels, cards, rows and inputs use surface changes and hairlines for depth.
- Focus is always visible with a 2px blue outline.
- Status dots may use semantic colors; decorative secondary brand colors are
  not introduced.
- Dense data remains readable: body text never drops below 12px.

## Responsive behavior

- Three-column engineering workspace on wide screens.
- Two side panels narrow before the 3D viewport does.
- Below tablet width, the document becomes a vertical flow with the viewport
  first and controls as full-width sections.
- Interactive targets remain at least 44–48px.

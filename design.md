# Design System Specification: RAFIKI

## 1. Overview & Creative North Star: "The Digital Sanctuary"
This design system rejects the frantic, cluttered aesthetic of traditional fintech. Our Creative North Star is **The Digital Sanctuary**. We aim to create a space that feels like a calm, high-end editorial journal rather than a banking app. 

The system moves away from "standard" UI by leveraging **Organic Asymmetry** and **Tonal Depth**. Instead of rigid grids and heavy borders, we use breathing room (whitespace) and subtle shifts in surface color to guide the eye. The interface should feel "quiet" but authoritative—providing a premium experience for the Kenyan user that prioritizes legibility on mid-range Android devices while maintaining a signature, sophisticated soul.

---

## 2. Color Strategy: Tonal Intelligence
We utilize a sophisticated palette that balances the grounding nature of `Primary` (#00342b Deep Teal) with the energetic pulse of `Secondary` (#4755b6 Warm Indigo).

### The "No-Line" Rule
To achieve a premium, custom feel, **1px solid borders are prohibited** for sectioning. Boundaries must be defined solely through background color shifts or subtle tonal transitions. For example, a `surface-container-low` card sitting on a `surface` background provides all the separation a user needs without the visual noise of a stroke.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of fine paper. 
- **Base Level:** `surface` (#f9f9f9)
- **Secondary Sectioning:** `surface-container-low` (#f3f3f3)
- **Floating Interactive Elements:** `surface-container-lowest` (#ffffff)
- **High-Emphasis Containers:** `surface-container-high` (#e8e8e8)

### Signature Textures
Avoid flat, "dead" backgrounds. Use subtle linear gradients for primary CTAs or hero backgrounds, transitioning from `primary` (#00342b) to `primary-container` (#004d40) at a 135-degree angle. This adds a "silk-like" finish that feels intentional and high-end.

---

## 3. Typography: The Editorial Voice
We use **Inter** exclusively. By removing "Bold" from our vocabulary, we rely on scale and case-weight to create hierarchy. This results in a cleaner, more "intelligent" appearance.

- **Display (L/M/S):** Used for large balance amounts or high-impact greetings. Medium (500) weight. *Rule: Always use tight letter-spacing (-0.02em) for display sizes.*
- **Headline & Title:** Use for page headers and card titles. Medium (500) weight. This is our "Authoritative" voice.
- **Body (L/M/S):** Regular (400) weight. Primary for all reading material and AI responses. 
- **Micro-Labels (`label-sm`):** 10px (0.6875rem), All-Caps, with a +0.05em letter spacing. Use `on-surface-variant` (#3f4945) color. These are for metadata and category tags only.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are replaced by **Tonal Layering** and **Ambient Glows**.

- **The Layering Principle:** Depth is achieved by stacking tiers. Place a `surface-container-lowest` card on a `surface-container-low` background to create a soft, natural lift.
- **Ambient Shadows:** Only use shadows for high-priority floating elements (e.g., a Bottom Sheet). Shadows must be extra-diffused: `box-shadow: 0 12px 32px rgba(0, 52, 43, 0.04)`. Note the use of a tinted shadow color rather than black.
- **The "Ghost Border":** If a border is required for accessibility, it must be a 0.5px "Ghost Border" using `outline-variant` (#bfc9c4) at 20% opacity.
- **Glassmorphism:** For the navigation bar or top app bar, use a `surface` color at 80% opacity with a `12px` backdrop-blur. This allows the financial data to "flow" beneath the navigation, creating a sense of continuity.

---

## 5. Components

### Cards & Containers
- **Radii:** Always `xl` (1.5rem / 24px) for main dashboard cards to feel friendly. `lg` (1rem / 16px) for nested elements.
- **Spacing:** Enforce a strict 20px (`5` on the scale) internal padding.
- **Zero-Divider Rule:** Forbid the use of line dividers. Use vertical white space `spacing-4` (1.4rem) or a subtle shift to `surface-container-highest` to separate list items.

### Interactive Elements
- **Buttons:** 
    - **Primary:** Gradient fill (`primary` to `primary-container`), no border, `full` (9999px) radius. 
    - **Secondary:** `surface-container-highest` background with `primary` text.
- **Pills/Chips:** Always `full` radius. Use `secondary-container` (#8a99fe) for active states to provide a calm "Indigo" contrast against the Teal primary.
- **Input Fields:** Use `surface-container-low` for the field background. No bottom line. On focus, transition the background to `surface-container-lowest` with a 0.5px `primary` ghost border.

### Signature Component: The AI Conversation Bubble
- **Styling:** Asymmetric radii. 24px for three corners, 4px for the bottom-left (user) or bottom-right (AI). 
- **Elevation:** Use a subtle `primary-fixed-dim` tint for AI bubbles to distinguish them from standard system cards.

---

## 6. Do’s and Don’ts

### Do
- **Do** use `spacing-10` (3.5rem) as a minimum for vertical section spacing. Embrace the "empty" space.
- **Do** use `on-surface-variant` for secondary text to maintain a soft contrast ratio that reduces eye strain.
- **Do** ensure all touch targets for chips and buttons are at least 48dp high for mid-range Android accessibility.
- **Do** use the `Amber` semantic color (#FFA000) for "Pending" or "Savings Goals" to feel warm rather than alarming.

### Don’t
- **Don’t** use "Pure Black" (#000000) for text. Use `on-surface` (#1a1c1c).
- **Don’t** use Bold (700+) weights. Hierarchy must be achieved through size and the Medium (500) weight.
- **Don’t** use standard Material Design "elevated" cards with heavy shadows. This breaks the "Sanctuary" aesthetic.
- **Don’t** use icons with varying stroke weights. Use a consistent 1.5px or 2px "Light" icon set to match the typography.
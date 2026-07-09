---
name: frontend-design
description: Use when the user asks to build web components, pages, or applications that need distinctive, production-grade frontend interfaces with high design quality
license: Complete terms in LICENSE
---

# Frontend Design

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and choose an intentional aesthetic direction. Existing design systems, brand requirements, accessibility, performance, and explicit user constraints take precedence; seek stronger differentiation when those constraints leave room:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose a strong aesthetic position — brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, or another distinctive direction. Use these as inspiration, not a menu — the goal is one cohesive vision the user will remember.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this memorable? What's the one thing someone will remember?

Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — what matters is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:

- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:

- **Typography**: Follow the product's established type system when one exists. When unconstrained, choose characterful, readable typography that fits the context instead of defaulting automatically to common UI fonts. Pair display and body faces deliberately when the design calls for it.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

Avoid generic AI-generated aesthetics: clichéd gradients, predictable component arrangements, decorative effects without purpose, and cookie-cutter design that lacks context-specific character. Common fonts, layouts, and restrained styling are appropriate when required by the existing product; use them intentionally rather than by default.

Interpret creatively where the brief permits it. Vary theme, typography, composition, and visual language according to the product context instead of forcing every interface toward the same fashionable choices.

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Commit fully to the chosen direction, including restraint when consistency, usability, accessibility, or performance calls for it.

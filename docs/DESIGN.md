# Design System

## Principles

- **Consistency over novelty.** Reuse existing patterns before creating new ones.
- **Accessible by default.** All interactive elements must be keyboard-navigable and screen-reader friendly.
- **Mobile-first.** Design for the smallest screen, enhance for larger ones.

## Component Conventions

<!-- Define your component patterns here -->

### Naming
- Components: PascalCase (`UserProfile.tsx`)
- Hooks: camelCase with `use` prefix (`useAuth.ts`)
- Utilities: camelCase (`formatDate.ts`)
- Types: PascalCase with descriptive suffix (`UserProfileProps`, `AuthState`)

### File Structure
Each component directory:
```
ComponentName/
  index.ts          # Re-export
  ComponentName.tsx  # Implementation
  ComponentName.test.tsx  # Tests
```

## Color Tokens

<!-- Define your color system -->
```
--color-primary: ...
--color-secondary: ...
--color-error: ...
--color-success: ...
--color-warning: ...
--color-background: ...
--color-surface: ...
--color-text: ...
--color-text-muted: ...
```

## Typography Scale

<!-- Define your type scale -->
```
--font-xs: 0.75rem
--font-sm: 0.875rem
--font-base: 1rem
--font-lg: 1.125rem
--font-xl: 1.25rem
--font-2xl: 1.5rem
--font-3xl: 2rem
```

## Spacing Scale

Use multiples of 4px: 4, 8, 12, 16, 24, 32, 48, 64, 96
